package dev.dosya.personasbg

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

/**
 * Keeps the process alive while the JS runner reads photos for Personas with
 * the app in the background (spec 5.4). It holds the notification and nothing
 * else: the reading happens in JS.
 *
 * Started only while an Activity is resumed (Android 12+ forbids a background
 * start). It calls startForeground at once, and gives JS a "service" window
 * each time the app goes to the background while it runs (none while the app
 * is in front). windowDone does not stop it; JS calls stopService.
 * Android 15's daily budget for the service type ends in onTimeout, which
 * expires the open service window and stops the service.
 *
 * Lessons from dosya-backup-service: it is started with a plain startService
 * (see [start]), startForeground runs first thing in onCreate and again on
 * every start command, and stops arrive as an intent through onStartCommand.
 */
class PersonasReadService : Service() {

  private var startedByApp = false

  // Only a service JS started gives windows: a late stop or a Pause tap that
  // creates a fresh service must not hand JS a window.
  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    if (event == Lifecycle.Event.ON_STOP && startedByApp) openWindow()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    ensureChannel(this)
    startInForeground()
    ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        startInForeground()
        stopNow()
      }
      ACTION_PAUSE -> {
        PersonasWindows.emit(PersonasWindows.PAUSE_EVENT, null, emptyMap())
        // A Pause tap on a notification left behind by a dead process creates
        // a fresh service JS never asked for: end it again.
        if (!startedByApp) stopNow()
      }
      else -> {
        val first = !startedByApp
        startedByApp = true
        startInForeground()
        // The app may have left the front between the start call and here.
        val inFront = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        if (first && !inFront) openWindow()
      }
    }
    // JS decides when this ends; a process death must not resurrect it.
    return START_NOT_STICKY
  }

  /** Android 15+: the service type's time budget is used up. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.i(TAG, "onTimeout type=$fgsType")
    expireWindows()
    stopNow()
  }

  override fun onDestroy() {
    running = false
    requested = false
    ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
    // Nothing keeps the process alive for an open window any more.
    expireWindows()
    // However it ended (JS's stop, onTimeout, a refused startForeground), JS
    // must stop believing it runs, or it never asks for it again.
    PersonasWindows.emit(PersonasWindows.SERVICE_STOPPED_EVENT, null, emptyMap())
    super.onDestroy()
  }

  private fun openWindow() {
    PersonasWindows.open(KIND, PersonasWindows.NO_DEADLINE_MS) { }
  }

  private fun expireWindows() {
    for (id in PersonasWindows.openIds(KIND)) PersonasWindows.expire(id)
  }

  private fun startInForeground() {
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(this), serviceType())
    } catch (t: Throwable) {
      // Never rethrow: a refused start (ForegroundServiceStartNotAllowedException
      // on a background re-delivery) is a reason to stop, never to crash.
      Log.e(TAG, "startForeground refused; stopping", t)
      stopSelf()
    }
  }

  private fun stopNow() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  companion object {
    const val TAG = "DosyaPersonasFGS"
    const val CHANNEL_ID = "personas"
    const val NOTIFICATION_ID = 4712
    const val KIND = "service"
    private const val ACTION_START = "dev.dosya.personasbg.START"
    private const val ACTION_STOP = "dev.dosya.personasbg.STOP"
    private const val ACTION_PAUSE = "dev.dosya.personasbg.PAUSE"

    @Volatile var running = false
      private set

    // Whether JS asked for the service and has not stopped it: a stop that
    // arrives before onCreate must still reach it.
    @Volatile var requested = false
      private set

    // The notification's content, set from JS.
    @Volatile private var title = ""
    @Volatile private var text = ""
    @Volatile private var pauseLabel = ""
    @Volatile private var read = 0
    @Volatile private var total = 0
    // From JS (translated); the product name when JS passes none.
    @Volatile private var channelName = ""

    fun serviceType(): Int = when {
      Build.VERSION.SDK_INT >= 35 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      else -> 0
    }

    /** True when an Activity is resumed; only then may the service start. */
    fun appResumed(): Boolean =
      ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)

    /** Main thread. False unless an Activity is resumed, or when Android refuses. */
    fun start(context: Context, title: String, text: String, pauseLabel: String, channelName: String): Boolean {
      if (!appResumed()) return false
      this.title = title
      this.text = text
      this.pauseLabel = pauseLabel
      this.read = 0
      this.total = 0
      this.channelName = channelName
      ensureChannel(context)
      // Plain startService, deliberately not startForegroundService (which
      // the brief named): the app is resumed here, so a plain start is
      // allowed, and it carries no 10 s "must call startForeground" promise.
      // That promise killed the app through dosya-backup-service
      // (ForegroundServiceDidNotStartInTimeException when the main thread
      // stalled, and on background re-delivery). onCreate calls
      // startForeground first thing; if Android refuses it, the service just
      // stops.
      return try {
        context.startService(Intent(context, PersonasReadService::class.java).setAction(ACTION_START))
        requested = true
        true
      } catch (t: Throwable) {
        Log.w(TAG, "start refused", t)
        false
      }
    }

    fun update(context: Context, read: Int, total: Int, text: String) {
      this.read = read
      this.total = total
      this.text = text
      if (!running) return
      try {
        val manager = NotificationManagerCompat.from(context)
        if (manager.areNotificationsEnabled()) manager.notify(NOTIFICATION_ID, buildNotification(context))
      } catch (t: Throwable) {
        Log.w(TAG, "update failed", t)
      }
    }

    fun stop(context: Context) {
      if (!requested && !running) return
      requested = false
      // Through onStartCommand, after the foreground promise (see the class doc).
      try {
        context.startService(Intent(context, PersonasReadService::class.java).setAction(ACTION_STOP))
      } catch (t: Throwable) {
        context.stopService(Intent(context, PersonasReadService::class.java))
      }
    }

    fun ensureChannel(context: Context) {
      val manager = NotificationManagerCompat.from(context)
      if (manager.getNotificationChannelCompat(CHANNEL_ID) != null) return
      manager.createNotificationChannel(
        NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
          .setName(channelName.ifEmpty { "Personas" })
          .setShowBadge(false)
          .build(),
      )
    }

    /** Tapping opens the app. */
    fun launchIntent(context: Context): PendingIntent? {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      return PendingIntent.getActivity(
        context,
        0,
        launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun buildNotification(context: Context): Notification {
      val pause = PendingIntent.getService(
        context,
        1,
        Intent(context, PersonasReadService::class.java).setAction(ACTION_PAUSE),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .addAction(0, pauseLabel, pause)
      launchIntent(context)?.let { builder.setContentIntent(it) }
      if (total > 0) {
        builder.setProgress(total, read.coerceIn(0, total), false)
      } else {
        builder.setProgress(0, 0, true)
      }
      return builder.build()
    }
  }
}
