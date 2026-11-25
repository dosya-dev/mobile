package dev.dosya.personasbg

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Starts the JS runtime without UI for a worker window and runs the headless
 * task `DosyaPersonasRead` (registered in apps/mobile/index.js). The task data
 * is `{ id, deadlineMs }`; the runner itself takes the window from onWindow,
 * which PersonasWindows buffers until it listens.
 */
class PersonasHeadlessService : HeadlessJsTaskService() {

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    // Allowed in the foreground: the app may open while the worker starts;
    // the JS read lock decides who reads.
    return HeadlessJsTaskConfig(TASK_NAME, Arguments.fromBundle(extras), TIMEOUT_MS, true)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)
    // Never redeliver: a restarted process has no worker window to read in.
    return START_NOT_STICKY
  }

  companion object {
    const val TASK_NAME = "DosyaPersonasRead"
    const val TIMEOUT_MS = 9 * 60 * 1000L
    const val EXTRA_ID = "id"
    const val EXTRA_DEADLINE_MS = "deadlineMs"
  }
}
