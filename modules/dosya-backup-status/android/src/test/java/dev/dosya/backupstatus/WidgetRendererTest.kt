package dev.dosya.backupstatus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetRendererTest {
  private val palettes = ThemePair(
    light = Palette(bg = 1, ink = 2, mut = 3, track = 4, go = 5, bad = 6),
    dark = Palette(bg = 11, ink = 12, mut = 13, track = 14, go = 15, bad = 16),
  )

  private fun snap(
    phase: String = "idle", updatedAt: Long = 1_000, done: Int = 0, total: Int = 0,
    bytesPerSec: Long = 0, lastRunAt: Long? = null, lastRunCount: Int? = null,
    lastSpeedBps: Long? = null, used: Long? = null, total_: Long? = null,
  ) = Snapshot(phase, done, total, bytesPerSec, updatedAt, "ws", used, total_,
    lastRunAt, lastRunCount, lastSpeedBps, palettes)

  @Test fun `breakpoint switches at 180dp`() {
    assertEquals(WidgetSize.SMALL, WidgetRenderer.sizeFor(110))
    assertEquals(WidgetSize.SMALL, WidgetRenderer.sizeFor(179))
    assertEquals(WidgetSize.MEDIUM, WidgetRenderer.sizeFor(180))
    assertEquals(WidgetSize.MEDIUM, WidgetRenderer.sizeFor(320))
  }

  // An unreported size (0) must not blank the widget.
  @Test fun `breakpoint degrades to small on a missing size`() {
    assertEquals(WidgetSize.SMALL, WidgetRenderer.sizeFor(0))
  }

  @Test fun `palette follows system night mode`() {
    assertEquals(2, WidgetRenderer.paletteFor(palettes, nightMode = false).ink)
    assertEquals(12, WidgetRenderer.paletteFor(palettes, nightMode = true).ink)
  }

  // A run cannot still be live if we have not heard from the app in an hour.
  @Test fun `a running snapshot older than an hour counts as stale`() {
    assertTrue(WidgetRenderer.isStale(snap(phase = "uploading", updatedAt = 0), now = 3_601))
    assertFalse(WidgetRenderer.isStale(snap(phase = "uploading", updatedAt = 0), now = 3_599))
    assertFalse(WidgetRenderer.isStale(snap(phase = "idle", updatedAt = 0), now = 999_999))
  }

  @Test fun `running facts show progress and current speed`() {
    val f = WidgetRenderer.facts(
      snap(phase = "uploading", done = 3, total = 10, bytesPerSec = 1_048_576,
           used = 50, total_ = 100),
      running = true,
      palette = palettes.light,
      now = 1_000,
    )
    assertEquals(listOf("Free", "Used", "Progress", "Speed now"), f.map { it.label })
    assertEquals("3 / 10", f[2].value)
    assertEquals("1.0 MB/s", f[3].value)
  }

  @Test fun `idle facts show the last run`() {
    val f = WidgetRenderer.facts(
      snap(lastRunAt = 500, lastRunCount = 42, lastSpeedBps = 2_097_152,
           used = 50, total_ = 100),
      running = false,
      palette = palettes.light,
      now = 1_000,
    )
    assertEquals(listOf("Free", "Used", "Last backup", "Last speed"), f.map { it.label })
    // now = 1_000 and lastRunAt = 500 are both within the same calendar day of the epoch,
    // exercising Format.shortTime's "Today" branch with an injected (not wall-clock) now.
    assertTrue(f[2].value.startsWith("Today"))
    assertTrue(f[2].value.contains("42"))
    assertEquals("2.0 MB/s", f[3].value)
  }

  @Test fun `facts read as dashes when storage is unknown`() {
    val f = WidgetRenderer.facts(snap(), running = false, palette = palettes.light, now = 1_000)
    assertEquals("-", f[0].value)
    assertEquals("-", f[1].value)
  }

  // Mirrors iOS's FactCell accent rules (targets/backup-widget/index.swift): the "Free"
  // cell turns bad-red well above the 90% threshold, and stays the default ink colour
  // well below it. The exact boundary is asserted separately below.
  @Test fun `free fact is accented red well above 90 percent usage, not at 50`() {
    val high = WidgetRenderer.facts(snap(used = 95, total_ = 100), running = false, palette = palettes.light, now = 1_000)
    assertEquals(palettes.light.bad, high[0].accent)

    val low = WidgetRenderer.facts(snap(used = 50, total_ = 100), running = false, palette = palettes.light, now = 1_000)
    assertEquals(null, low[0].accent)
  }

  // The 0.9 boundary itself is the rule most likely to drift from iOS's `usedPct >= 0.9`
  // (targets/backup-widget/index.swift), so it's asserted exactly rather than only well
  // above/below it.
  @Test fun `free fact accent flips exactly at the 90 percent boundary`() {
    val atBoundary = WidgetRenderer.facts(snap(used = 90, total_ = 100), running = false, palette = palettes.light, now = 1_000)
    assertEquals(palettes.light.bad, atBoundary[0].accent)

    val justBelow = WidgetRenderer.facts(snap(used = 89, total_ = 100), running = false, palette = palettes.light, now = 1_000)
    assertEquals(null, justBelow[0].accent)
  }

  // iOS colours the "Progress" cell go-green only while a backup is running.
  @Test fun `progress fact is accented green while running`() {
    val f = WidgetRenderer.facts(
      snap(phase = "uploading", done = 1, total = 2, used = 50, total_ = 100),
      running = true,
      palette = palettes.light,
      now = 1_000,
    )
    assertEquals(palettes.light.go, f[2].accent)
  }
}
