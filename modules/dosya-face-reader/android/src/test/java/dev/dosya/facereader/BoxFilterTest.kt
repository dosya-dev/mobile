package dev.dosya.facereader

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class BoxFilterTest {
  private fun px(r: Int, g: Int, b: Int, a: Int) = byteArrayOf(r.toByte(), g.toByte(), b.toByte(), a.toByte())

  @Test
  fun fourByFourToTwoByTwoAveragesEachBlock() {
    // Each 2x2 block holds the values v, v+10, v+20, v+30 in every channel.
    val src = ByteArray(4 * 4 * 4)
    val base = intArrayOf(0, 40, 100, 200) // top-left, top-right, bottom-left, bottom-right blocks
    for (y in 0 until 4) for (x in 0 until 4) {
      val block = (y / 2) * 2 + (x / 2)
      val v = base[block] + ((y % 2) * 2 + (x % 2)) * 10
      px(v, v, v, 255 - v).copyInto(src, (y * 4 + x) * 4)
    }
    val out = BoxFilter.shrink(src, 4, 4, 2, 2)
    // mean of v..v+30 is v+15
    val expected = base.flatMap { b -> listOf(b + 15, b + 15, b + 15, 255 - (b + 15)) }.map { it.toByte() }.toByteArray()
    assertArrayEquals(expected, out)
  }

  @Test
  fun fractionalFootprintsWeightPartialPixels() {
    // 3x1 -> 2x1: dst0 covers src0 + half of src1, dst1 covers half of src1 + src2.
    val src = px(0, 0, 0, 255) + px(90, 90, 90, 255) + px(240, 240, 240, 255)
    val out = BoxFilter.shrink(src, 3, 1, 2, 1)
    // dst0 = (0*1 + 90*0.5)/1.5 = 30 ; dst1 = (90*0.5 + 240*1)/1.5 = 190
    assertArrayEquals(px(30, 30, 30, 255) + px(190, 190, 190, 255), out)
  }

  @Test
  fun halfwayMeansRoundUp() {
    // 2x1 -> 1x1: mean of 10 and 11 is exactly 10.5, which rounds to 11 on both platforms
    // (half to even would give 10); 3 and 4 -> 3.5 -> 4 (half to even also 4).
    val src = px(10, 3, 0, 255) + px(11, 4, 1, 254)
    assertArrayEquals(px(11, 4, 1, 255), BoxFilter.shrink(src, 2, 1, 1, 1))
  }

  @Test
  fun uniformImageStaysUniform() {
    val src = ByteArray(7 * 5 * 4) { 77 }
    val out = BoxFilter.shrink(src, 7, 5, 3, 2)
    assertEquals(3 * 2 * 4, out.size)
    assertEquals(true, out.all { it == 77.toByte() })
  }

  @Test
  fun workingSizeCapsTheLongSide() {
    assertEquals(Pair(1600, 900), Decode.workingSize(3200, 1800, 1600))
    assertEquals(Pair(900, 1600), Decode.workingSize(1800, 3200, 1600))
    assertEquals(Pair(1000, 800), Decode.workingSize(1000, 800, 1600))
    assertEquals(Pair(1600, 1), Decode.workingSize(100000, 60, 1600))
  }
}
