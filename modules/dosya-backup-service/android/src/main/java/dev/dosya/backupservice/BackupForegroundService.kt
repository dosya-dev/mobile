package dev.dosya.backupservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log

/**
 * Keeps a backup run alive while the screen is locked.
 *
 * Android suspends ordinary app work shortly after the screen goes off, which
 * is why a long first backup used to die in the user's pocket and only resume
 * on the next hourly background task. A dataSync foreground service is the
 * supported way to keep a user-initiated transfer running, and the notification
 * is the price of admission.
 */
class BackupForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    Log.i(TAG, "onCreate at=${SystemClock.elapsedRealtime()}")
    // The startForeground() obligation attaches the moment the system creates
    // this service for a startForegroundService() request - and a stop racing
    // in from the engine could destroy it before onStartCommand ever ran,
    // leaving the obligation unmet. Ten seconds later Android killed the WHOLE
    // app with ForegroundServiceDidNotStartInTimeException (two dropbox
    // records from one e2e run; auto-backup with nothing to upload does
    // start-then-instant-stop on every launch). Meeting the obligation here,
    // at the earliest instant the service exists, closes that window for good:
    // however short the service's life, the promise is kept.
    ensureChannel(this)
    startInForegroundCompat(buildNotification(this, "Backing up", -1))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.i(TAG, "onStartCommand enter at=${SystemClock.elapsedRealtime()} action=${intent?.action} intent=${intent != null}")
    // Stops arrive as intents THROUGH this method (never bare stopService from
    // outside), so a stop is always serialized after the foreground promise
    // above - it can no longer outrun the start.
    if (intent?.action == ACTION_STOP) {
      // EVERY startForegroundService() delivery creates its OWN foreground
      // promise - including the one carrying this stop intent to an
      // already-running service, where onCreate (which met the first promise)
      // does not run again. Tear down without meeting it and Android kills the
      // app ten seconds later all the same. startForeground is idempotent, so
      // meet the promise, then stop.
      startInForegroundCompat(buildNotification(this, "Backing up", -1))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
      stopSelf()
      return START_NOT_STICKY
    }
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Backing up"
    // -1 means indeterminate: the run is scanning and has no total yet.
    val percent = intent?.getIntExtra(EXTRA_PERCENT, -1) ?: -1
    ensureChannel(this)
    Log.i(TAG, "channel ready at=${SystemClock.elapsedRealtime()}")
    val notification = buildNotification(this, text, percent)
    Log.i(TAG, "notification built at=${SystemClock.elapsedRealtime()}")
    startInForegroundCompat(notification)
    // The engine decides when this ends. Do NOT redeliver the last intent on
    // restart: a process death mid-run should not resurrect a stale
    // notification with no engine behind it.
    return START_NOT_STICKY
  }

  private fun startInForegroundCompat(notification: Notification) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      Log.i(TAG, "startForeground returned at=${SystemClock.elapsedRealtime()}")
    } catch (t: Throwable) {
      // NEVER rethrow. Android re-creates this service in the background to
      // deliver starts that were pending when a previous process died, and
      // startForeground() from that state throws
      // ForegroundServiceStartNotAllowedException - which, uncaught in
      // onCreate, killed the app in a keeps-stopping loop at every relaunch.
      // A notification we are not allowed to show is a reason to stop the
      // service, never to kill the app.
      Log.e(TAG, "startForeground refused at=${SystemClock.elapsedRealtime()} - stopping self", t)
      stopSelf()
    }
  }

  override fun onDestroy() {
    Log.i(TAG, "onDestroy at=${SystemClock.elapsedRealtime()}")
    super.onDestroy()
  }

  companion object {
    const val TAG = "DosyaFGS"
    const val CHANNEL_ID = "dosya-backup"
    const val NOTIFICATION_ID = 4711
    const val EXTRA_TEXT = "text"
    const val EXTRA_PERCENT = "percent"
    const val ACTION_STOP = "dev.dosya.backupservice.STOP"

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(NotificationManager::class.java) ?: return
      if (manager.getNotificationChannel(CHANNEL_ID) != null) return
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Backup",
        // LOW: an ongoing progress bar should be visible, never make a sound.
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shows progress while your photos are backing up"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    fun buildNotification(context: Context, text: String, percent: Int): Notification {
      // Tapping the notification reopens the app rather than dead-ending.
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val pending = launch?.let {
        PendingIntent.getActivity(
          context,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }

      val builder = Notification.Builder(context, CHANNEL_ID)
        .setContentTitle("dosya.dev")
        .setContentText(text)
        .setSmallIcon(context.applicationInfo.icon)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
      if (pending != null) builder.setContentIntent(pending)
      if (percent in 0..100) {
        builder.setProgress(100, percent, false)
      } else {
        builder.setProgress(0, 0, true)
      }
      return builder.build()
    }
  }
}
