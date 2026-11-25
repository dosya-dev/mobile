import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { countByStatus, type AssetStatus } from "@/backup/ledger";
import { deriveCoverage } from "@/backup/coverage";
import { countLibraryAssets, hasPhotoAccess, isPhotoAccessLimited } from "@/backup/scanner";
import { requestPhotoAccess } from "@/onboarding/permissions";
import { getBackupHistory, type BackupRunRecord } from "@/backup/history";
import { runBackup, stopBackup, clearManualStop } from "@/backup/orchestrator";
import { readPolicyInputs, backupHoldReason } from "@/backup/policy";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useUploadBlock, blockReasonText } from "@/upload/uploadBlock";
import { getLastRunAt, setLastRunAt, useBackupSettings, resolveBackupDestinations } from "@/backup/settings";
import { queuedJobCount } from "@/backup/transport/backgroundTransport";
import { backgroundUploadNative } from "../../modules/dosya-background-upload";
import { coverageSummary, DEFAULT_BACKUP_FILTERS } from "@/backup/filters";
import { coverageScope, coverageWarning } from "@/backup/ui/coverageScope";
import { useBackupRun } from "@/backup/runState";
import { useUploadStore } from "@/upload/store";
import { computeUploadStats } from "@/upload/stats";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { WorkspaceHeader } from "@/files/WorkspaceHeader";
import { useWorkspaces, useWorkspaceStorage, useRegions } from "@/files/hooks";
import { deriveEngineStatus } from "@/backup/ui/engineStatus";
import { CoverageRing, LIVE_COUNT_POLL_MS, type EngineButtonState } from "@/backup/ui/CoverageRing";
import { CoverageFigures } from "@/backup/ui/CoverageFigures";
import { StorageBar } from "@/backup/ui/StorageBar";
import { ActivityFeed } from "@/backup/ui/ActivityFeed";
import { AttentionList } from "@/backup/ui/AttentionList";
import { deriveAttention, type AttentionId } from "@/backup/ui/attention";
import { useNetworkKind } from "@/backup/ui/network";
import { useUnfinishedSetup } from "@/backup/ui/useUnfinishedSetup";
import { usePacing, backupCoolingDown, beginManualRunOverride, endManualRunSequence } from "@/upload/pacing";
import { usePlayerStore } from "@/player/playerStore";
import { MemoryDiag } from "@/backup/ui/MemoryDiag";
import { useOnboardingRefresh } from "@/onboarding/onboardingRefresh";
import { useAuthStore } from "@/auth/authStore";
import { writeOnboarding } from "@/onboarding/onboardingState";
import { byteCount } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";

type Counts = Record<AssetStatus, number>;
const ZERO: Counts = { pending: 0, queued: 0, uploaded: 0, skipped_large: 0, error: 0 };

