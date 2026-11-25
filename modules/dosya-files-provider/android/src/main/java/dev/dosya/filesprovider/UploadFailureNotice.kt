package dev.dosya.filesprovider

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

/**
 * An edit saved into dosya.dev from another app is uploaded after that app
 * closes the file, with nothing on screen to report to. If the upload fails,
 * this is the only way the user learns the bytes did not reach the server.
 * On Android 13+ it shows only if the app holds POST_NOTIFICATIONS, which the
 * app asks for at first launch for its own backup notifications.
 */
object UploadFailureNotice {
  private const val CHANNEL = "dosya-files-provider"

  fun show(context: Context, fileName: String, reason: String?) {
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL, "File picker uploads", NotificationManager.IMPORTANCE_DEFAULT)
        )
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val open = launch?.let {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
        PendingIntent.getActivity(context, 1, it, flags)
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
      else @Suppress("DEPRECATION") Notification.Builder(context)
      builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle("$fileName was not saved to dosya.dev")
        .setContentText(reason ?: "The upload failed. Save it again from the app.")
        .setAutoCancel(true)
      if (open != null) builder.setContentIntent(open)
      manager.notify(fileName.hashCode(), builder.build())
    } catch (_: Throwable) {
      // A failed notice must never take the provider down with it.
    }
  }
}
