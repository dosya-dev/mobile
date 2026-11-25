import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useBackupSettings } from "@/backup/settings";
import { DEFAULT_BACKUP_FILTERS, type BackupMediaType } from "@/backup/filters";
import { ensureAlbumDefaults } from "@/backup/albumDefaults";
import { useWorkspaceStorage } from "@/files/hooks";
import { formatBytes } from "@/lib/format";
import { formatNumber } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { estimateLibrary, formatEstimate, type LibraryEstimate } from "../librarySize";
import { StepScreen } from "../ui/StepScreen";

const DAY = 86_400;

/**
 * `null` in `LibraryEstimate | null` was ambiguous: it meant both "nothing
 * has resolved yet" (still loading) and "the fetch resolved, but there is no
 * permission to estimate from" (genuinely unavailable). Those need different
 * copy - the first is temporary and will get a number; the second will not,
 * and saying "Checking your library…" forever about it would be a lie.
 */
type EstimateStatus =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; estimate: LibraryEstimate };

/** `labelKey` is a message key, not text: the label is produced at render so it follows the language. */
export const DATE_RANGES: { key: "all" | "12mo" | "today"; labelKey: MessageKey; floor: () => number | null }[] = [
  { key: "all", labelKey: "onboarding.label.allTime", floor: () => null },
  { key: "12mo", labelKey: "onboarding.label.12Months", floor: () => Math.floor(Date.now() / 1000) - 365 * DAY },
  { key: "today", labelKey: "onboarding.label.fromToday", floor: () => Math.floor(Date.now() / 1000) },
];

/**
 * The screen that names the storage constraint BEFORE it becomes a failure.
 * Without it, backup runs until the workspace fills and surfaces much later as
 * a fatal upload block, which is the worst possible moment to learn the limit.
 */
