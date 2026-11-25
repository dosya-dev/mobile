package dev.dosya.backupstatus

import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormatTest {
  @Test fun `formats bytes the way the iOS widget does`() {
    assertEquals("0 B", Format.gb(0))
    assertEquals("1.0 KB", Format.gb(1024))
    assertEquals("563.2 MB", Format.gb(590_558_003))
    assertEquals("5.0 GB", Format.gb(5_368_709_120))
  }

  @Test fun `formats speed per second`() {
    assertEquals("1.0 MB/s", Format.speed(1_048_576))
    assertEquals("-", Format.speed(0))
  }

  @Test fun `percent is null when the total is unknown`() {
    assertNull(Format.percent(100, null))
    assertNull(Format.percent(null, 100))
    assertNull(Format.percent(100, 0))
  }

  @Test fun `percent rounds down and clamps to 0 and 100`() {
    // Floors, matching iOS's Int(usedPct * 100) at targets/backup-widget/index.swift:213.
    // 590558003 / 5368709120 * 100 = 10.9999..., which iOS renders as 10%.
    assertEquals(10, Format.percent(590_558_003, 5_368_709_120))
    assertEquals(0, Format.percent(0, 100))
    assertEquals(100, Format.percent(200, 100))
    // Clamped at the low end too, so a negative `used` can't render a negative percentage.
    assertEquals(0, Format.percent(-100, 100))
  }

  @Test fun `short time shows a clock today and a dated clock on earlier days`() {
    val zone = TimeZone.getTimeZone("UTC")
    val locale = Locale.US

    fun epoch(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long {
      val cal = Calendar.getInstance(zone, locale)
      cal.clear()
      cal.set(year, month, day, hour, minute, 0)
      return cal.timeInMillis / 1000
    }

    // Earlier the same calendar day -> "Today <HH:mm>".
    val now = epoch(2026, Calendar.AUGUST, 5, 15, 4)
    val earlierToday = epoch(2026, Calendar.AUGUST, 5, 9, 30)
    assertTrue(Format.shortTime(earlierToday, now, locale, zone).startsWith("Today "))

    // A previous calendar day -> abbreviated month, day number, and a HH:mm clock - the
    // time is never dropped, unlike a relative "2d ago" scheme.
    val twoDaysAgo = epoch(2026, Calendar.AUGUST, 3, 15, 4)
    val result = Format.shortTime(twoDaysAgo, now, locale, zone)
    assertTrue(result.contains("Aug"))
    assertTrue(result.contains("3"))
    assertTrue(result.contains("15:04"))

    // A backup at 23:50 seen at 00:10 the next calendar day is NOT "Today", even though
    // it's only 20 minutes old - this must be a calendar-day check, not an age check.
    val lateNight = epoch(2026, Calendar.AUGUST, 4, 23, 50)
    val earlyMorningNow = epoch(2026, Calendar.AUGUST, 5, 0, 10)
    assertFalse(Format.shortTime(lateNight, earlyMorningNow, locale, zone).startsWith("Today"))
  }
}
