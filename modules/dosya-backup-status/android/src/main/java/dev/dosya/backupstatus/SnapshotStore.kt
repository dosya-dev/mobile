package dev.dosya.backupstatus

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

data class Palette(
  val bg: Int, val ink: Int, val mut: Int,
  val track: Int, val go: Int, val bad: Int,
)

data class ThemePair(val light: Palette, val dark: Palette)

data class Snapshot(
  val phase: String,
  val done: Int,
  val total: Int,
  val bytesPerSec: Long,
  val updatedAt: Long,
  val workspaceName: String?,
  val storageUsed: Long?,
  val storageTotal: Long?,
  val lastRunAt: Long?,
  val lastRunCount: Int?,
  val lastSpeedBps: Long?,
  val theme: ThemePair,
)

object SnapshotStore {
  private const val PREFS = "dosya.backupstatus"
  private const val KEY = "snapshot"

  fun write(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putString(KEY, json).apply()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().remove(KEY).apply()
  }

  fun read(context: Context): Snapshot? =
    parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null))

  /** Never throws: the caller renders inside the launcher's process. */
  fun parse(json: String?): Snapshot? {
    if (json.isNullOrBlank()) return null
    return try {
      val o = JSONObject(json)
      Snapshot(
        phase = o.optString("phase", "idle"),
        done = o.optInt("done", 0),
        total = o.optInt("total", 0),
        bytesPerSec = o.optLong("bytesPerSec", 0L),
        updatedAt = o.optLong("updatedAt", 0L),
        workspaceName = o.optStringOrNull("workspaceName"),
        storageUsed = o.optLongOrNull("storageUsed"),
        storageTotal = o.optLongOrNull("storageTotal"),
        lastRunAt = o.optLongOrNull("lastRunAt"),
        lastRunCount = o.optIntOrNull("lastRunCount"),
        lastSpeedBps = o.optLongOrNull("lastSpeedBps"),
        theme = parseTheme(o.optJSONObject("theme")),
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun parseTheme(o: JSONObject?): ThemePair = ThemePair(
    light = parsePalette(o?.optJSONObject("light"), fallbackInk = Color.BLACK, fallbackBg = Color.WHITE),
    dark = parsePalette(o?.optJSONObject("dark"), fallbackInk = Color.WHITE, fallbackBg = Color.BLACK),
  )

  private fun parsePalette(o: JSONObject?, fallbackInk: Int, fallbackBg: Int) = Palette(
    bg = color(o, "bg", fallbackBg),
    ink = color(o, "ink", fallbackInk),
    mut = color(o, "mut", fallbackInk),
    track = color(o, "track", Color.GRAY),
    go = color(o, "go", fallbackInk),
    bad = color(o, "bad", fallbackInk),
  )

  /** Unparseable colours must be opaque, never transparent - a transparent
   *  foreground renders as an invisible widget rather than an obvious bug. */
  private fun color(o: JSONObject?, key: String, fallback: Int): Int {
    val raw = o?.optStringOrNull(key) ?: return fallback
    return try {
      Color.parseColor(raw)
    } catch (_: IllegalArgumentException) {
      fallback
    }
  }

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key, "").ifBlank { null }

  private fun JSONObject.optLongOrNull(key: String): Long? =
    if (isNull(key) || !has(key)) null else optLong(key)

  private fun JSONObject.optIntOrNull(key: String): Int? =
    if (isNull(key) || !has(key)) null else optInt(key)
}
