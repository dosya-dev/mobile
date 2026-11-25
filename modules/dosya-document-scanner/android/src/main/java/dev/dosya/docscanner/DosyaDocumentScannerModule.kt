package dev.dosya.docscanner

import android.app.Activity
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

/**
 * Google's ML Kit document scanner, handing back one PDF. Same JS surface as
 * ios/DosyaDocumentScannerModule.swift.
 *
 * The scanner screen runs inside Google Play services (edge detection,
 * cropping, filters, retakes), so it needs no camera permission of ours and
 * writes the PDF itself. A phone without Play services has no scanner at
 * all, and `isAvailable` says so before anyone sees the button.
 */
class DosyaDocumentScannerModule : Module() {
  private var pending: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("DosyaDocumentScanner")

    Function("isAvailable") {
      val context = appContext.reactContext ?: return@Function false
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    AsyncFunction("scan") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_VIEW", "Nothing to present the scanner from", null)
        return@AsyncFunction
      }
      if (pending != null) {
        promise.reject("E_BUSY", "A scan is already open", null)
        return@AsyncFunction
      }
      val options = GmsDocumentScannerOptions.Builder()
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .setGalleryImportAllowed(true)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
        .build()
      pending = promise
      GmsDocumentScanning.getClient(options)
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          try {
            activity.startIntentSenderForResult(sender, REQUEST_CODE, null, 0, 0, 0)
          } catch (e: Exception) {
            settle { it.reject("E_SCAN", e.message ?: "Could not open the scanner", e) }
          }
        }
        // The first run downloads the scanner module; a phone offline at that
        // moment, or with outdated Play services, lands here.
        .addOnFailureListener { e ->
          settle { it.reject("E_UNAVAILABLE", e.message ?: "The scanner is not available", e) }
        }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CODE) return@OnActivityResult
      if (payload.resultCode != Activity.RESULT_OK) {
        settle { it.resolve(null) }
        return@OnActivityResult
      }
      val pdf = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)?.pdf
      if (pdf == null) {
        settle { it.resolve(null) }
        return@OnActivityResult
      }
      try {
        val file = copyToCache(pdf.uri)
        settle {
          it.resolve(mapOf("uri" to Uri.fromFile(file).toString(), "pageCount" to pdf.pageCount, "size" to file.length().toDouble()))
        }
      } catch (e: Exception) {
        settle { it.reject("E_PDF", e.message ?: "Could not read the PDF", e) }
      }
    }
  }

  private fun settle(block: (Promise) -> Unit) {
    val promise = pending ?: return
    pending = null
    block(promise)
  }

  /**
   * ML Kit names its output after nothing in particular and may clear it on
   * the next scan, so the PDF moves into our own cache folder before JS
   * queues it for upload.
   */
  private fun copyToCache(source: Uri): File {
    val context = appContext.reactContext ?: throw IllegalStateException("No context")
    val dir = File(context.cacheDir, "scans").apply { mkdirs() }
    val out = File(dir, "${UUID.randomUUID()}.pdf")
    val input = context.contentResolver.openInputStream(source) ?: throw IllegalStateException("Cannot open $source")
    input.use { src -> out.outputStream().use { dst -> src.copyTo(dst) } }
    return out
  }

  companion object {
    private const val REQUEST_CODE = 0x5ca7
  }
}
