package dev.dosya.shareintent

import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Surfaces files handed to the app by Android's "Open with" chooser and share
 * sheet. JS treats this module as optional (see src/share-intent/native.ts): it
 * is absent in Expo Go and on iOS.
 *
 * Exists because React Native's Linking module is not enough on its own:
 *
 *  - ACTION_VIEW puts the URI in the intent's *data*, which Linking does expose
 *    via getInitialURL(). That path alone would work.
 *  - ACTION_SEND and ACTION_SEND_MULTIPLE put it in the EXTRA_STREAM *extra* and
 *    leave the data null. Linking cannot read extras, so the entire share sheet
 *    is invisible to JS without native code.
 *  - A content:// URI carries no filename. The real one lives in the
 *    ContentResolver's OpenableColumns.DISPLAY_NAME, so without this query every
 *    shared file uploads under a meaningless name like "1000000234".
 *
 * This resolves metadata only and does not copy any bytes. The copy happens in
 * JS at the moment the user confirms a destination (see src/share-intent/copy.ts)
 * - doing it here would race the `upload-` cache sweep that runs at startup.
 */
class DosyaShareIntentModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("DosyaShareIntent")

    Events(SHARE_EVENT)

    // Cold start: the activity already held the intent before JS existed, so
    // there was no listener to fire. JS calls this once on mount to drain it.
    AsyncFunction("consumePendingShare") {
      val intent = appContext.currentActivity?.intent ?: return@AsyncFunction null
      consume(intent)
    }

    // Warm start: MainActivity is launchMode="singleTask" (Expo's default), so a
    // second share into an already-running app never re-creates the activity -
    // it arrives here and nowhere else.
    OnNewIntent { intent ->
      val files = consume(intent)
      if (files != null) sendEvent(SHARE_EVENT, mapOf("files" to files))
    }
  }

  /**
   * Returns the shared files, or null if this intent carries none or has already
   * been handed to JS.
   *
   * The consumed flag is written back onto the Intent rather than held in a field
   * because the Intent outlives this module: a Fast Refresh or a JS bundle reload
   * re-creates the module and would otherwise re-deliver - and re-upload - the
   * same file the user already dealt with.
   */
  private fun consume(intent: Intent): List<Map<String, Any?>>? {
    if (intent.getBooleanExtra(EXTRA_CONSUMED, false)) return null
    val uris = incomingUris(intent)
    if (uris.isEmpty()) return null
    intent.putExtra(EXTRA_CONSUMED, true)
    return uris.mapNotNull { describe(it) }.takeIf { it.isNotEmpty() }
  }

  private fun incomingUris(intent: Intent): List<Uri> = when (intent.action) {
    Intent.ACTION_VIEW -> listOfNotNull(intent.data)
    Intent.ACTION_SEND -> listOfNotNull(
      IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java),
    )
    Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(
      intent, Intent.EXTRA_STREAM, Uri::class.java,
    ).orEmpty().filterNotNull()
    else -> emptyList()
  // A share sheet can hand over plain text with no stream at all (EXTRA_TEXT).
  // There is nothing to upload in that case, so it is dropped here rather than
  // opening a destination picker for a file that does not exist.
  }.filter { it.scheme == "content" || it.scheme == "file" }

  /** null when the URI cannot be read at all - a revoked grant, or a provider that has gone away. */
  private fun describe(uri: Uri): Map<String, Any?>? {
    val resolver = appContext.reactContext?.contentResolver ?: return null
    // getType() is the provider's own answer and beats intent.type, which for a
    // multi-file share is flattened to the common ancestor (often "*/*").
    val mime = runCatching { resolver.getType(uri) }.getOrNull() ?: "application/octet-stream"

    var name: String? = null
    var size: Long = 0
    if (uri.scheme == "content") {
      val cursor: Cursor? = runCatching {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
      }.getOrNull() ?: return null
      cursor?.use {
        if (it.moveToFirst()) {
          val nameIdx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (nameIdx >= 0 && !it.isNull(nameIdx)) name = it.getString(nameIdx)
          val sizeIdx = it.getColumnIndex(OpenableColumns.SIZE)
          if (sizeIdx >= 0 && !it.isNull(sizeIdx)) size = it.getLong(sizeIdx)
        }
      }
    } else {
      name = uri.lastPathSegment
    }

    return mapOf(
      "uri" to uri.toString(),
      "name" to fallbackName(name, mime),
      "size" to size,
      "mime" to mime,
    )
  }

  /**
   * Some providers return no DISPLAY_NAME, and some return one with no
   * extension. Both matter downstream: the server picks an icon and a preview
   * from the extension, so an extensionless name shows a shared PDF as a generic
   * blob forever.
   */
  private fun fallbackName(name: String?, mime: String): String {
    val base = name?.trim()?.takeIf { it.isNotEmpty() } ?: "shared-file"
    if (base.substringAfterLast('.', "").isNotEmpty()) return base
    val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: return base
    return "$base.$ext"
  }

  private companion object {
    const val SHARE_EVENT = "onShareIntent"
    const val EXTRA_CONSUMED = "dev.dosya.shareintent.CONSUMED"
  }
}
