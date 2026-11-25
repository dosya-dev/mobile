import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, PanResponder, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/ui/Icon";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { rtlLine, useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import {
  SHOW_LINE_BYTES,
  downloadStats,
  progressCaption,
  type DownloadEntry,
} from "@/files/downloadModel";
import type { T } from "@/i18n/translator";
import type { PrimaryAction } from "./viewerModel";

/** How far a drag has to travel before it counts as a deliberate one. */
const DRAG_THRESHOLD = 28;

// The iOS sheet curve: leaves fast, settles long. Coming back takes a little
// longer than going away, because the return is what the eye follows.
const DRAWER = Easing.bezier(0.32, 0.72, 0, 1);
const SHOW = { duration: 300, easing: DRAWER };
const HIDE = { duration: 240, easing: DRAWER };
// The details panel opens in place, so it uses the plain strong ease-out.
const EXPAND = { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) };
/** Until the sheet has been measured, far enough to clear any peek height. */
const FALLBACK_HEIGHT = 400;

/**
 * The bottom sheet: the filename, the facts, the actions, and - once pulled up
 * - the full record.
 *
 * Two detents rather than free positioning. A sheet that can rest anywhere
 * looks impressive and is worse to use: every open leaves it somewhere
 * slightly different, and the actions move. Peek and expanded, nothing else.
 *
 * The drag runs on PanResponder from React Native core. react-native-gesture-
 * handler is not a dependency of this app, and adding it for one sheet would
 * mean a native rebuild for every developer and a new build for every user, to
 * replace a gesture that core handles correctly.
 */
