import { useEffect, useRef, useState } from "react";
import { Animated as RNAnimated, Easing, Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Icon, type IconName } from "@/ui/Icon";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatDuration, formatElapsed, formatSpeed, formatWhen } from "@/lib/format";
import { byteCount } from "@/lib/format-locale";
import { t, useT } from "@/lib/i18n";
import { engineLabel, type EngineStatus } from "./engineStatus";

export type EngineButtonState = "idle" | "running" | "paused" | "disabled";

/**
 * The coverage number made visible, with the engine control inside it. The
 * one thing you tap and the one thing you want to know are the same object.
 */
export const RING_SIZE = 200;

/** How often the screen re-reads the ledger while a run is live, so the arc
 * moves with the run. One GROUP BY on SQLite; the library count (the
 * expensive read) is NOT repeated. */
export const LIVE_COUNT_POLL_MS = 3_000;
export const RING_STROKE = 10;
const STROKE = RING_STROKE;
const RADIUS = (RING_SIZE - STROKE) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;
export const CORE_SIZE = RING_SIZE - STROKE * 2 - 24; // the pressable disc inside the ring
const CORE = CORE_SIZE;
/** How long the arc takes to reach a new fill. The ledger is re-read every
 * LIVE_COUNT_POLL_MS while a run is live, so the fill arrives in steps; drawn
 * directly each step was a jump, which users read as the ring stuttering. */
export const ARC_MS = 450;
const AnimatedCircle = RNAnimated.createAnimatedComponent(Circle);
const GLYPH = 40;
const FRAME = RING_SIZE + 40; // room for the halos, which overshoot at low opacity

