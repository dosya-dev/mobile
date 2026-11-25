package dev.dosya.backupstatus

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle

class BackupWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    ids.forEach { render(context, manager, it) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    newOptions: Bundle?,
  ) {
    render(context, manager, id)
  }

  private fun render(context: Context, manager: AppWidgetManager, id: Int) {
    // This runs in the launcher's process. A throw here is shown to the user as
    // dosya crashing their home screen, so nothing below may propagate.
    try {
      val minWidthDp = manager.getAppWidgetOptions(id)
        ?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
      val nightMode = (context.resources.configuration.uiMode and
        Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

      val views = WidgetRenderer.build(
        context = context,
        snapshot = SnapshotStore.read(context),
        size = WidgetRenderer.sizeFor(minWidthDp),
        nightMode = nightMode,
        now = System.currentTimeMillis() / 1000,
      )
      manager.updateAppWidget(id, views)
    } catch (_: Throwable) {
      /* leave the previous rendering in place rather than crash the host */
    }
  }

  companion object {
    /** Re-render every placed widget. Called after each snapshot write. */
    fun refreshAll(context: Context) {
      // Same rule as render(): this can run off a JS call into the module, but
      // getAppWidgetIds is still a Binder IPC call and getInstance can return
      // null, so nothing here may propagate either.
      try {
        val manager = AppWidgetManager.getInstance(context) ?: return
        val ids = manager.getAppWidgetIds(
          ComponentName(context, BackupWidgetProvider::class.java)
        )
        if (ids.isEmpty()) return
        BackupWidgetProvider().onUpdate(context, manager, ids)
      } catch (_: Throwable) {
        /* best-effort refresh; leave existing widget rendering in place */
      }
    }
  }
}