export default function BackupScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaces();
  const storage = useWorkspaceStorage(activeId);
  // Where this workspace's files live. Read-only, and a statement about the
  // WORKSPACE rather than about this run: the location was chosen once when the
  // workspace was created and cannot move, and with several backup destinations
  // configured each one has its own. The catalog turns the stored code into a
  // city; it is cached for an hour and every file detail already asks for it,
  // so this costs no extra round trip.
  const regions = useRegions();
  const activeWorkspace = workspaces.data?.find((w) => w.id === activeId);
  const activeLocation = regions.data?.find((r) => r.code === activeWorkspace?.default_region);

  const items = useUploadStore((s) => s.items);
  const batchStartedAt = useUploadStore((s) => s.batchStartedAt);
  const phase = useBackupRun((s) => s.phase);
  const startedAt = useBackupRun((s) => s.startedAt);
  const autoBackup = useBackupSettings((s) => s.settings.autoBackup);
  const filters = useBackupSettings((s) => s.settings.filters);
  const filtersMigrated = useBackupSettings((s) => s.settings.filtersMigrated);
  const updateSettings = useBackupSettings((s) => s.update);

  const [counts, setCounts] = useState<Counts>(ZERO);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [history, setHistory] = useState<BackupRunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [limited, setLimited] = useState(false);
  // `null` until the first check resolves, so the photo row never flashes
  // for a user who already granted access.
  const [photoAccess, setPhotoAccess] = useState<boolean | null>(null);
  const [askingPhotos, setAskingPhotos] = useState(false);
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null);
  // The whole phone, unfiltered, so the ring can say how much its denominator
  // leaves out. One metadata page, like the filtered count.
  const [libraryAll, setLibraryAll] = useState<number | null>(null);
  // Jobs iOS is carrying in its own background session, past what the JS
  // upload store can see. Owned by the run state (the orchestrator seeds it as
  // it hands a run over, the background-upload events keep it current) and
  // re-read here too, so a cold start with jobs still live reads as running.
  const queuedJobs = useBackupRun((s) => s.backgroundJobs);
  const setQueuedJobs = useCallback((n: number) => useBackupRun.getState().setBackgroundJobs(n), []);
  // Aggregate bytes from the native side's throttled onProgress events, kept
  // only long enough to compute a speed between two samples.
  const bgProgressRef = useRef<{ bytesSent: number; at: number } | null>(null);
  const [bgStats, setBgStats] = useState<{ bytesPerSec: number; bytesSent: number; bytesTotal: number } | null>(null);
  const lastUnreadable = useBackupRun((s) => s.lastUnreadable);
  const blockReason = useUploadBlock((s) => blockReasonText(s, t));
  // The tiles and the engine button count down from the library: the ledger
  // only knows about the rows the throttled scan has reached (see coverage.ts).
  const coverage = deriveCoverage(counts, libraryTotal);

  // Ledger reads are issued from several places at once (the live poll, a
  // finished background job, a focus) and finish in no particular order. Only
  // the newest issued read may land: an older one arriving late pulled the
  // ring back by a few items and the next tick pushed it forward again.
  const countSeq = useRef({ issued: 0, applied: 0 });
  const readCounts = useCallback(async () => {
    const seq = ++countSeq.current.issued;
    const next = await countByStatus(activeId);
    if (seq < countSeq.current.applied) return;
    countSeq.current.applied = seq;
    setCounts(next);
  }, [activeId]);

  // What a finished background job changes: the ledger and the OS queue. The
  // full refresh below also counts the library twice and reads history and
  // the keychain, which per finished photo is far too much.
  const refreshLive = useCallback(async () => {
    await readCounts();
    setQueuedJobs(await queuedJobCount());
  }, [readCounts, setQueuedJobs]);

  const refresh = useCallback(async () => {
    await readCounts();
    setLastRun(await getLastRunAt());
    setHistory(await getBackupHistory());
    setLimited(await isPhotoAccessLimited());
    // Re-checked on every focus, not just at mount, so access granted or
    // revoked elsewhere (device Settings, the onboarding flow) is reflected
    // here instead of going stale.
    setPhotoAccess(await hasPhotoAccess());
    // Filtered, not the whole library: the ring is a promise about what this
    // backup covers, so its denominator has to be what the user selected.
    setLibraryTotal(await countLibraryAssets(filters));
    setLibraryAll(await countLibraryAssets(DEFAULT_BACKUP_FILTERS));
    setQueuedJobs(await queuedJobCount());
  }, [readCounts, setQueuedJobs, filters]);

  // The native session (iOS only; null on Android and in Jest - see
  // backgroundUploadNative). Subscribed once and disposed on unmount: a
  // second mount (or a re-run of this effect) would otherwise double-count
  // progress deltas against a stale previous sample.
  useEffect(() => {
    const native = backgroundUploadNative();
    if (!native) return;
    const progressSub = native.addListener("onProgress", (p) => {
      const now = Date.now();
      const prev = bgProgressRef.current;
      const elapsedSec = prev ? (now - prev.at) / 1000 : 0;
      const bytesPerSec = prev && elapsedSec > 0 ? Math.max(0, (p.bytesSent - prev.bytesSent) / elapsedSec) : 0;
      bgProgressRef.current = { bytesSent: p.bytesSent, at: now };
      setBgStats({ bytesPerSec, bytesSent: p.bytesSent, bytesTotal: p.bytesTotal });
    });
    // A nudge, not the source of truth: the ledger is what actually knows
    // what finished, so a job event just asks it to look.
    const finishedSub = native.addListener("onJobFinished", () => {
      void refreshLive().catch(() => {});
    });
    return () => {
      progressSub.remove();
      finishedSub.remove();
    };
  }, [refreshLive]);

  // A finished session's last speed must not leak into the next one: without
  // this, a fresh batch reads the previous session's bytesPerSec/ETA until
  // its own first onProgress sample lands (which, throttled to 2 Hz, can be
  // a visible beat later).
  useEffect(() => {
    if (queuedJobs === 0) {
      bgProgressRef.current = null;
      setBgStats(null);
    }
  }, [queuedJobs]);

  // Live capture is NOT started here. It used to be, which meant a new photo
  // only triggered a backup while this one screen happened to be focused; it
  // now runs for the whole signed-in session from the root layout
  // (startAutoBackupTriggers). Starting it here as well would double-fire.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const bk = items.filter((i) => i.id.startsWith("bk_"));
  const active = bk.filter((i) => i.status === "queued" || i.status === "uploading");
  // The phase is the owner of "running": on the iOS background transport it
  // stays "uploading" with nothing in the JS store until the OS queue drains.
  // The store and the queue count still count, for a run started elsewhere
  // (a relaunch with jobs still live has an idle phase).
  const isActive = phase !== "idle" || active.length > 0 || queuedJobs > 0;
  // Only the background transport is moving bytes right now: fall back to its
  // own throttled progress rather than the (empty) in-process stats.
  const usingBgStats = queuedJobs > 0 && active.length === 0;
  const bgBytesPerSec = bgStats?.bytesPerSec ?? 0;
  const bgEtaSec = bgStats && bgBytesPerSec > 0 ? (bgStats.bytesTotal - bgStats.bytesSent) / bgBytesPerSec : null;

  // Advance the cumulative-average speed clock between throttled progress
  // events while a run is active (same pattern as UploadDock).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);
  const settledBk = useUploadStore((s) => s.settledBk);
  const stats = computeUploadStats(bk, batchStartedAt, isActive ? nowTick : Date.now(), settledBk);

  // The ring is drawn from the ledger, which only changes as uploads settle;
  // re-read it while a run is live so the arc moves with the run instead of
  // jumping once at the end.
  useEffect(() => {
    if (!isActive || !activeId) return;
    const timer = setInterval(() => {
      // A read that fails (the scan holds the database briefly) keeps the last
      // good numbers; the next tick tries again.
      void readCounts().catch(() => {});
    }, LIVE_COUNT_POLL_MS);
    return () => clearInterval(timer);
  }, [isActive, activeId, readCounts]);

  // Within one run the arc only ever grows. The ledger can read lower for a
  // moment (a count taken between two writes, a workspace's rows settling
  // out of order) and a ring that steps back then forward reads as broken.
  // Idle, the raw figure shows, so a real drop (a workspace switch, rows
  // reset) is still visible.
  const highWater = useRef<{ key: string | null; max: number } | null>(null);
  let uploadedShown = coverage.uploaded;
  if (isActive) {
    const hw = highWater.current;
    if (hw && hw.key === activeId) {
      hw.max = Math.max(hw.max, coverage.uploaded);
      uploadedShown = hw.max;
    } else {
      highWater.current = { key: activeId, max: coverage.uploaded };
    }
  } else {
    highWater.current = null;
  }

  // When the run drains (uploads settle after runBackup resolved), pull fresh
  // ledger counts + history so the idle figures don't show mid-flight numbers.
  const wasActive = useRef(false);
  const refetchStorage = storage.refetch;
  useEffect(() => {
    if (wasActive.current && !isActive) {
      void refresh();
      void refetchStorage(); // quota moved - update the storage meter too
    }
    wasActive.current = isActive;
  }, [isActive, refresh, refetchStorage]);

  // Every folder switched off is a valid setting but a useless backup, so the
  // screen says so rather than sitting there reporting a healthy engine.
  const nothingSelected = filters.albumMode === "include" && filters.albumIds.length === 0;

  const bumpOnboardingRefresh = useOnboardingRefresh((s) => s.bump);
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const unfinishedSetup = useUnfinishedSetup();

  const thermal = usePacing((s) => s.thermal);
  const musicPlaying = usePlayerStore((s) => s.listening);
  // The live policy hold: same inputs the pump reads, so the ring says
  // "Paused - waiting for Wi-Fi" at the moment backup items stop moving.
  const netConnected = usePacing((s) => s.connected);
  const netOnWifi = usePacing((s) => s.onWifi);
  const netCharging = usePacing((s) => s.charging);
  const overrideWifi = usePacing((s) => s.policyOverride.wifi);
  const overrideCharging = usePacing((s) => s.policyOverride.charging);
  const wifiOnly = useBackupSettings((s) => s.settings.wifiOnly);
  const chargingOnly = useBackupSettings((s) => s.settings.chargingOnly);
  const holdReason = backupHoldReason(
    { wifiOnly: wifiOnly && !overrideWifi, chargingOnly: chargingOnly && !overrideCharging },
    { connected: netConnected, onWifi: netOnWifi, charging: netCharging },
  );
  const status = deriveEngineStatus({
    phase,
    hasActiveUploads: isActive,
    blocked: blockReason != null,
    autoBackup,
    coolingDown: backupCoolingDown(thermal, musicPlaying, overrideCharging),
    holdReason,
  });
  const networkKind = useNetworkKind(isActive);
  const [cellularConfirm, setCellularConfirm] = useState(false);
  const buttonState: EngineButtonState = !activeId
    ? "disabled"
    : isActive
      ? "running"
      : blockReason
        ? "paused"
        : "idle";

  // Why the ring's total is smaller than the phone, with the count and the
  // way to change it. Recomputed here rather than stored: two metadata reads.
  const excludedWarning = coverageWarning(filters, libraryAll, coverage.total);
  const attention = deriveAttention({
    unfinishedSetup: unfinishedSetup ? (unfinishedSetup.photoPermission === "denied" ? "denied" : "other") : null,
    photoAccess,
    limited,
    filtersMigrated,
    nothingSelected,
    excluded: excludedWarning ? { title: excludedWarning.title, detail: excludedWarning.detail } : null,
    blockReason,
    network: networkKind,
    runActive: isActive,
  });

  // The rationale the OS dialog cannot carry, on the one other screen that can
  // reach it. iOS shows that dialog once per install, so it fires from here
  // and from PhotoAccessStep - never from the ring below.
  const onAllowPhotos = async () => {
    if (askingPhotos) return;
    setAskingPhotos(true);
    try {
      const result = await requestPhotoAccess();
      setPhotoAccess(result !== "denied");
      if (result === "denied") {
        toast(t("backup.error.photoAccessIsOffYouCanTurnItOnInDeviceSettings"), "error");
      }
    } finally {
      setAskingPhotos(false);
      await refresh();
    }
  };

  // "Not now" is honoured, not forgotten. Clearing `skippedAt` alone does not
  // reach OnboardingGate - it is mounted above this whole navigator and only
  // re-reads state when `accountId` changes (see onboardingRefresh.ts).
  // Bumping the signal is what actually makes it look again; `router.replace`
  // just puts the user back at the root while that happens.
  const resumeSetup = async () => {
    if (!accountId) return;
    await writeOnboarding(accountId, { skippedAt: null });
    bumpOnboardingRefresh();
    router.replace("/");
  };

  const onBackupNow = async () => {
    if (!activeId || running) return;
    // runBackup -> scanAssets calls requestPermissionsAsync ITSELF, so before
    // this guard a manual start could fire the OS dialog cold, with no
    // rationale anywhere on screen - and burn iOS's single prompt from a
    // screen PhotoAccessStep's own comment says it must never fire from. The
    // photo step became skippable in this redesign, which is what created
    // this cohort. Route them to the rationale row instead.
    if (photoAccess === false) {
      toast(t("backup.error.allowPhotoAccessFirstSeeTheListAtTheTopOfThisScreen"), "error");
      return;
    }
    // Wi-Fi-only is a promise about mobile data. A manual tap on cellular gets
    // to break it, but only on purpose: ask first, and remember the answer for
    // this run alone (see beginManualRunOverride). A failed reading proceeds as a
    // plain manual run rather than blocking the button on a sensor.
    const inputs = await readPolicyInputs().catch(() => null);
    if (inputs && useBackupSettings.getState().settings.wifiOnly && inputs.connected && !inputs.onWifi) {
      setCellularConfirm(true);
      return;
    }
    await startManualRun(false);
  };

  const startManualRun = async (overMobileData: boolean) => {
    if (!activeId || running) return;
    useUploadBlock.getState().setReason(null); // manual retry clears any auto-backup pause
    clearManualStop(); // a manual start re-arms auto triggers after a manual stop
    setRunning(true);
    // A manual run never waits for a charger (it never has), and skips the
    // Wi-Fi hold only when the user just said so. Withdrawn in `finally`, so
    // the next automatic run is judged by the settings again.
    // Handed back when the run is really over - when its last upload settles,
    // NOT when runBackup resolves (that is the end of the SCAN, with the queue
    // still draining). See pacing.maybeWithdrawPolicyOverride.
    beginManualRunOverride(overMobileData);
    try {
      // One press backs up to EVERY configured destination, sequentially. Each
      // destination's files land in that workspace's own location, chosen when
      // it was created - there is nothing per-run to pass.
      const destinations = resolveBackupDestinations(activeId, useBackupSettings.getState().settings);
      for (const wsId of destinations) {
        const wsName = workspaces.data?.find((w) => w.id === wsId)?.name ?? null;
        await runBackup(wsId, wsName ?? undefined);
      }
      await setLastRunAt(Math.floor(Date.now() / 1000));
    } catch (e) {
      // A failed scan (e.g. offline) must not leave the engine stuck "scanning".
      useBackupRun.getState().idle();
      const msg = e instanceof Error ? e.message : t("sync.error.unknownError");
      toast(t("backup.error.backupFailedMsg", { msg }), "error");
    } finally {
      // Ends the SEQUENCE (every destination scanned). The permission itself
      // only lapses once nothing is left uploading.
      endManualRunSequence();
      setRunning(false);
      await refresh();
    }
  };

  const onEnginePress = () => {
    if (isActive) {
      stopBackup();
      void refresh();
    } else {
      void onBackupNow();
    }
  };

  const openFolderPicker = () => {
    // The one-time migration warning is cleared by any route into the picker,
    // never by the row merely existing (see the standing scope row below).
    if (!filtersMigrated) void updateSettings({ filtersMigrated: true });
    router.push("/backup-folders");
  };

  const onAttention = (id: AttentionId) => {
    switch (id) {
      case "finish-setup":
        void resumeSetup();
        return;
      case "photo-access":
        void onAllowPhotos();
        return;
      case "limited-access":
        void Linking.openSettings();
        return;
      case "nothing-selected":
      case "choose-what":
        openFolderPicker();
        return;
      case "excluded":
        if (excludedWarning?.target === "folders") openFolderPicker();
        else router.push("/backup-settings");
        return;
      case "blocked":
        onEnginePress();
        return;
      case "waiting-for-wifi":
        router.push("/backup-settings");
        return;
      default:
        return;
    }
  };

  return (
    // The workspace context bar doubles as this page's header - the backup
    // destination can be changed right here, same as on the Files tab.
    <Screen header={<WorkspaceHeader />} aboveTabBar>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <AttentionList items={attention} firstRun={lastRun == null} onPress={onAttention} />

        <CoverageRing
          status={status}
          buttonState={buttonState}
          // "Continue" only after a run has happened: a fresh install with a
          // full library has everything pending but nothing to continue.
          hasPending={coverage.pending > 0 && lastRun != null}
          onPress={onEnginePress}
          uploaded={uploadedShown}
          total={coverage.total}
          startedAt={startedAt}
          lastRun={lastRun}
          holdReason={holdReason}
          // Only the background transport moving bytes: its own throttled
          // samples stand in for the (empty) in-process stats.
          bytesPerSec={usingBgStats ? bgBytesPerSec : stats.bytesPerSec}
          etaSec={usingBgStats ? bgEtaSec : stats.etaSec}
          scope={coverageScope(filters, libraryAll, coverage.total)}
          onPressScope={() => router.push("/backup-settings")}
        />
        {__DEV__ ? <MemoryDiag /> : null}

        <CoverageFigures
          uploaded={uploadedShown}
          pending={coverage.pending}
          failed={counts.error}
          skipped={counts.skipped_large}
          onPressFailed={() => router.push("/backup-failed")}
        />
        {queuedJobs > 0 ? (
          <Text testID="backup-background-hint" className="mt-3 text-center text-xs text-muted-foreground">
            {t("backup.description.uploadingInTheBackgroundKeepDosyaDevInTheAppSwitcherAndPlugIn")}
          </Text>
        ) : null}

        <StorageBar used={storage.data?.used ?? 0} total={storage.data?.total ?? 0} />

        <View className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
          {activeWorkspace?.default_region ? (
            <View className="flex-row items-center gap-3 border-b border-border px-3 py-2.5">
              <Icon name="location" size={18} color={tokens.mutedForeground} />
              <Text testID="backup-location" className="flex-1 text-xs text-foreground">
                {/* The raw code while the catalog is still loading: a location the
                    user cannot read beats a line that appears a second late. */}
                {activeWorkspace.name} ·{" "}
                {activeLocation ? `${activeLocation.city}, ${activeLocation.country}` : activeWorkspace.default_region}
              </Text>
            </View>
          ) : null}
          {/* Always present: the only route into the folder picker from this
              screen. It used to be a banner whose wording changed once; the
              one-time warning now lives in the attention list above. */}
          <Pressable
            testID="choose-what-card"
            accessibilityRole="button"
            accessibilityLabel={t("backup.label.whatGetsBackedUp")}
            onPress={openFolderPicker}
            className="flex-row items-center gap-3 px-3 py-2.5"
          >
            <Icon name="options" size={18} color={tokens.mutedForeground} />
            <View className="flex-1">
              <Text className="text-xs font-semibold text-foreground">{t("backup.label.whatGetsBackedUp")}</Text>
              <Text testID="choose-what-summary" className="mt-0.5 text-xs text-muted-foreground">
                {coverageSummary(filters)}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={tokens.mutedForeground} />
          </Pressable>
        </View>

        {!isActive && lastUnreadable > 0 ? (
          <Text testID="backup-unreadable" className="mt-3 text-center text-xs text-muted-foreground">
            {/* iCloud is an iOS-only cause; on Android the asset is simply not
                readable (deleted under us, or outside the granted selection). */}
            {t("backup.error.countCouldnTBeReadPlatformSelectIosICloudDownloadOrAccessOtherFile", {
              count: byteCount(lastUnreadable),
              platform: Platform.OS === "ios" ? "ios" : "other",
            })}
          </Text>
        ) : null}

        <ActivityFeed phase={phase} items={bk} history={history} />
      </ScrollView>
      <ConfirmDialog
        visible={cellularConfirm}
        title={t("backup.heading.backUpOverMobileDataThisTime")}
        message={t("backup.description.wiFiOnlyIsOnThisRunWillUseMobileDataAutomaticBackupsKeep")}
        confirmLabel={t("backup.action.useMobileData")}
        onConfirm={() => {
          setCellularConfirm(false);
          void startManualRun(true);
        }}
        onCancel={() => setCellularConfirm(false)}
      />
    </Screen>
  );
}