// One expanding-and-fading halo circle. Mounted only while running, so the
// loop costs nothing when the engine is idle.
function Halo({ color, delayMs }: { color: string; delayMs: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delayMs, withRepeat(withTiming(1, { duration: 2000 }), -1, false));
    return () => cancelAnimation(progress);
  }, [progress, delayMs]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.45 }],
    opacity: 0.3 * (1 - progress.value),
  }));
  return (
    <Animated.View
      testID="engine-halo"
      pointerEvents="none"
      style={[
        { position: "absolute", width: CORE, height: CORE, borderRadius: CORE / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

function iconFor(status: EngineStatus, buttonState: EngineButtonState): IconName {
  if (buttonState === "running") return "pause";
  if (buttonState === "paused") return "refresh";
  if (buttonState === "disabled") return "play";
  return status === "protected" ? "shield-checkmark" : "play";
}

function headline(uploaded: number, total: number | null): string {
  if (total != null && total > 0) {
    return t("backup.label.minOfTotalProtected", { min: byteCount(Math.min(uploaded, total)), total: byteCount(total) });
  }
  if (uploaded > 0) return t("backup.label.uploadedBackedUp", { uploaded: byteCount(uploaded) });
  return t("backup.label.nothingBackedUpYet");
}

// Stand-ins for the live figures while the caption message is formatted, so
// each figure can be wrapped in its own <Text testID> afterwards without
// splitting the sentence into translated fragments.
const MARK = { speed: "\u0001speed\u0002", eta: "\u0001eta\u0002", elapsed: "\u0001elapsed\u0002" } as const;
const CAPTION_SEPARATOR = " \u00b7 ";
const MARK_IDS = { speed: "stat-speed", eta: "stat-eta", elapsed: "engine-time" } as const;

/**
 * The running caption: one translated message ("Tap to stop · 15.8 MB/s · 2m
 * left · 00:00:10") whose " · " parts that carry a figure become their own
 * <Text> so the speed, the time left and the elapsed clock stay addressable.
 * A language that joins the parts differently still renders in full, just
 * without the inner wrappers.
 */
function runningCaption(message: string, values: Record<keyof typeof MARK, string>) {
  const fill = (s: string) =>
    (Object.keys(MARK) as (keyof typeof MARK)[]).reduce((acc, k) => acc.split(MARK[k]).join(values[k]), s);
  const [lead, ...rest] = message.split(CAPTION_SEPARATOR);
  return (
    <>
      {fill(lead)}
      {rest.map((seg, i) => {
        const id = (Object.keys(MARK) as (keyof typeof MARK)[]).find((k) => seg.includes(MARK[k]));
        return (
          <Text key={i}>
            {CAPTION_SEPARATOR}
            {id ? <Text testID={MARK_IDS[id]}>{fill(seg)}</Text> : fill(seg)}
          </Text>
        );
      })}
    </>
  );
}

export function CoverageRing({
  status,
  buttonState,
  hasPending,
  onPress,
  uploaded,
  total,
  startedAt,
  lastRun,
  holdReason,
  bytesPerSec,
  etaSec,
  scope = null,
  onPressScope,
}: {
  status: EngineStatus;
  buttonState: EngineButtonState;
  /** Something is left to do, so an idle press continues rather than starts. */
  hasPending: boolean;
  onPress: () => void;
  /** Library items backed up. */
  uploaded: number;
  /** Library items under the current filters; null when the library could not be counted. */
  total: number | null;
  /** Unix seconds; the elapsed clock ticks from here while running. */
  startedAt: number | null;
  /** Unix seconds of the last completed run, or null when there has been none. */
  lastRun: number | null;
  /** Shown in the status while `status` is "holding" (e.g. "waiting for Wi-Fi"). */
  holdReason?: string | null;
  bytesPerSec: number;
  etaSec: number | null;
  /** What the denominator leaves out (see coverageScope); null when nothing. */
  scope?: string | null;
  /** Opens the settings where the scope is changed. */
  onPressScope?: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const running = buttonState === "running";
  const disabled = buttonState === "disabled";
  const paused = buttonState === "paused";

  // Elapsed clock, ticking once a second only while a run is live.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!running || startedAt == null) return;
    setNow(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  const fraction = total != null && total > 0 ? Math.min(1, Math.max(0, uploaded / total)) : 0;
  const empty = fraction === 0;
  // Round caps overshoot each end of the dash by half the stroke. A dash the
  // full length of the fill therefore covers one stroke MORE than it should,
  // and at 99% the two caps overlap into a lump just before twelve o'clock.
  // Shorten the dash by one stroke so the visible span, caps included, is the
  // fill exactly; a full ring has no ends and needs no correction.
  const dash = fraction >= 1 ? RING_CIRCUMFERENCE : Math.max(0, fraction * RING_CIRCUMFERENCE - STROKE);
  const arcOffsetTarget = RING_CIRCUMFERENCE - dash;
  // The offset itself is animated (not a 0..1 fraction run through an
  // interpolation) so a static render lands on the exact value. Same pattern
  // as DownloadRing: strokeDashoffset is an SVG prop, so it cannot run on the
  // UI thread, and ARC_MS of JS-driven stepping on one number is cheaper than
  // re-rendering the screen per frame.
  const arcOffset = useRef(new RNAnimated.Value(arcOffsetTarget)).current;
  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    // Nothing to sweep on mount or on a re-render that kept the fill: a timing
    // to the value already held still steps the prop for ARC_MS.
    if (lastTarget.current === null || lastTarget.current === arcOffsetTarget) {
      lastTarget.current = arcOffsetTarget;
      arcOffset.setValue(arcOffsetTarget);
      return;
    }
    lastTarget.current = arcOffsetTarget;
    const sweep = RNAnimated.timing(arcOffset, {
      toValue: arcOffsetTarget,
      duration: ARC_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    });
    sweep.start();
    // A new target mid-sweep stops this one where it is and the next starts
    // from there; on unmount the pending frame must not outlive the ring.
    return () => sweep.stop();
  }, [arcOffset, arcOffsetTarget]);

  // A hold or a cooldown is a run standing still: the arc goes graphite so
  // the ring reads "not moving" before the words do. A block is a fault.
  const arcColor =
    status === "holding" || status === "cooling"
      ? tokens.mutedForeground
      : paused
        ? tokens.destructive
        : disabled
          ? tokens.border
          : tokens.primary;
  const coreBg = running ? tokens.primary : tokens.card;
  const ink = running ? tokens.primaryForeground : disabled ? tokens.mutedForeground : paused ? tokens.destructive : tokens.primary;
  const label = engineLabel(status, holdReason);

  const caption = (() => {
    switch (buttonState) {
      case "disabled":
        return <Text>{t("backup.label.selectAWorkspaceToBackUp")}</Text>;
      case "paused":
        // The core already says "Paused"; this line is the action.
        return (
          <Text>
            {t("backup.description.tapToRetryHasLastRunSelectTrueLastRunLastRunOther", {
              hasLastRun: String(!!lastRun),
              lastRun: lastRun ? formatWhen(lastRun) : "",
            })}
          </Text>
        );
      case "running": {
        // A hold's reason is in the core ("Paused - waiting for Wi-Fi"), so
        // the caption only adds what the core does not say.
        const key =
          status === "holding"
            ? "backup.description.resumesOnItsOwnHasSpeedSelectTrueSpeedOtherHasEtaSelectTrueEtaLeft"
            : status === "cooling"
              ? "backup.description.deviceIsWarmResumesOnItsOwnHasSpeedSelectTrueSpeedOtherHasEtaSelect"
              : "backup.description.tapToStopHasSpeedSelectTrueSpeedOtherHasEtaSelectTrueEtaLeftOther";
        return <Text>{runningCaption(t(key, {
          hasSpeed: String(bytesPerSec > 0),
          speed: MARK.speed,
          hasEta: String(etaSec != null),
          eta: MARK.eta,
          hasElapsed: String(startedAt != null),
          elapsed: MARK.elapsed,
        }), {
          speed: bytesPerSec > 0 ? formatSpeed(bytesPerSec) : "",
          eta: etaSec != null ? formatDuration(etaSec) : "",
          elapsed: startedAt != null ? formatElapsed(now - startedAt) : "",
        })}</Text>;
      }
      default:
        return (
          <Text>
            {hasPending ? t("backup.action.continueBackup") : t("common.action.startBackup")} ·{" "}
            {lastRun ? t("backup.label.lastRunWhen", { when: formatWhen(lastRun) }) : t("backup.label.neverRun")}
          </Text>
        );
    }
  })();

  return (
    <View className="items-center pt-2">
      <View
        testID="coverage-ring"
        accessibilityRole="progressbar"
        accessibilityLabel={headline(uploaded, total)}
        accessibilityValue={{ min: 0, max: total ?? 0, now: Math.min(uploaded, total ?? 0) }}
        style={{ width: FRAME, height: FRAME, alignItems: "center", justifyContent: "center" }}
      >
        {/* Layers are stacked explicitly. Seen on a device: with the halos as
            bare siblings the running core rendered as a 30% green disc with
            no glow - a halo where the fill should have been. */}
        {running ? (
          <View
            testID="engine-halos"
            pointerEvents="none"
            style={{ position: "absolute", width: FRAME, height: FRAME, alignItems: "center", justifyContent: "center", zIndex: 0 }}
          >
            <Halo color={tokens.primary} delayMs={0} />
            <Halo color={tokens.primary} delayMs={1000} />
          </View>
        ) : null}
        <View pointerEvents="none" style={{ position: "absolute", width: RING_SIZE, height: RING_SIZE, zIndex: 1 }}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Circle
              testID="coverage-ring-track"
              /* rtl-ok: centering */
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              stroke={empty ? tokens.border : tokens.secondary}
              strokeWidth={STROKE}
              strokeDasharray={empty ? "3 8" : undefined}
              strokeLinecap="round"
              fill="none"
            />
            {/* Not drawn at zero: a zero-length arc with round caps still
                paints a dot at twelve o'clock. */}
            {fraction > 0 ? (
              <AnimatedCircle
                testID="coverage-ring-arc"
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RADIUS}
                stroke={arcColor}
                strokeWidth={STROKE}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={arcOffset}
                // Start the arc at twelve o'clock rather than three.
                rotation={-90}
                origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
              />
            ) : null}
          </Svg>
        </View>
        <Pressable
          testID={running ? "backup-stop" : "backup-now"}
          accessibilityRole="button"
          accessibilityLabel={running ? t("backup.action.stopBackup") : hasPending ? t("backup.action.continueBackup") : t("common.action.startBackup")}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPress}
          // The Pressable only handles the press; the paint lives on a plain
          // View below, the pattern every other filled control in the app uses.
          style={({ pressed }) => ({
            width: CORE,
            height: CORE,
            zIndex: 2,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <View
            testID="engine-core"
            style={{
              width: CORE,
              height: CORE,
              borderRadius: CORE / 2,
              backgroundColor: coreBg,
              borderWidth: running ? 0 : 1,
              borderColor: paused ? tokens.destructive : tokens.border,
              opacity: disabled ? 0.5 : 1,
              shadowColor: running ? tokens.primary : "#000",
              shadowOpacity: running ? 0.4 : 0.1,
              shadowRadius: running ? 22 : 10,
              shadowOffset: { width: 0, height: 6 },
              elevation: running ? 10 : 4,
            }}
          >
            {/* The glyph is the centre of the disc; the label hangs below it
                rather than sharing the centring with it. */}
            <View
              testID="engine-glyph"
              pointerEvents="none"
              style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name={iconFor(status, buttonState)} size={GLYPH} color={ink} />
            </View>
            <Text
              testID="engine-status"
              numberOfLines={2}
              className="text-xs font-semibold"
              style={{
                position: "absolute",
                top: CORE / 2 + GLYPH / 2 + 4,
                left: 16,
                right: 16,
                textAlign: "center",
                color: running ? tokens.primaryForeground : tokens.foreground,
              }}
            >
              {label}
            </Text>
          </View>
        </Pressable>
      </View>
      <Text testID="backup-coverage" className="mt-2 text-center text-lg font-bold text-foreground">
        {headline(uploaded, total)}
      </Text>
      {scope ? (
        // The number's scope sits in the same breath as the number: a total
        // that silently excludes most of the phone reads as lost photos.
        <Pressable
          testID="coverage-scope"
          accessibilityRole="button"
          accessibilityLabel={t("backup.action.changeWhatGetsBackedUp")}
          onPress={onPressScope}
          className="mt-1 flex-row items-center gap-1 px-6"
        >
          <Text className="text-center text-xs font-medium text-foreground">{scope}</Text>
          <Icon name="chevron-forward" size={12} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
      <Text testID="engine-caption" className="mt-1 px-6 text-center text-xs leading-4 text-muted-foreground">
        {caption}
      </Text>
    </View>
  );
}
