package dev.dosya.vaultchunker

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.math.ln
import kotlin.math.roundToInt

/**
 * Port of packages/e2ee-core/src/chunker.ts. Int arithmetic wraps exactly like
 * the TypeScript's `>>> 0` uint32 (two's complement), and `ushr` is the
 * logical shift the xorshift needs; CHUNKER_VECTORS pins the result on device.
 */
object FastCdc {
  data class Boundary(val offset: Int, val size: Int)

  val gear: IntArray = IntArray(256).also { g ->
    var s = 0x9e3779b9.toInt()
    for (i in 0 until 256) {
      s = s xor (s shl 13)
      s = s xor (s ushr 17)
      s = s xor (s shl 5)
      g[i] = s
    }
  }

  /** SHA-256 over the table as 256 little-endian uint32 (1024 bytes). */
  fun gearTableSha256Hex(): String {
    val buf = ByteBuffer.allocate(1024).order(ByteOrder.LITTLE_ENDIAN)
    for (v in gear) buf.putInt(v)
    return MessageDigest.getInstance("SHA-256").digest(buf.array()).joinToString("") { "%02x".format(it) }
  }

  fun boundaries(data: ByteBuffer, min: Int, avg: Int, max: Int): List<Boundary> {
    val bits = (ln(avg.toDouble()) / ln(2.0)).roundToInt()
    val maskS = (1 shl minOf(31, bits + 2)) - 1
    val maskL = (1 shl maxOf(1, bits - 2)) - 1
    val n = data.limit()
    val out = ArrayList<Boundary>()
    var start = 0
    while (start < n) {
      val hardEnd = minOf(start + max, n)
      var fp = 0
      var end = hardEnd
      var i = start
      while (i < hardEnd) {
        fp = (fp shl 1) + gear[data.get(i).toInt() and 0xff]
        val len = i - start + 1
        if (len >= min) {
          val mask = if (len < avg) maskS else maskL
          if ((fp and mask) == 0) { end = i + 1; break }
        }
        i++
      }
      out.add(Boundary(start, end - start))
      start = end
    }
    return out
  }
}
