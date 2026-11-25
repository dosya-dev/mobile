import { requireOptionalNativeModule } from "expo-modules-core";
import { getItem, setItem, deleteItem } from "@/lib/keychain";
import { useBackupRun } from "./runState";
import { useUploadStore } from "@/upload/store";
import { computeUploadStats } from "@/upload/stats";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useAppearance } from "@/theme/themeStore";
import { THEME_TOKENS } from "@/theme/tokens";
import { queryClient } from "@/lib/queryClient";
import type { WorkspaceStorage } from "@/files/api";
import { t as translate } from "@/lib/i18n";
import { backgroundUploadNative, type BackgroundUploadNative } from "../../modules/dosya-background-upload";

/**
 * Mirrors the backup engine's state to the iOS home-screen widget (App Group
 * snapshot + WidgetKit timeline reload) and drives the Live Activity while a
 * run is in flight. Pure observer: the engine knows nothing about it.
 *
 * The widget renders with the app's ACTIVE THEME: both scheme variants of the
 * theme's tokens ride in the snapshot, and a theme change forces an immediate
 * timeline reload, so the widget re-skins moments after the user switches.
 *
 * The native module ships only in dev-client/EAS builds that include
 * modules/dosya-backup-status - everywhere else this is a silent no-op.
 */
interface WidgetThemeColors {
  bg: string; // card surface
  ink: string; // foreground text
  mut: string; // muted text
  track: string; // meter/ring track
  go: string; // healthy/running (primary)
  bad: string; // paused / storage warning (destructive)
}

export interface BackupStatusSnapshot {
  phase: "idle" | "scanning" | "uploading";
  done: number;
  total: number;
  bytesPerSec: number;
  updatedAt: number; // unix seconds - lets the widget mark itself stale
  workspaceName: string | null;
  // Storage meter (null until the workspace-storage query has resolved once).
  storageUsed: number | null;
  storageTotal: number | null;
  // Last COMPLETED run - persisted, so they survive app restarts.
  lastRunAt: number | null; // unix seconds
  lastRunCount: number | null; // photos settled in that run
  lastSpeedBps: number | null; // best sustained speed seen in that run
  theme: { light: WidgetThemeColors; dark: WidgetThemeColors };
}

interface DosyaBackupStatusModule {
  setSnapshot(json: string): void;
  clearSnapshot?(): void;
  startActivity(workspaceName: string, total: number): void;
  updateActivity(done: number, total: number, bytesPerSec: number): void;
  endActivity(done: number, total: number): void;
  endAllActivities?(): void;
}

const WIDGET_THROTTLE_MS = 15_000; // WidgetKit reload budget is tight - be a good citizen
const ACTIVITY_THROTTLE_MS = 3_000;
const LAST_STATS_KEY = "dosya.backup.lastStats";

function widgetTheme(): BackupStatusSnapshot["theme"] {
  const id = useAppearance.getState().theme;
  const pick = (scheme: "light" | "dark"): WidgetThemeColors => {
    const t = THEME_TOKENS[id][scheme];
    return {
      bg: t.card,
      ink: t.foreground,
      mut: t.mutedForeground,
      track: t.secondary,
      go: t.primary,
      bad: t.destructive,
    };
  };
  return { light: pick("light"), dark: pick("dark") };
}

interface LastStats {
  lastRunAt: number | null;
  lastRunCount: number | null;
  lastSpeedBps: number | null;
}
let lastStats: LastStats = { lastRunAt: null, lastRunCount: null, lastSpeedBps: null };

/**
 * What iOS is carrying for us in its own background session. The orchestrator
 * only seeds ledger rows on that path and hands batches to the OS, so the JS
 * upload store never holds these and the run phase is idle once the scan is
 * done. Without this the bridge saw nothing moving and the lock screen showed
 * no Live Activity while a backup was plainly running.
 *
 * Counts are per session, from the transport's own events: `ok` / `failed`
 * from onJobFinished, `active` from pending(). A drained job leaves pending()
 * but stays in `ok`, so the total does not shrink as the settle runs.
 */
