package dev.dosya.mediaextras

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Motion Photo tail copy. All the parsing happens in JS (src/backup/motionPhoto.ts);
 * this only streams the last `tailBytes` of a file or content URI into a target
 * path, so the JS side never holds a multi-megabyte base64 string.
 */
class DosyaMediaExtrasModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DosyaMediaExtras")

    AsyncFunction("copyTail") { sourceUri: String, tailBytes: Double, targetPath: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val uri = Uri.parse(sourceUri)
      val tail = tailBytes.toLong()
      if (tail <= 0) return@AsyncFunction false
      val input = context.contentResolver.openInputStream(uri) ?: return@AsyncFunction false
      input.use { stream ->
        // available() is only a lower bound for a content:// stream (it does not
        // report the provider's true remaining size); the target.length() == tail
        // check below refuses a copy that came up short instead of trusting this.
        val total = if (uri.scheme == "file") File(uri.path!!).length() else stream.available().toLong()
        if (total <= tail) return@AsyncFunction false
        var toSkip = total - tail
        while (toSkip > 0) {
          val skipped = stream.skip(toSkip)
          if (skipped <= 0) return@AsyncFunction false
          toSkip -= skipped
        }
        val target = File(targetPath)
        target.parentFile?.mkdirs()
        FileOutputStream(target).use { out -> stream.copyTo(out) }
        return@AsyncFunction target.length() == tail
      }
    }
  }
}
