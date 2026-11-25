package dev.dosya.backupstatus

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import kotlin.math.min
import kotlin.math.roundToInt

object RingRenderer {
  const val MAX_SIZE_PX = 512
  private const val STROKE_RATIO = 0.12f

  fun sweepDegrees(fraction: Float): Float {
    if (fraction.isNaN()) return 0f
    return fraction.coerceIn(0f, 1f) * 360f
  }

  fun sizePx(cellDp: Int, density: Float): Int =
    min(MAX_SIZE_PX, (cellDp * density).roundToInt())

  fun render(sizePx: Int, fraction: Float, trackColor: Int, progressColor: Int): Bitmap {
    val size = sizePx.coerceIn(1, MAX_SIZE_PX)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val stroke = size * STROKE_RATIO
    val inset = stroke / 2f
    val bounds = RectF(inset, inset, size - inset, size - inset)

    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = stroke
      strokeCap = Paint.Cap.ROUND
    }

    paint.color = trackColor
    canvas.drawArc(bounds, 0f, 360f, false, paint)

    val sweep = sweepDegrees(fraction)
    if (sweep > 0f) {
      paint.color = progressColor
      canvas.drawArc(bounds, -90f, sweep, false, paint)
    }
    return bitmap
  }
}
