package dev.dosya.backupservice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Start/update/stop the backup foreground service from the JS engine.
 *
 * JS treats this module as optional (see src/backup/foregroundService.ts): it is
 * absent in Expo Go and on iOS, and every call is best-effort. A backup must
 * never fail because a notification could not be shown.
 */
class DosyaBackupServiceModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  // Whether WE believe the service is running. The engine's settle callbacks
  // fire stop once per drained item (a dozen within 300ms in the logs); only
  // the first needs to reach the service, and a stop with no preceding start
  // must not flash the service into existence just to tear it down.
  @Volatile private var started = false

  override fun definition() = ModuleDefinition {
    Name("DosyaBackupService")

    Function("start") { text: String ->
      Log.i(BackupForegroundService.TAG, "module.start called at=${SystemClock.elapsedRealtime()}")
      // Foreground only. The service exists to keep a USER-INITIATED backup
      // alive when the screen locks - a start that always happens with the app
      // in the foreground. The headless background task also reaches this call,
      // and a background startForegroundService() is illegal on Android 12+:
      // ForegroundServiceStartNotAllowedException killed the app in a
      // keeps-stopping loop at boot (dropbox, 13:52/13:55). The background
      // task's work continues fine without the notification.
      if (appContext.currentActivity == null) {
        Log.i(BackupForegroundService.TAG, "module.start skipped: app not in foreground")
      } else {
        val intent = Intent(context, BackupForegroundService::class.java).apply {
          putExtra(BackupForegroundService.EXTRA_TEXT, text)
          putExtra(BackupForegroundService.EXTRA_PERCENT, -1)
        }
        started = true
        startCompat(intent)
        Log.i(BackupForegroundService.TAG, "module.start dispatched at=${SystemClock.elapsedRealtime()}")
      }
    }

    Function("update") { text: String, percent: Int ->
      // Updating the notification directly rather than restarting the service:
      // re-issuing startForegroundService for every progress tick is wasteful
      // and can trip Android's start-rate limits on long runs.
      Log.i(BackupForegroundService.TAG, "module.update called at=${SystemClock.elapsedRealtime()} pct=$percent")
      BackupForegroundService.ensureChannel(context)
      val manager = context.getSystemService(NotificationManager::class.java)
      manager?.notify(
        BackupForegroundService.NOTIFICATION_ID,
        BackupForegroundService.buildNotification(context, text, percent),
      )
    }

    Function("stop") {
      Log.i(BackupForegroundService.TAG, "module.stop called at=${SystemClock.elapsedRealtime()}")
      // Through the START path, as an intent, never bare stopService(): a
      // stopService() racing a pending startForegroundService() destroyed the
      // service before it could call startForeground(), and Android answers an
      // unmet foreground promise by killing the entire app ten seconds later
      // (ForegroundServiceDidNotStartInTimeException). Routed as an intent,
      // the stop is serialized through onStartCommand AFTER the promise is met.
      if (started) {
        started = false
        val intent = Intent(context, BackupForegroundService::class.java).apply {
          action = BackupForegroundService.ACTION_STOP
        }
        // Plain startService: no foreground promise attaches to it, ever. If
        // the app has slipped into the background and the service is not
        // running, it throws synchronously - then bare stopService() is safe
        // precisely BECAUSE nothing in this module uses
        // startForegroundService anymore: there is no pending promise for a
        // stop to orphan.
        try {
          context.startService(intent)
        } catch (t: Throwable) {
          Log.w(BackupForegroundService.TAG, "startService for stop refused; stopping directly", t)
          context.stopService(Intent(context, BackupForegroundService::class.java))
        }
      }
    }
  }

  /**
   * Plain startService, deliberately NOT startForegroundService: the latter
   * attaches a 10-second "must call startForeground" promise that has produced
   * two distinct app-killing exceptions here (DidNotStartInTime when the main
   * thread stalled past the deadline; StartNotAllowed on background
   * re-delivery after a kill). From the foreground - the only state start is
   * called in - startService plus the service's own startForeground is fully
   * legal and carries no deadline at all.
   */
  private fun startCompat(intent: Intent) {
    BackupForegroundService.ensureChannel(context)
    context.startService(intent)
  }
}
