package dev.dosya.facereader

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.nio.ByteBuffer
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Raised for a photo the reader refuses (maps to ERR_UNSUPPORTED). */
class UnsupportedImage(message: String) : Exception(message)

/** Raised for bytes that cannot be decoded (maps to ERR_FAILED). */
class FailedImage(message: String) : Exception(message)

class RgbaImage(val width: Int, val height: Int, val rgba: ByteArray)

/**
 * Photo decode for the Personas face reader. Semantics follow
 * apps/web/src/lib/personas-device/ort/decode.ts: no EXIF orientation applied
 * (BitmapFactory never rotates), 8-bit RGBA with no colour-profile
 * conversion, alpha not premultiplied into the
 * colour, long side capped at maxSide by area averaging, and more than
 * maxPixels pixels is unsupported.
 */
object Decode {
  fun workingSize(width: Int, height: Int, maxSide: Int): Pair<Int, Int> {
    val long = max(width, height)
    if (long <= maxSide) return Pair(width, height)
    val s = maxSide.toDouble() / long
    return Pair(max(1, (width * s).roundToInt()), max(1, (height * s).roundToInt()))
  }

  fun decode(bytes: ByteArray, maxSide: Int, maxPixels: Int): RgbaImage {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val w = bounds.outWidth
    val h = bounds.outHeight
    if (w <= 0 || h <= 0) throw FailedImage("not a decodable image")
    if (w.toLong() * h.toLong() > maxPixels) throw UnsupportedImage("photo too large to read (${w}x$h)")

    val opts = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inScaled = false
      inPremultiplied = false
      inMutable = false
      // No inPreferredColorSpace: the decoder's default keeps the file's own
      // values (web: colorSpaceConversion 'none'); the image is not colour-matched.
    }
    val bmp = try {
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    } catch (e: OutOfMemoryError) {
      throw FailedImage("out of memory decoding ${w}x$h")
    } ?: throw FailedImage("decode failed")
    try {
      if (bmp.width != w || bmp.height != h) throw FailedImage("decoded ${bmp.width}x${bmp.height}, header says ${w}x$h")
      val buf = ByteBuffer.allocate(bmp.byteCount)
      bmp.copyPixelsToBuffer(buf)
      val full = buf.array()
      val (dw, dh) = workingSize(w, h, maxSide)
      if (dw == w && dh == h) return RgbaImage(w, h, full)
      return RgbaImage(dw, dh, BoxFilter.shrink(full, w, h, dw, dh))
    } finally {
      bmp.recycle()
    }
  }
}

/**
 * Area-averaging resize: every destination pixel is the mean of the source
 * area it covers, partial source pixels weighted by the covered fraction.
 * Channels are averaged independently (no alpha weighting), matching a
 * non-premultiplied decode. Same algorithm as ios/Decode.swift BoxFilter.
 */
object BoxFilter {
  fun shrink(src: ByteArray, sw: Int, sh: Int, dw: Int, dh: Int): ByteArray {
    val out = ByteArray(dw * dh * 4)
    val xs = sw.toDouble() / dw
    val ys = sh.toDouble() / dh
    val acc = DoubleArray(4)
    for (dy in 0 until dh) {
      val y0 = dy * ys
      val y1 = min(sh.toDouble(), (dy + 1) * ys)
      val iy0 = y0.toInt()
      val iy1 = min(sh, ceil(y1).toInt())
      for (dx in 0 until dw) {
        val x0 = dx * xs
        val x1 = min(sw.toDouble(), (dx + 1) * xs)
        val ix0 = x0.toInt()
        val ix1 = min(sw, ceil(x1).toInt())
        acc.fill(0.0)
        var area = 0.0
        for (y in iy0 until iy1) {
          val wy = min((y + 1).toDouble(), y1) - max(y.toDouble(), y0)
          if (wy <= 0) continue
          var row = (y * sw + ix0) * 4
          for (x in ix0 until ix1) {
            val wx = min((x + 1).toDouble(), x1) - max(x.toDouble(), x0)
            if (wx > 0) {
              val wgt = wx * wy
              area += wgt
              acc[0] += (src[row].toInt() and 0xff) * wgt
              acc[1] += (src[row + 1].toInt() and 0xff) * wgt
              acc[2] += (src[row + 2].toInt() and 0xff) * wgt
              acc[3] += (src[row + 3].toInt() and 0xff) * wgt
            }
            row += 4
          }
        }
        val o = (dy * dw + dx) * 4
        if (area > 0) {
          for (c in 0 until 4) out[o + c] = min(255.0, Math.floor(acc[c] / area + 0.5)).toInt().toByte()
        }
      }
    }
    return out
  }
}
