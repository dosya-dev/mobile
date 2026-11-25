package dev.dosya.backupstatus

import org.junit.Assert.assertEquals
import org.junit.Test

class RingRendererTest {
  @Test fun `sweep spans the full circle at 1_0`() {
    assertEquals(360f, RingRenderer.sweepDegrees(1f), 0.001f)
  }

  @Test fun `sweep is zero at 0`() {
    assertEquals(0f, RingRenderer.sweepDegrees(0f), 0.001f)
  }

  @Test fun `sweep is proportional in between`() {
    assertEquals(90f, RingRenderer.sweepDegrees(0.25f), 0.001f)
  }

  // A snapshot can report used > total (quota lowered after an upload); the ring
  // must cap rather than wrap around and read as nearly-empty.
  @Test fun `sweep clamps out of range fractions`() {
    assertEquals(360f, RingRenderer.sweepDegrees(1.4f), 0.001f)
    assertEquals(0f, RingRenderer.sweepDegrees(-0.2f), 0.001f)
    assertEquals(0f, RingRenderer.sweepDegrees(Float.NaN), 0.001f)
  }

  // Bitmaps live in the launcher's process; an unbounded cell must not produce
  // an unbounded allocation.
  @Test fun `size scales with density and is capped`() {
    assertEquals(144, RingRenderer.sizePx(72, 2f))
    assertEquals(RingRenderer.MAX_SIZE_PX, RingRenderer.sizePx(2000, 4f))
  }
}
