package dev.dosya.backupstatus

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object Format {
  private const val KB = 1024.0
  private val UNITS = listOf("B", "KB", "MB", "GB", "TB")

  fun gb(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    var value = bytes.toDouble()
    var unit = 0
    while (value >= KB && unit < UNITS.lastIndex) {
      value /= KB
      unit++
    }
    // Bytes are whole numbers (0 B); everything else keeps one fraction digit, matching
    // the app's own formatBytes (apps/mobile/src/lib/format.ts) and iOS's
    // ByteCountFormatter(.binary), which both show "563.2 MB" rather than rounding to "563 MB".
    return if (unit == 0) {
      String.format(Locale.US, "%.0f %s", value, UNITS[unit])
    } else {
      String.format(Locale.US, "%.1f %s", value, UNITS[unit])
    }
  }

  fun speed(bytesPerSec: Long): String =
    if (bytesPerSec <= 0) "-" else "${gb(bytesPerSec)}/s"

  fun percent(used: Long?, total: Long?): Int? {
    if (used == null || total == null || total <= 0) return null
    // Clamp both ends: the ring visually caps at 0-100%, so the text next to it must too,
    // or an over-quota workspace reads "105%" beside a ring that's visually full.
    return ((used.toDouble() / total) * 100).toInt().coerceIn(0, 100)
  }

  /**
   * Mirrors iOS's `whenString` (targets/backup-widget/index.swift): "Today <clock>" for a
   * timestamp earlier the same calendar day, otherwise "<abbreviated month> <day>, <clock>".
   * The clock is always present - unlike a relative "2d ago" scheme, this never silently
   * drops the time of day for anything older than 48h.
   *
   * "Same day" is a calendar-day comparison in `zone`, not an age-in-seconds comparison: a
   * backup at 23:50 seen at 00:10 the next day is a previous day, not "Today", even though
   * it's only 20 minutes old.
   */
  fun shortTime(
    unixSeconds: Long,
    now: Long = System.currentTimeMillis() / 1000,
    locale: Locale = Locale.getDefault(),
    zone: TimeZone = TimeZone.getDefault()
  ): String {
    val date = Date(unixSeconds * 1000)
    val calendar = Calendar.getInstance(zone, locale)

    calendar.time = date
    val day = calendar.get(Calendar.YEAR) * 1000 + calendar.get(Calendar.DAY_OF_YEAR)

    calendar.time = Date(now * 1000)
    val today = calendar.get(Calendar.YEAR) * 1000 + calendar.get(Calendar.DAY_OF_YEAR)

    val clock = SimpleDateFormat("HH:mm", locale).apply { timeZone = zone }.format(date)
    if (day == today) return "Today $clock"

    val monthDay = SimpleDateFormat("MMM d", locale).apply { timeZone = zone }.format(date)
    return "$monthDay, $clock"
  }
}
