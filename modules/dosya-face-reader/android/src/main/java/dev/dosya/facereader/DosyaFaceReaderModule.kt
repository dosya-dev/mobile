package dev.dosya.facereader

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/** Native decode, file hash and ONNX sessions for the Personas face reader (see ../../../../../index.ts). */
class DosyaFaceReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DosyaFaceReader")

    AsyncFunction("decode") { bytes: ByteArray, maxSide: Int, maxPixels: Int ->
      try {
        val img = Decode.decode(bytes, maxSide, maxPixels)
        mapOf("width" to img.width, "height" to img.height, "rgba" to img.rgba)
      } catch (e: UnsupportedImage) {
        throw FaceReaderException("ERR_UNSUPPORTED", e.message ?: "unsupported")
      } catch (e: FailedImage) {
        throw FaceReaderException("ERR_FAILED", e.message ?: "failed")
      }
    }

    AsyncFunction("sha256File") { path: String ->
      val file = File(path)
      if (!file.isFile || !file.canRead()) throw FaceReaderException("ERR_FAILED", "cannot read $path")
      val md = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buf = ByteArray(1 shl 20)
        while (true) {
          val n = input.read(buf)
          if (n < 0) break
          md.update(buf, 0, n)
        }
      }
      md.digest().joinToString("") { "%02x".format(it) }
    }

    AsyncFunction("loadModels") { detectorPath: String, embedderPath: String ->
      sessionCall { Sessions.load(detectorPath, embedderPath) }
    }

    AsyncFunction("detect") { input: ByteArray -> sessionCall { Sessions.detect(input) } }

    AsyncFunction("embed") { input: ByteArray, n: Int -> sessionCall { Sessions.embed(input, n) } }

    AsyncFunction("unloadModels") { sessionCall { Sessions.unload() } }
  }

  private fun <T> sessionCall(body: () -> T): T = try {
    body()
  } catch (e: NoModels) {
    throw FaceReaderException("ERR_NO_MODELS", e.message ?: "models are not loaded")
  } catch (e: SessionFailed) {
    throw FaceReaderException("ERR_FAILED", e.message ?: "failed")
  }
}

class FaceReaderException(code: String, message: String) : CodedException(code, message, null)
