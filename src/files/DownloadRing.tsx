import { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { downloadStats, ringState, type DownloadEntry, type RingState } from "./downloadModel";
import { localDigits } from "@/lib/format-locale";

/**
 * The action circle, reporting on itself.
 *
 * The arc rides the rim of the 46px button the thumb just left, so the answer
 * to "did that do anything" is at the exact pixel that was pressed. The screen
 * this replaces put an ActivityIndicator there instead, which looks identical
 * at second 1 and second 170 of a half-gigabyte transfer.
 *
 * Geometry is fixed rather than derived: the circle it draws on is the existing
 * `h-[46px] w-[46px]` action button, and the arc must sit exactly on its edge.
 */
export const RING_SIZE = 46;
const STROKE = 3;
const RADIUS = (RING_SIZE - STROKE) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Bridges the 2% progress throttle. Linear, because an ease would misreport the rate. */
const ARC_MS = 260;

export function DownloadRing(props: {
  entry: DownloadEntry | undefined;
  size?: number;
  /**
   * `primary` when the ring sits ON the green disc rather than on a card
   * surface. Without it the arc is primary-green on primary-green - invisible -
   * and the numeral is foreground-on-primary, which fails contrast.
   */
  tone?: "surface" | "primary";
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const onPrimary = props.tone === "primary";
  const size = props.size ?? RING_SIZE;
  const stroke = (STROKE * size) / RING_SIZE;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const state = ringState(props.entry);
  const pct = props.entry ? downloadStats(props.entry, props.entry.startedAt).pct : 0;
  // `done` fills the ring even though the byte count may not have reached the
  // total exactly - a save that succeeded is 100% by definition.
  const fraction = state === "done" || state === "saving" ? 1 : Math.min(1, Math.max(0, pct / 100));

  const anim = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    const arc = Animated.timing(anim, {
      toValue: fraction,
      duration: ARC_MS,
      easing: Easing.linear,
      // strokeDashoffset is an SVG prop, not a transform, so it cannot run on
      // the UI thread. 260ms of JS-driven interpolation on one number is
      // cheaper than the re-render storm of driving it from state.
      useNativeDriver: false,
    });
    arc.start();
    // A JS-driven animation keeps stepping itself after the ring unmounts, so
    // it has to be stopped: the pending frame outlives the component, and under
    // jest it fires after the environment is torn down and fails the run.
    return () => arc.stop();
  }, [fraction, anim]);

  const offset = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const arcColor = state === "error"
    ? tokens.destructive
    : onPrimary ? tokens.primaryForeground : tokens.primary;
  const trackColor = onPrimary ? "rgba(255,255,255,0.34)" : tokens.border;
  const inkColor = onPrimary ? tokens.primaryForeground : tokens.foreground;
  const showArc = state !== "idle";
  const showPercent = state === "downloading";

  return (
    <View
      testID="download-ring"
      accessibilityRole="progressbar"
      accessibilityLabel={label(t, state, pct)}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      {showArc ? (
        <View style={{ position: "absolute", width: size, height: size }}>
          <Svg width={size} height={size}>
            <Circle
              /* rtl-ok: centering */
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={trackColor}
              strokeWidth={stroke}
              fill="none"
            />
            <AnimatedCircle
              testID="download-ring-arc"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={arcColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              // Start the arc at twelve o'clock rather than three.
              rotation={-90}
              origin={`${size / 2}, ${size / 2}`}
            />
          </Svg>
        </View>
      ) : null}

      {showPercent ? (
        <Text
          testID="download-ring-percent"
          style={{ fontFamily: fonts.mono, fontSize: size * 0.27, color: inkColor }}
        >
          {/* Rounding reaches 100 slightly before the transfer does, and a ring
              reading 100 while it is still working is the "parked and looking
              stuck" problem one step later. 100 belongs to `done`. */}
          {Math.min(99, pct)}
        </Text>
      ) : (
        // The wrapper carries the testID because the icon font component does
        // not forward one.
        <View testID={iconTestId(state)}>
          <Icon
            name={iconFor(state)}
            size={size * 0.43}
            color={state === "error" ? tokens.destructive : inkColor}
          />
        </View>
      )}
    </View>
  );
}

function iconFor(state: RingState): IconName {
  switch (state) {
    case "done": return "checkmark";
    case "error": return "alert-circle-outline";
    // The bytes are down and the OS is writing them somewhere. A download arrow
    // here would claim the transfer is still running.
    case "saving": return "phone-portrait-outline";
    default: return "download-outline";
  }
}

function iconTestId(state: RingState): string {
  if (state === "done") return "download-ring-check";
  if (state === "error") return "download-ring-error";
  return "download-ring-icon";
}

function label(t: T, state: RingState, pct: number): string {
  switch (state) {
    case "idle": return t("common.action.download");
    case "preparing": return t("common.label.preparingDownload");
    case "downloading": return t("common.label.downloadingPctPercent", { pct: localDigits(pct) });
    case "saving": return t("common.label.savingToYourPhone");
    case "done": return t("common.status.saved");
    case "error": return t("common.error.downloadFailedTapToRetry");
  }
}