export function ViewerSheet(props: {
  /** Hidden entirely while the viewer is immersive. */
  visible: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  name: string;
  meta: string[];
  badge?: string | null;
  primary?: PrimaryAction | null;
  primaryBusy?: boolean;
  onPrimary?: () => void;
  /** The action row. */
  children: ReactNode;
  /** The details panel, rendered only while expanded. */
  details?: ReactNode;
  note?: string | null;
  /** The live transfer for this file, if there is one. */
  download?: DownloadEntry;
  /** Cancels a running transfer, or retries a broken one. */
  onCancelDownload?: () => void;
  /** Injectable clock, so the rate and estimate are testable without fake timers. */
  now?: number;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { tokens } = useColorTheme();
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(props.visible ? 0 : 1);
  // Measured, not a constant: an expanded sheet is taller than 400dp and used
  // to stop with its top edge still on screen.
  const height = useSharedValue(FALLBACK_HEIGHT);

  // withTiming retargets from wherever the sheet is, so a second tap halfway
  // through reverses it smoothly instead of restarting.
  useEffect(() => {
    offset.value = withTiming(props.visible ? 0 : 1, props.visible ? SHOW : HIDE);
  }, [props.visible, offset]);

  // The details stay mounted while they fold away, then leave.
  const [detailsMounted, setDetailsMounted] = useState(props.expanded);
  const open = useSharedValue(props.expanded ? 1 : 0);
  const detailsHeight = useSharedValue(0);
  useEffect(() => {
    if (props.expanded) {
      setDetailsMounted(true);
      open.value = withTiming(1, EXPAND);
    } else {
      open.value = withTiming(0, EXPAND, (finished) => {
        if (finished) runOnJS(setDetailsMounted)(false);
      });
    }
  }, [props.expanded, open]);

  // A ref mirror keeps the responder callbacks off the dependency treadmill:
  // PanResponder.create runs once, and a closure over props.expanded would
  // otherwise capture whatever it was at mount and never see a change.
  const stateRef = useRef({ expanded: props.expanded, toggle: props.onToggleExpanded });
  stateRef.current = { expanded: props.expanded, toggle: props.onToggleExpanded };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly a vertical drag, so a
        // horizontal swipe still reaches the file pager underneath.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderRelease: (_e, g) => {
          const { expanded, toggle } = stateRef.current;
          if (g.dy < -DRAG_THRESHOLD && !expanded) toggle();
          if (g.dy > DRAG_THRESHOLD && expanded) toggle();
        },
      }),
    [],
  );

  // Reduce Motion keeps the fade and drops the travel.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? 0 : offset.value * (height.value + 24) }],
    opacity: reduceMotion ? 1 - offset.value : 1 - offset.value * 0.35,
  }));

  // Height is the one layout property worth animating here: there is no
  // transform that grows a panel and pushes the sheet's top edge up with it.
  const detailsStyle = useAnimatedStyle(() => ({
    height: open.value * detailsHeight.value,
    opacity: open.value,
  }));

  return (
    <Animated.View
      testID="viewer-sheet"
      pointerEvents={props.visible ? "auto" : "none"}
      accessibilityElementsHidden={!props.visible}
      importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
      className="absolute inset-x-0 bottom-0 z-50 rounded-t-[22px] border-t border-border bg-card px-[18px]"
      style={[{ paddingBottom: insets.bottom + 14 }, style]}
      onLayout={(e) => { height.value = e.nativeEvent.layout.height; }}
      {...pan.panHandlers}
    >
      <Pressable
        testID="viewer-grabber"
        accessibilityRole="button"
        accessibilityLabel={props.expanded ? t("files.action.hideDetails") : t("files.action.showDetails")}
        accessibilityState={{ expanded: props.expanded }}
        hitSlop={12}
        onPress={props.onToggleExpanded}
        className="items-center py-2.5"
      >
        <View className="h-1 w-9 rounded-full bg-border" />
      </Pressable>

      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-[17px] font-bold text-foreground" numberOfLines={1}>
          {props.name}
        </Text>
        {props.badge ? (
          <View testID="viewer-badge" className="rounded-md bg-secondary px-[7px] py-[3px]">
            <Text
              className="text-[9.5px] uppercase text-muted-foreground"
              style={{ fontFamily: fonts.mono, letterSpacing: 0.8 }}
            >
              {props.badge}
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        testID="viewer-meta"
        className="mt-1 text-[11.5px] text-muted-foreground"
        numberOfLines={1}
        style={{ fontFamily: fonts.mono }}
      >
        {rtlLine(props.meta.join("  ·  "))}
      </Text>

      {progressLine(props, t)}

      {props.primary ? (
        <Pressable
          testID="viewer-primary"
          accessibilityRole="button"
          accessibilityLabel={props.primary.label}
          disabled={props.primaryBusy}
          onPress={props.onPrimary}
          className={
            "mt-3.5 h-[46px] flex-row items-center justify-center gap-2 rounded-xl " +
            (props.primary.tone === "solid" ? "bg-primary" : "bg-secondary") +
            (props.primaryBusy ? " opacity-60" : "")
          }
        >
          {props.primaryBusy ? (
            <ActivityIndicator size="small" color={props.primary.tone === "solid" ? tokens.primaryForeground : tokens.foreground} />
          ) : (
            <>
              <Icon
                name={iconFor(props.primary.kind)}
                size={19}
                color={props.primary.tone === "solid" ? tokens.primaryForeground : tokens.foreground}
              />
              <Text
                className={
                  "text-[15px] font-bold " +
                  (props.primary.tone === "solid" ? "text-primary-foreground" : "text-foreground")
                }
              >
                {props.primary.label}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}

      {props.children}

      {props.note ? (
        <View testID="viewer-note" className="mt-3.5 flex-row items-center gap-2.5 rounded-xl bg-secondary px-3 py-2.5">
          <Icon name="eye-outline" size={16} color={tokens.mutedForeground} />
          <Text className="flex-1 text-[11.5px] leading-4 text-muted-foreground">{props.note}</Text>
        </View>
      ) : null}

      {detailsMounted ? (
        <Animated.View testID="viewer-details-panel" style={[{ overflow: "hidden" }, detailsStyle]}>
          {/* Absolute so it lays out at its natural height while the clip
              around it is still growing; that height is what the clip grows to. */}
          <View
            style={{ position: "absolute", top: 0, left: 0, right: 0 }}
            onLayout={(e) => { detailsHeight.value = e.nativeEvent.layout.height; }}
          >
            {props.details}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/**
 * The bytes, the rate, the estimate and a way out - but only for a file big
 * enough that the wait is worth elaborating.
 *
 * It sits between the facts and the primary action deliberately: the facts
 * above it do not move when a download starts, so nothing reflows under a thumb
 * already reaching for the row below. It is 3px and mono rather than a second
 * bar at the dock's weight, because it must stay quieter than the button it
 * sits on top of.
 */
function progressLine(
  props: {
    download?: DownloadEntry;
    onCancelDownload?: () => void;
    now?: number;
  },
  t: T,
) {
  const d = props.download;
  if (!d) return null;
  if (d.phase === "done") return null;
  if (d.total > 0 && d.total < SHOW_LINE_BYTES) return null;

  const { pct } = downloadStats(d, props.now ?? Date.now());
  const broken = d.phase === "error";
  // `saving` has no measurable progress, so the bar sits full rather than
  // pretending to advance.
  const width = d.phase === "saving" ? 100 : pct;

  return (
    <View testID="viewer-progress" className="mt-3">
      <View className="h-[3px] overflow-hidden rounded-full bg-secondary">
        <View
          testID="viewer-progress-bar"
          className={"h-full rounded-full " + (broken ? "bg-destructive" : "bg-primary")}
          style={{ width: `${width}%` }}
        />
      </View>
      <View className="mt-1.5 flex-row items-baseline gap-2">
        <Text
          testID="viewer-progress-caption"
          className="flex-1 text-[11.5px] text-muted-foreground"
          numberOfLines={1}
          style={{ fontFamily: fonts.mono }}
        >
          {progressCaption(d, props.now ?? Date.now())}
        </Text>
        {props.onCancelDownload && d.phase !== "saving" ? (
          <Pressable
            testID="viewer-progress-action"
            accessibilityRole="button"
            hitSlop={10}
            onPress={props.onCancelDownload}
          >
            <Text className="text-[11.5px] font-medium text-muted-foreground">
              {broken ? t("common.retry") : t("common.cancel")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function iconFor(kind: PrimaryAction["kind"]): IconName {
  switch (kind) {
    case "read": return "book-outline";
    case "play": return "play";
    case "contacts": return "people-outline";
    case "calendar": return "calendar-outline";
    case "retry": return "refresh-outline";
    case "save": return "download-outline";
    // Same glyph GlyphStage's own archive disc and the archive route's root
    // chip already use for "this is a zip" - kept consistent across the
    // feature rather than picking a fresh icon for the same idea.
    case "browse": return "archive-outline";
  }
}
