import { useEffect, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { layoutIsRtl } from "@/lib/direction";
import { ROW_STAGGER_MS } from "./menuMotion";

/** Rows past this one enter together, so a long favourites list never trails. */
const STAGGER_CAP = 14;
const ENTER = { duration: 260, easing: Easing.out(Easing.cubic) };

/**
 * A row's entrance: opacity 0->1 and 10 pt in from the menu's edge, `index`
 * steps of ROW_STAGGER_MS after the menu starts opening. The menu unmounts once
 * closed, so this runs on open only. Reduce Motion: there from the start.
 */
export function MenuEnter({ index, children }: { index: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      p.value = 1;
      return;
    }
    p.value = withDelay(Math.min(index, STAGGER_CAP) * ROW_STAGGER_MS, withTiming(1, ENTER));
  }, [index, p, reduced]);
  const from = layoutIsRtl() ? 10 : -10;
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    // rtl-ok: mirrored (from is +10 in RTL)
    transform: [{ translateX: (1 - p.value) * from }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** One tappable line of the menu: icon, label, optional trailing node. */
export function MenuRow(props: {
  testID: string;
  index: number;
  icon?: IconName;
  lead?: ReactNode;
  label: string;
  selected?: boolean;
  trailing?: ReactNode;
  onPress: () => void;
}) {
  const { tokens } = useColorTheme();
  const color = props.selected ? tokens.primary : tokens.foreground;
  return (
    <MenuEnter index={props.index}>
      <Pressable
        testID={props.testID}
        accessibilityRole="button"
        accessibilityState={props.selected === undefined ? undefined : { selected: props.selected }}
        onPress={props.onPress}
        className={"mx-2 flex-row items-center gap-3 rounded-lg px-3 py-2.5 " + (props.selected ? "bg-primary/10" : "")}
      >
        {props.lead ?? (props.icon ? <Icon name={props.icon} size={20} color={props.selected ? tokens.primary : tokens.mutedForeground} /> : null)}
        <Text
          className="min-w-0 flex-1 text-[15px]"
          numberOfLines={1}
          style={{ color, fontFamily: props.selected ? fonts.medium : fonts.regular }}
        >
          {props.label}
        </Text>
        {props.trailing}
      </Pressable>
    </MenuEnter>
  );
}

/** A small uppercase section title, with an optional action at its end. */
export function MenuSectionTitle({ index, label, action }: { index: number; label: string; action?: ReactNode }) {
  return (
    <MenuEnter index={index}>
      <View className="mt-4 flex-row items-center px-5 pb-1">
        <Text className="flex-1 text-[11px] uppercase text-muted-foreground" style={{ fontFamily: fonts.medium }}>
          {label}
        </Text>
        {action}
      </View>
    </MenuEnter>
  );
}