export function ChooseStep({
  workspaceId, limited, onDone, onSkip,
}: {
  workspaceId: string | null;
  /** True when the OS granted partial access, so the counts below cover only
   * the assets the user hand-picked. Saying so here prevents "why is it only
   * backing up 12 photos?" later. */
  limited: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const storage = useWorkspaceStorage(workspaceId);
  const [media, setMedia] = useState<BackupMediaType[]>(["photo", "video"]);
  const [range, setRange] = useState<"all" | "12mo" | "today">("12mo");
  const [estStatus, setEstStatus] = useState<EstimateStatus>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  // `busy` (state) drives the button's visible loading/disabled look, but a state
  // update only becomes visible on the *next* render - it can't stop a second call
  // that lands in the same tick as the first, before that render has happened. A
  // ref is mutated in place and read back immediately, so it closes that gap too.
  // Same pattern as WorkspaceStep.tsx.
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    const floor = DATE_RANGES.find((r) => r.key === range)?.floor() ?? null;
    void estimateLibrary({ ...DEFAULT_BACKUP_FILTERS, mediaTypes: media, dateFloor: floor }).then((r) => {
      // `alive` is scoped to this one effect run. React tears down the previous
      // run's cleanup (which flips it to false) before a new run starts on a
      // dependency change, and again on unmount - so a slow, superseded call can
      // never land after a newer one and overwrite it, and neither can ever set
      // state once this screen is gone.
      if (!alive) return;
      // A resolved `null` (no permission) is "unavailable", not "still
      // loading" - the two need different copy below. A prior "ready" result
      // is intentionally left on screen while a re-estimate is in flight
      // (no reset to "loading" here), so switching a toggle never flickers
      // the counts back to a placeholder while the new sample is fetched.
      setEstStatus(r ? { kind: "ready", estimate: r } : { kind: "unavailable" });
    });
    return () => {
      alive = false;
    };
  }, [media, range]);

  const est = estStatus.kind === "ready" ? estStatus.estimate : null;
  const planTotal = storage.data?.total ?? null;
  // Only a real estimate against a real plan size can justify the warning. A
  // missing sample or an unknown plan total means we say nothing rather than
  // invent a limit - this is never allowed to fall back to a hardcoded figure.
  const overflows = est?.estimatedBytes != null && planTotal != null && est.estimatedBytes > planTotal;

  const toggle = (type: BackupMediaType) =>
    setMedia((cur) => (cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type]));

  const onStart = async () => {
    if (inFlight.current || media.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    try {
      // filtersMigrated MUST be written before ensureAlbumDefaults runs.
      // ensureAlbumDefaults early-returns unless that flag is already true -
      // and latches albumDefaultsApplied on the way out, so it can never run
      // again. With the old order it saw `false` for any account whose
      // in-memory settings had been reset (sign out, then sign in as a
      // different account in the same process: resetBackupSettings puts
      // filtersMigrated back to false and hydrate() only runs at app mount),
      // so the Android camera-roll narrowing never happened and never could -
      // every backup then covered ALL of MediaStore: WhatsApp media,
      // screenshots, Telegram caches, Downloads.
      await useBackupSettings.getState().update({
        filtersMigrated: true,
        wifiOnly: true,
        chargingOnly: false,
      });
      // Android needs the camera-bucket ids resolved before the first run, or it
      // backs up every app's media instead of just the camera roll. It may set
      // filtersMigrated back to false itself (fail-open, when no bucket is
      // recognisable as a camera roll) - another reason it has to run after
      // the write above rather than before it.
      await ensureAlbumDefaults();
      await useBackupSettings.getState().updateFilters({
        mediaTypes: media,
        dateFloor: DATE_RANGES.find((r) => r.key === range)?.floor() ?? null,
      });
      onDone();
    } catch (e) {
      // There was no catch here at all, so a throw from any of the three left
      // "Start backup" doing nothing forever: the spinner stopped, onDone
      // never fired, and nothing on screen said why.
      toast(e instanceof Error ? e.message : t("onboarding.error.couldnTSaveYourBackupChoices"), "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const counts =
    estStatus.kind === "ready"
      ? t("onboarding.description.photosPhotosVideosVideosHasSizeSelectTrueAboutSizeOther", {
          photos: formatNumber(estStatus.estimate.photos),
          videos: formatNumber(estStatus.estimate.videos),
          hasSize: String(estStatus.estimate.estimatedBytes != null),
          size: estStatus.estimate.estimatedBytes != null ? formatBytes(estStatus.estimate.estimatedBytes) : "",
        })
      : estStatus.kind === "unavailable"
        ? t("onboarding.error.weCouldnTCheckYourLibraryRightNowYouCanStillChooseWhatTo")
        : t("onboarding.label.checkingYourLibrary");

  /**
   * The running total, pinned beside the action so it stays visible while the
   * toggles above it change the selection. The size keeps its hedge - it is
   * extrapolated from a sample - while the plan size is a measured figure and
   * is printed bare.
   */
  const selected =
    estStatus.kind === "ready" && estStatus.estimate.estimatedBytes != null && planTotal != null
      ? t("onboarding.label.selectedEstimateOfTotalSize", {
        estimate: formatEstimate(estStatus.estimate.estimatedBytes),
        totalSize: formatBytes(planTotal),
      })
      : undefined;

  return (
    <StepScreen
      step={3}
      testID="onboarding-choose"
      title={t("onboarding.heading.chooseWhatGetsBackedUp")}
      subtitle={counts}
      primaryLabel={t("common.action.startBackup")}
      onPrimary={() => { void onStart(); }}
      primaryLoading={busy}
      primaryDisabled={media.length === 0}
      secondaryLabel={t("onboarding.action.skipForNow")}
      onSecondary={onSkip}
      footnote={selected}
    >
      {limited ? (
        <View className="mb-5 rounded-2xl border border-border bg-card p-4">
          <Text className="text-xs leading-5 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("onboarding.description.theAppHasAccessToOnlyThePhotosYouSelectedSoTheseCountsCover")}
          </Text>
        </View>
      ) : null}

      {overflows && planTotal != null ? (
        <View testID="storage-warning" className="mb-5 rounded-2xl border border-destructive/40 bg-card p-4">
          <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>
            {t("onboarding.label.thatIsMoreThanYourPlanHolds")}
          </Text>
          <Text className="mt-1 text-xs leading-5 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("onboarding.description.yourPlanHoldsSizeNarrowTheSelectionBelowOrAddStorage", { size: formatBytes(planTotal) })}
          </Text>
        </View>
      ) : null}

      <View className="rounded-2xl border border-border bg-card">
        {(["photo", "video"] as const).map((type, i) => {
          const checked = media.includes(type);
          const label = type === "photo" ? t("onboarding.action.backUpPhotos") : t("onboarding.action.backUpVideos");
          return (
            <View key={type} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <Icon name={type === "photo" ? "images" : "videocam"} size={19} color={tokens.foreground} />
              <Text className="flex-1 text-base text-foreground" style={{ fontFamily: fonts.medium }}>
                {type === "photo" ? t("common.label.photos") : t("common.label.videos")}
              </Text>
              <Pressable
                testID={`toggle-${type}`}
                accessibilityRole="switch"
                accessibilityLabel={label}
                accessibilityState={{ checked }}
                onPress={() => toggle(type)}
                hitSlop={8}
                className={`h-7 w-12 justify-center rounded-full px-0.5 ${checked ? "bg-primary" : "bg-input"}`}
              >
                <View className={`h-6 w-6 rounded-full bg-card ${checked ? "self-end" : "self-start"}`} />
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text className="mb-2 mt-6 text-base text-foreground" style={{ fontFamily: fonts.medium }}>{t("onboarding.label.howFarBack")}</Text>
      <View className="flex-row gap-1 rounded-xl bg-secondary p-1">
        {DATE_RANGES.map((r) => {
          const selected = range === r.key;
          return (
            <Pressable
              key={r.key}
              testID={`range-${r.key}`}
              accessibilityRole="button"
              accessibilityLabel={t(r.labelKey)}
              accessibilityState={{ selected }}
              onPress={() => setRange(r.key)}
              className={`flex-1 items-center rounded-lg py-2.5 ${selected ? "bg-card" : ""}`}
            >
              <Text
                className={`text-sm ${selected ? "text-foreground" : "text-muted-foreground"}`}
                style={{ fontFamily: fonts.medium }}
              >
                {t(r.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </StepScreen>
  );
}