interface BackgroundJobs {
  active: number;
  ok: number;
  failed: number;
  bytesPerSec: number;
  lastSample: { bytesSent: number; at: number } | null;
}
const NO_BG: BackgroundJobs = { active: 0, ok: 0, failed: 0, bytesPerSec: 0, lastSample: null };
let bg: BackgroundJobs = { ...NO_BG };

async function hydrateLastStats(): Promise<void> {
  try {
    const raw = await getItem(LAST_STATS_KEY);
    if (raw) lastStats = { ...lastStats, ...(JSON.parse(raw) as LastStats) };
  } catch {
    /* no persisted stats - widget shows em-dashes */
  }
}

function persistLastStats(): void {
  try {
    void setItem(LAST_STATS_KEY, JSON.stringify(lastStats)).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/** Account purge (sign-out): the next account must not see this one's run stats. */
export async function clearWidgetLastStats(): Promise<void> {
  lastStats = { lastRunAt: null, lastRunCount: null, lastSpeedBps: null };
  await deleteItem(LAST_STATS_KEY);
}

/**
 * Account purge (sign-out): wipe the snapshot the home-screen widget renders
 * from. Without this the widget keeps showing the previous account's workspace
 * name and storage until the app next runs - visible on a locked device.
 */
export function clearWidgetSnapshot(): void {
  try {
    requireOptionalNativeModule<DosyaBackupStatusModule>("DosyaBackupStatus")?.clearSnapshot?.();
  } catch {
    /* best-effort - never block sign-out */
  }
}

/** In-process backup uploads only (the large-file fallback on iOS, everything on Android). */
function inProcessStats(now: number) {
  const { items, batchStartedAt, settledBk } = useUploadStore.getState();
  const bk = items.filter((i) => i.id.startsWith("bk_"));
  return computeUploadStats(bk, batchStartedAt, now, settledBk);
}

export function deriveSnapshot(now: number): BackupStatusSnapshot {
  const { phase, workspaceName } = useBackupRun.getState();
  const stats = inProcessStats(now);
  const activeId = useWorkspaceStore.getState().activeId;
  const storage = activeId
    ? queryClient.getQueryData<WorkspaceStorage | null>(["workspace-storage", activeId])
    : null;
  return {
    // Background jobs are a running backup even with the engine's phase idle.
    phase: phase === "idle" && bg.active > 0 ? "uploading" : phase,
    done: stats.doneCount + bg.ok,
    total: stats.totalCount + bg.ok + bg.failed + bg.active,
    // Only the transport is moving bytes: its own samples stand in.
    bytesPerSec: Math.round(stats.bytesPerSec > 0 ? stats.bytesPerSec : bg.bytesPerSec),
    updatedAt: Math.floor(now / 1000),
    workspaceName: workspaceName ?? null,
    storageUsed: storage?.used ?? null,
    storageTotal: storage?.total ?? null,
    lastRunAt: lastStats.lastRunAt,
    lastRunCount: lastStats.lastRunCount,
    lastSpeedBps: lastStats.lastSpeedBps,
    theme: widgetTheme(),
  };
}

let started = false;

type TransportEvents = Pick<BackgroundUploadNative, "pending" | "addListener">;

export function startStatusBridge(
  nativeOverride?: DosyaBackupStatusModule | null,
  now: () => number = Date.now,
  transportOverride?: TransportEvents | null,
): void {
  if (started) return;
  started = true;
  const native =
    nativeOverride !== undefined ? nativeOverride : requireOptionalNativeModule<DosyaBackupStatusModule>("DosyaBackupStatus");
  if (!native) return;
  const transport = transportOverride !== undefined ? transportOverride : backgroundUploadNative();

  // Sweep any Live Activity a killed app left stranded on the lock screen /
  // Dynamic Island - nothing legitimate can be live before we subscribe.
  try {
    native.endAllActivities?.();
  } catch {
    /* best-effort */
  }

  let lastWidgetPush = 0;
  let lastActivityUpdate = 0;
  let activityLive = false;
  let runPeakSpeed = 0;
  let lastPhase = useBackupRun.getState().phase;

  const onChange = (force = false) => {
    const t = now();
    let snap = deriveSnapshot(t);
    const phaseChanged = snap.phase !== lastPhase;
    lastPhase = snap.phase;

    // In-process: unfinished (or errored) items keep the run live. Background:
    // only jobs iOS still holds do - a failed job must not pin the activity
    // open forever, so the merged snapshot's total/done is not used here.
    const js = inProcessStats(t);
    const runActive = snap.phase !== "idle" || js.totalCount > js.doneCount || bg.active > 0;
    if (runActive && snap.bytesPerSec > 0) runPeakSpeed = Math.max(runPeakSpeed, snap.bytesPerSec);

    // A run just drained: freeze its outcome as the widget's "last backup" facts.
    if (!runActive && activityLive) {
      lastStats = {
        lastRunAt: Math.floor(t / 1000),
        lastRunCount: snap.done,
        lastSpeedBps: runPeakSpeed > 0 ? runPeakSpeed : lastStats.lastSpeedBps,
      };
      runPeakSpeed = 0;
      persistLastStats();
      snap = deriveSnapshot(t); // re-derive so the push below carries the fresh stats
      force = true; // the outcome should reach the widget immediately
    }

    // Widget: phase transitions / forced events (theme or workspace switch,
    // run outcome) refresh immediately; everything else is throttled.
    if (force || phaseChanged || t - lastWidgetPush >= WIDGET_THROTTLE_MS) {
      lastWidgetPush = t;
      try {
        native.setSnapshot(JSON.stringify(snap));
      } catch {
        /* widget refresh is best-effort */
      }
    }

    // Live Activity lifecycle: runs only while a backup is actually moving.
    try {
      if (runActive && !activityLive && snap.total > 0) {
        activityLive = true;
        lastActivityUpdate = t; // start counts as the first update for the throttle
        native.startActivity(snap.workspaceName ?? translate("common.label.workspace"), snap.total);
      } else if (runActive && activityLive && (phaseChanged || t - lastActivityUpdate >= ACTIVITY_THROTTLE_MS)) {
        lastActivityUpdate = t;
        native.updateActivity(snap.done, snap.total, snap.bytesPerSec);
      } else if (!runActive && activityLive) {
        activityLive = false;
        native.endActivity(snap.done, snap.total);
      }
    } catch {
      /* ActivityKit is best-effort (iOS 16.2+, user can disable) */
    }
    // The background session is over: the next one counts from zero.
    if (!runActive && bg.active === 0 && (bg.ok > 0 || bg.failed > 0 || bg.lastSample)) bg = { ...NO_BG };
  };

  if (transport) {
    let lastPendingRead = 0;
    const readPending = async () => {
      try {
        const jobs = await transport.pending();
        bg.active = jobs.filter((j) => j.state === "queued" || j.state === "running").length;
      } catch {
        /* the count keeps its last value; the next event asks again */
      }
      onChange();
    };
    transport.addListener("onJobFinished", (r) => {
      if (r.ok) bg.ok += 1;
      else bg.failed += 1;
      lastPendingRead = now();
      void readPending();
    });
    transport.addListener("onProgress", (p) => {
      const t = now();
      const prev = bg.lastSample;
      const elapsedSec = prev ? (t - prev.at) / 1000 : 0;
      if (prev && elapsedSec > 0) bg.bytesPerSec = Math.max(0, (p.bytesSent - prev.bytesSent) / elapsedSec);
      bg.lastSample = { bytesSent: p.bytesSent, at: t };
      // A freshly queued batch announces itself through progress before any
      // job finishes, so the active count is re-read here too, throttled.
      if (t - lastPendingRead >= ACTIVITY_THROTTLE_MS) {
        lastPendingRead = t;
        void readPending();
      } else {
        onChange();
      }
    });
    // Cold start: jobs iOS carried on while the app was dead are still live.
    void readPending();
  }

  useBackupRun.subscribe(() => onChange());
  useUploadStore.subscribe(() => onChange());
  // Theme or workspace switches re-skin / re-scope the widget - push straight away.
  useAppearance.subscribe(() => onChange(true));
  useWorkspaceStore.subscribe(() => onChange(true));

  // Cold start: restore the persisted last-run stats, then seed the widget.
  void hydrateLastStats().then(() => onChange(true));
}

// Test hook: allow re-wiring in specs.
export function __resetStatusBridge(): void {
  started = false;
  lastStats = { lastRunAt: null, lastRunCount: null, lastSpeedBps: null };
  bg = { ...NO_BG };
}
