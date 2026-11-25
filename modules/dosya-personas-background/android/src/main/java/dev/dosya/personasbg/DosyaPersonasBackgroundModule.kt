package dev.dosya.personasbg

import android.Manifest
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS side of the Personas background windows on Android (see
 * PersonasWindows, PersonasReadService, PersonasReadWorker and
 * modules/dosya-personas-background/index.ts). The iOS-only functions are
 * defined here as no-ops so the module has one shape on both platforms.
 */
class DosyaPersonasBackgroundModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private var memoryCallbacks: ComponentCallbacks2? = null

  override fun definition() = ModuleDefinition {
    Name("DosyaPersonasBackground")

    Events(
      PersonasWindows.WINDOW_EVENT,
      PersonasWindows.EXPIRED_EVENT,
      PersonasWindows.MEMORY_EVENT,
      PersonasWindows.PAUSE_EVENT,
      PersonasWindows.SERVICE_STOPPED_EVENT,
    )

    OnCreate {
      PersonasWindows.attach { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      PersonasWindows.detach()
      stopMemoryWarnings()
    }

    // Per event, so one listener does not flush another event's buffer
    // before its listener is in place.
    for (name in listOf(
      PersonasWindows.WINDOW_EVENT,
      PersonasWindows.EXPIRED_EVENT,
      PersonasWindows.PAUSE_EVENT,
      PersonasWindows.SERVICE_STOPPED_EVENT,
    )) {
      OnStartObserving(name) { PersonasWindows.startListening(name) }
      OnStopObserving(name) { PersonasWindows.stopListening(name) }
    }
    // Not buffered, as on iOS: a stale memory warning means nothing.
    OnStartObserving(PersonasWindows.MEMORY_EVENT) { startMemoryWarnings() }
    OnStopObserving(PersonasWindows.MEMORY_EVENT) { stopMemoryWarnings() }

    // A worker window completes its run (and enqueues again when moreLeft);
    // a service window just ends: the service runs until stopService.
    Function("windowDone") { id: String, moreLeft: Boolean ->
      PersonasWindows.done(id, moreLeft)
    }

    // iOS's BGProcessingTask request; Android uses enqueueWorker.
    AsyncFunction("scheduleWindow") { _: Boolean -> }

    AsyncFunction("cancelWindows") {
      PersonasReadWorker.cancel(context)
    }

    Function("supportsContinued") { false }

    AsyncFunction("startContinued") { _: String, _: String -> false }

    // The continued task's progress is iOS only; the service has updateService.
    Function("setWindowProgress") { _: String, _: Int, _: Int, _: String -> }

    AsyncFunction("backgroundBlocks") {
      val blocks = mutableListOf<String>()
      if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) blocks.add("notificationsOff")
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (power != null && !power.isIgnoringBatteryOptimizations(context.packageName)) blocks.add("batteryOptimized")
      blocks
    }

    // Never ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (Play restricts it).
    AsyncFunction("openAppSettings") { which: String ->
      val intent = if (which == "notificationsOff" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
      }
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startService") { title: String, text: String, pauseLabel: String, channelName: String ->
      if (appContext.currentActivity == null) return@AsyncFunction false
      PersonasReadService.start(context, title, text, pauseLabel, channelName)
    }.runOnQueue(Queues.MAIN)

    Function("updateService") { read: Int, total: Int, text: String ->
      PersonasReadService.update(context, read, total, text)
    }

    Function("stopService") {
      PersonasReadService.stop(context)
    }

    AsyncFunction("enqueueWorker") { requiresCharging: Boolean, batteryNotLow: Boolean, unmetered: Boolean, tapText: String ->
      PersonasReadWorker.enqueue(context, requiresCharging, batteryNotLow, unmetered, tapText)
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result ->
          promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED)
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }
  }

  private fun startMemoryWarnings() {
    if (memoryCallbacks != null) return
    val callbacks = object : ComponentCallbacks2 {
      // TRIM_MEMORY_RUNNING_LOW is deprecated on API 34+ (no longer sent
      // there); the spec names it, and older phones still send it.
      @Suppress("DEPRECATION")
      override fun onTrimMemory(level: Int) {
        // UI_HIDDEN (20) is above RUNNING_LOW (10) but only means the app
        // left the screen, which is when background reading starts.
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW && level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
          sendEvent(PersonasWindows.MEMORY_EVENT, emptyMap<String, Any?>())
        }
      }

      override fun onConfigurationChanged(newConfig: Configuration) = Unit

      @Deprecated("Deprecated in Java")
      override fun onLowMemory() {
        sendEvent(PersonasWindows.MEMORY_EVENT, emptyMap<String, Any?>())
      }
    }
    context.applicationContext.registerComponentCallbacks(callbacks)
    memoryCallbacks = callbacks
  }

  private fun stopMemoryWarnings() {
    val callbacks = memoryCallbacks ?: return
    memoryCallbacks = null
    appContext.reactContext?.applicationContext?.unregisterComponentCallbacks(callbacks)
  }
}
