package dev.dosya.backupstatus

import android.app.PendingIntent
import android.content.Context
import android.widget.RemoteViews

enum class WidgetSize { SMALL, MEDIUM }

data class Fact(val label: String, val value: String, val accent: Int? = null)

object WidgetRenderer {
  private const val MEDIUM_MIN_WIDTH_DP = 180
  private const val STALE_AFTER_SECONDS = 3_600L

  fun sizeFor(minWidthDp: Int): WidgetSize =
    if (minWidthDp >= MEDIUM_MIN_WIDTH_DP) WidgetSize.MEDIUM else WidgetSize.SMALL

  fun paletteFor(theme: ThemePair, nightMode: Boolean): Palette =
    if (nightMode) theme.dark else theme.light

  fun isStale(snapshot: Snapshot, now: Long): Boolean =
    snapshot.phase != "idle" && (now - snapshot.updatedAt) > STALE_AFTER_SECONDS

  fun facts(snapshot: Snapshot, running: Boolean, palette: Palette, now: Long): List<Fact> {
    val total = snapshot.storageTotal
    val used = snapshot.storageUsed ?: 0L
    val free = if (total == null) "-" else Format.gb((total - used).coerceAtLeast(0))
    val usedStr = if (total == null) "-" else "${Format.gb(used)} / ${Format.gb(total)}"
    // Mirrors iOS's `usedPct >= 0.9` rule (targets/backup-widget/index.swift). Computed from
    // the raw Long fields rather than Format.percent, which floors to a clamped Int and would
    // disagree with iOS's Double comparison right at the 0.9 boundary.
    val freeAccent = if (total != null && total > 0 && used.toDouble() / total >= 0.9) {
      palette.bad
    } else {
      null
    }

    val tail = if (running) {
      listOf(
        Fact("Progress", "${snapshot.done} / ${snapshot.total}", palette.go),
        Fact("Speed now", Format.speed(snapshot.bytesPerSec)),
      )
    } else {
      val last = snapshot.lastRunAt?.let { at ->
        Format.shortTime(at, now) + (snapshot.lastRunCount?.let { " · ✓$it" } ?: "")
      } ?: "-"
      listOf(
        Fact("Last backup", last),
        Fact("Last speed", snapshot.lastSpeedBps?.let { Format.speed(it) } ?: "-"),
      )
    }
    return listOf(Fact("Free", free, freeAccent), Fact("Used", usedStr)) + tail
  }

  fun build(
    context: Context,
    snapshot: Snapshot?,
    size: WidgetSize,
    nightMode: Boolean,
    now: Long,
  ): RemoteViews {
    val layout = if (size == WidgetSize.MEDIUM) {
      R.layout.widget_backup_medium
    } else {
      R.layout.widget_backup_small
    }
    val views = RemoteViews(context.packageName, layout)

    if (snapshot == null) {
      // Neutral chrome: no snapshot means no theme either. The placeholder has no
      // opaque background of its own, so the real content must be hidden too or
      // the header/ring/captions would show through behind the placeholder text.
      views.setInt(R.id.card, "setColorFilter", android.graphics.Color.WHITE)
      views.setViewVisibility(R.id.content, android.view.View.GONE)
      views.setViewVisibility(R.id.placeholder, android.view.View.VISIBLE)
      // The card tints to white above, and white text-on-white (RemoteViews inflate
      // against a DayNight theme, which can default this TextView near-white in dark
      // mode) would make the placeholder invisible. Force black explicitly.
      views.setTextColor(R.id.placeholder, android.graphics.Color.BLACK)
      setLaunchIntent(context, views)
      return views
    }

    val p = paletteFor(snapshot.theme, nightMode)
    val running = !isStale(snapshot, now) && snapshot.phase != "idle"

    views.setViewVisibility(R.id.content, android.view.View.VISIBLE)
    views.setViewVisibility(R.id.placeholder, android.view.View.GONE)
    views.setInt(R.id.card, "setColorFilter", p.bg)

    // iOS's small widget shows the header as "dosya.dev" only, with no workspace
    // suffix (targets/backup-widget/index.swift's BackupWidgetSmallView) - only
    // medium gets the " · <workspace>" suffix.
    val header = if (size == WidgetSize.MEDIUM) {
      "dosya.dev" + (snapshot.workspaceName?.let { " · $it" } ?: "")
    } else {
      "dosya.dev"
    }
    views.setTextViewText(R.id.header, header)
    views.setTextColor(R.id.header, p.mut)

    val pct = Format.percent(snapshot.storageUsed, snapshot.storageTotal)
    views.setTextViewText(R.id.ring_pct, pct?.let { "$it%" } ?: "-")
    views.setTextColor(R.id.ring_pct, p.ink)
    views.setTextColor(R.id.ring_sub, p.mut)

    val fraction = (pct ?: 0) / 100f
    val ringDp = if (size == WidgetSize.MEDIUM) 72 else 64
    val density = context.resources.displayMetrics.density
    views.setImageViewBitmap(
      R.id.ring,
      RingRenderer.render(
        sizePx = RingRenderer.sizePx(ringDp, density),
        fraction = fraction,
        trackColor = p.track,
        progressColor = if (pct != null && pct >= 90) p.bad else p.go,
      ),
    )

    if (size == WidgetSize.MEDIUM) {
      views.setTextViewText(R.id.pill, if (running) "Backing up" else "Protected")
      views.setTextColor(R.id.pill, if (running) p.go else p.mut)

      val f = facts(snapshot, running, p, now)
      val labelIds = intArrayOf(R.id.fact1_label, R.id.fact2_label, R.id.fact3_label, R.id.fact4_label)
      val valueIds = intArrayOf(R.id.fact1_value, R.id.fact2_value, R.id.fact3_value, R.id.fact4_value)
      f.forEachIndexed { i, fact ->
        views.setTextViewText(labelIds[i], fact.label)
        views.setTextColor(labelIds[i], p.mut)
        views.setTextViewText(valueIds[i], fact.value)
        views.setTextColor(valueIds[i], fact.accent ?: p.ink)
      }
    } else {
      views.setTextViewText(R.id.status, if (running) "Backing up" else "Protected")
      views.setTextColor(R.id.status, p.ink)
      views.setTextViewText(
        R.id.last_time,
        snapshot.lastRunAt?.let { Format.shortTime(it, now) } ?: "",
      )
      views.setTextColor(R.id.last_time, p.mut)
    }
    setLaunchIntent(context, views)
    return views
  }

  /** Tapping the widget opens the app. Silently skipped if the launcher intent is
   *  unavailable rather than throwing - this runs in the launcher's process. */
  private fun setLaunchIntent(context: Context, views: RemoteViews) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    if (launch != null) {
      views.setOnClickPendingIntent(
        R.id.card,
        PendingIntent.getActivity(
          context, 0, launch,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )
    }
  }
}
