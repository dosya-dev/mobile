package dev.dosya.facereader

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NoModels : Exception("models are not loaded")
class SessionFailed(message: String) : Exception(message)

/**
 * ONNX Runtime 1.29.0 sessions for YuNet and SFace, mirroring
 * apps/web/src/lib/personas-device/ort/models.ts: CPU execution provider,
 * graph optimisation "all", 2 intra-op threads, first input name of each
 * session, first output of SFace. One pair per process; every method takes the
 * object lock, so load, run and unload are serial.
 */
object Sessions {
  // Keep in step with YUNET_OUTPUTS in index.ts and Sessions.swift.
  val YUNET_OUTPUTS = listOf("cls_8", "cls_16", "cls_32", "obj_8", "obj_16", "obj_32", "bbox_8", "bbox_16", "bbox_32", "kps_8", "kps_16", "kps_32")
  const val DETECT_FLOATS = 3 * 320 * 320
  const val EMBED_FLOATS = 3 * 112 * 112
  const val EMBED_DIM = 128

  private var env: OrtEnvironment? = null
  private var detector: OrtSession? = null
  private var embedder: OrtSession? = null
  private var detectorInput = ""
  private var embedderInput = ""
  private var loadedPaths: Pair<String, String>? = null

  private fun options(): OrtSession.SessionOptions = OrtSession.SessionOptions().apply {
    setIntraOpNumThreads(2)
    setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
  }

  /** Idempotent for the same two paths. */
  @Synchronized
  fun load(detectorPath: String, embedderPath: String) {
    val p = loadedPaths
    if (p != null && p.first == detectorPath && p.second == embedderPath && detector != null && embedder != null) return
    unload()
    try {
      val e = OrtEnvironment.getEnvironment()
      env = e
      val d = options().use { e.createSession(detectorPath, it) }
      detector = d
      val missing = YUNET_OUTPUTS.filter { it !in d.outputNames }
      if (missing.isNotEmpty()) throw SessionFailed("unexpected YuNet outputs, missing ${missing.joinToString(", ")}")
      detectorInput = d.inputNames.firstOrNull() ?: throw SessionFailed("YuNet has no input")
      val s = options().use { e.createSession(embedderPath, it) }
      embedder = s
      embedderInput = s.inputNames.firstOrNull() ?: throw SessionFailed("SFace has no input")
      if (s.outputNames.isEmpty()) throw SessionFailed("SFace has no output")
      loadedPaths = detectorPath to embedderPath
    } catch (f: SessionFailed) {
      unload()
      throw f
    } catch (t: Throwable) {
      unload()
      throw SessionFailed("load models: ${t.message}")
    }
  }

  @Synchronized
  fun unload() {
    runCatching { detector?.close() }
    runCatching { embedder?.close() }
    detector = null
    embedder = null
    env = null // the process-wide OrtEnvironment is shared; it is not closed
    loadedPaths = null
  }

  private fun floats(bytes: ByteArray, count: Int): java.nio.FloatBuffer {
    if (bytes.size != count * 4) throw SessionFailed("input is ${bytes.size} bytes, expected ${count * 4}")
    return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
  }

  private fun toBytes(fb: java.nio.FloatBuffer): ByteArray {
    val out = ByteBuffer.allocate(fb.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN)
    out.asFloatBuffer().put(fb.duplicate())
    return out.array()
  }

  @Synchronized
  fun detect(input: ByteArray): Map<String, ByteArray> {
    val e = env ?: throw NoModels()
    val d = detector ?: throw NoModels()
    try {
      OnnxTensor.createTensor(e, floats(input, DETECT_FLOATS), longArrayOf(1, 3, 320, 320)).use { x ->
        d.run(mapOf(detectorInput to x)).use { r ->
          val out = LinkedHashMap<String, ByteArray>()
          for (k in YUNET_OUTPUTS) {
            val v = r.get(k).orElseThrow { SessionFailed("YuNet output $k missing") } as OnnxTensor
            out[k] = toBytes(v.floatBuffer)
          }
          return out
        }
      }
    } catch (f: SessionFailed) {
      throw f
    } catch (t: Throwable) {
      throw SessionFailed("detect: ${t.message}")
    }
  }

  @Synchronized
  fun embed(input: ByteArray, n: Int): ByteArray {
    val e = env ?: throw NoModels()
    val s = embedder ?: throw NoModels()
    if (n < 1) throw SessionFailed("embed needs at least one face")
    try {
      OnnxTensor.createTensor(e, floats(input, n * EMBED_FLOATS), longArrayOf(n.toLong(), 3, 112, 112)).use { x ->
        s.run(mapOf(embedderInput to x)).use { r ->
          val v = r.get(0) as OnnxTensor
          val out = toBytes(v.floatBuffer)
          if (out.size != n * EMBED_DIM * 4) throw SessionFailed("SFace returned ${out.size} bytes for $n faces")
          return out
        }
      }
    } catch (f: SessionFailed) {
      throw f
    } catch (t: Throwable) {
      throw SessionFailed("embed: ${t.message}")
    }
  }
}
