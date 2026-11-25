package dev.dosya.personasbg

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/**
 * WorkManager unique work `dosya-personas-read` (spec 5.4): covers a phone
 * plugged in later with dosya closed. One run is a 9 min "worker" window: it
 * starts the headless JS task through PersonasHeadlessService and completes
 * when JS calls windowDone, enqueueing itself again when JS says moreLeft.
 *
 * Fallback (spec 11.7): with [HEADLESS_JS_START] false, or when Android
 * refuses to start the headless service from the background, the run posts
 * the "Tap to keep reading" notification instead and ends.
 */
class PersonasReadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

  override suspend fun doWork(): Result {
    // The app is in front: the foreground loops read, and JS enqueues the
    // work again when the app goes to the background.
    if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
      return Result.success()
    }
    val tapText = inputData.getString(KEY_TAP_TEXT).orEmpty()
    if (!HEADLESS_JS_START) {
      postTapNotification(applicationContext, tapText)
      return Result.success()
    }

    val startedAt = SystemClock.elapsedRealtime()
    val deadlineMs = System.currentTimeMillis() + WINDOW_MS
    val ended = CompletableDeferred<Boolean?>()
    val id = PersonasWindows.open(KIND, deadlineMs.toDouble()) { moreLeft -> ended.complete(moreLeft) }
    if (!startHeadless(id, deadlineMs)) {
      PersonasWindows.expire(id)
      postTapNotification(applicationContext, tapText)
      return Result.success()
    }

    val moreLeft = try {
      withTimeoutOrNull(WINDOW_MS) { ended.await() } ?: run {
        // Dropped when JS never saw it; otherwise ended after the grace.
        PersonasWindows.expire(id)
        ended.await()
      }
    } catch (e: CancellationException) {
      // WorkManager stopped the run (constraints lost, quota, a REPLACE).
      // WorkManager reschedules work it stopped for constraints.
      PersonasWindows.expire(id)
      throw e
    }

    if (moreLeft == true) {
      // A run that ended at once (another reader held the lock) waits before
      // the next one, so the work cannot spin while the service reads.
      // With the constraints JS asked for last (the read mode may have
      // changed while this run read), else this run's own. This run is still
      // RUNNING, so only REPLACE puts the next one in.
      val short = SystemClock.elapsedRealtime() - startedAt < SHORT_RUN_MS
      val last = lastRequest(applicationContext)
      enqueue(
        applicationContext,
        requiresCharging = last?.requiresCharging ?: inputData.getBoolean(KEY_CHARGING, false),
        batteryNotLow = last?.batteryNotLow ?: inputData.getBoolean(KEY_BATTERY_NOT_LOW, false),
        unmetered = last?.unmetered ?: inputData.getBoolean(KEY_UNMETERED, true),
        tapText = last?.tapText ?: tapText,
        delayMs = if (short) SHORT_RUN_DELAY_MS else 0L,
        replace = true,
      )
    }
    return Result.success()
  }

  private fun startHeadless(id: String, deadlineMs: Long): Boolean = try {
    val intent = Intent(applicationContext, PersonasHeadlessService::class.java)
      .putExtra(PersonasHeadlessService.EXTRA_ID, id)
      .putExtra(PersonasHeadlessService.EXTRA_DEADLINE_MS, deadlineMs.toDouble())
    applicationContext.startService(intent) != null
  } catch (t: Throwable) {
    // IllegalStateException: background service start not allowed.
    Log.w(TAG, "headless start refused", t)
    false
  }

  companion object {
    const val TAG = "DosyaPersonasWork"
    const val UNIQUE_WORK = "dosya-personas-read"
    const val KIND = "worker"

    /**
     * Spec 11.7. True: a run starts the JS runtime headless. False: a run only
     * posts "Tap to keep reading photos for Personas". Task 0's spike could
     * not run (no emulator or device); set this to false if a device shows the
     * headless start failing with the app swiped away.
     */
    const val HEADLESS_JS_START = true

    const val WINDOW_MS = PersonasHeadlessService.TIMEOUT_MS
    private const val SHORT_RUN_MS = 60_000L
    private const val SHORT_RUN_DELAY_MS = 15 * 60_000L
    private const val TAP_NOTIFICATION_ID = 4713

    private const val KEY_CHARGING = "requiresCharging"
    private const val KEY_BATTERY_NOT_LOW = "batteryNotLow"
    private const val KEY_UNMETERED = "unmetered"
    private const val KEY_TAP_TEXT = "tapText"

    private const val PREFS = "dosya-personas-work"
    private const val PREF_KEY = "lastRequest"

    private data class Request(val requiresCharging: Boolean, val batteryNotLow: Boolean, val unmetered: Boolean, val tapText: String) {
      fun encode(): String = "${if (requiresCharging) 1 else 0}${if (batteryNotLow) 1 else 0}${if (unmetered) 1 else 0}$tapText"

      companion object {
        fun decode(s: String?): Request? {
          if (s == null || s.length < 3 || s.take(3).any { it != '0' && it != '1' }) return null
          return Request(s[0] == '1', s[1] == '1', s[2] == '1', s.substring(3))
        }
      }
    }

    private fun lastRequest(context: Context): Request? =
      Request.decode(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_KEY, null))

    /**
     * Enqueue the unique work. JS asks on every background transition and
     * after every window; a run already enqueued or RUNNING with the same
     * constraints is kept (KEEP), so a re-plan never cancels a worker window
     * mid-read. Only changed constraints (or text) REPLACE it. The worker's
     * own next run passes [replace] (it is still RUNNING when it asks).
     */
    fun enqueue(
      context: Context,
      requiresCharging: Boolean,
      batteryNotLow: Boolean,
      unmetered: Boolean,
      tapText: String,
      delayMs: Long = 0L,
      replace: Boolean = false,
    ) {
      val want = Request(requiresCharging, batteryNotLow, unmetered, tapText)
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val changed = Request.decode(prefs.getString(PREF_KEY, null)) != want
      prefs.edit().putString(PREF_KEY, want.encode()).apply()
      val policy = if (replace || changed) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP
      val constraints = Constraints.Builder()
        .setRequiresCharging(requiresCharging)
        .setRequiresBatteryNotLow(batteryNotLow)
        .setRequiredNetworkType(if (unmetered) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .build()
      val input = Data.Builder()
        .putBoolean(KEY_CHARGING, requiresCharging)
        .putBoolean(KEY_BATTERY_NOT_LOW, batteryNotLow)
        .putBoolean(KEY_UNMETERED, unmetered)
        .putString(KEY_TAP_TEXT, tapText)
        .build()
      val request = OneTimeWorkRequestBuilder<PersonasReadWorker>()
        .setConstraints(constraints)
        .setInputData(input)
        .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK, policy, request)
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK)
    }

    /** "Tap to keep reading photos for Personas" (translated, from JS); tapping opens the app. None without text. */
    fun postTapNotification(context: Context, tapText: String) {
      if (tapText.isEmpty()) return
      try {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        PersonasReadService.ensureChannel(context)
        val builder = NotificationCompat.Builder(context, PersonasReadService.CHANNEL_ID)
          .setSmallIcon(context.applicationInfo.icon)
          .setContentTitle(context.applicationInfo.loadLabel(context.packageManager))
          .setContentText(tapText)
          .setAutoCancel(true)
          .setSilent(true)
        PersonasReadService.launchIntent(context)?.let { builder.setContentIntent(it) }
        manager.notify(TAP_NOTIFICATION_ID, builder.build())
      } catch (t: Throwable) {
        Log.w(TAG, "tap notification failed", t)
      }
    }
  }
}
