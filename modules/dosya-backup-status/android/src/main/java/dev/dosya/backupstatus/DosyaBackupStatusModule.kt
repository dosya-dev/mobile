package dev.dosya.backupstatus

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DosyaBackupStatusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DosyaBackupStatus")

    // Widget data path. Throttling lives on the JS side (statusBridge.ts).
    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      SnapshotStore.write(context, json)
      BackupWidgetProvider.refreshAll(context)
    }

    // Sign-out: the next account must not see this one's workspace or storage.
    Function("clearSnapshot") {
      val context = appContext.reactContext
      if (context != null) {
        SnapshotStore.clear(context)
        BackupWidgetProvider.refreshAll(context)
      }
    }

    // Live Activity is iOS-only. These exist because statusBridge.ts calls them
    // unconditionally and a missing function throws across the bridge.
    Function("startActivity") { _: String, _: Int -> }
    Function("updateActivity") { _: Int, _: Int, _: Int -> }
    Function("endActivity") { _: Int, _: Int -> }
    Function("endAllActivities") { }
  }
}
