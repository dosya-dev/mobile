import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/ui/Icon";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import type { StagePalette } from "./stageTheme";

const FADE_MS = 180;

/**
 * The floating top chrome: back, position, overflow.
 *
 * It stays MOUNTED and cross-fades rather than unmounting, which is what makes
 * the show/hide read as a fade instead of a flicker. That costs the one thing
 * an unmounted button gives for free - it cannot intercept a touch - so
 * `pointerEvents` is driven off the same flag: while hidden, a tap has to fall
 * through to the stage underneath and bring the chrome back, not land on an
 * invisible button. Same pattern as the reader's chrome.
 *
 * The position counter sits where a title normally would, deliberately: the
 * filename is in the sheet directly below, and the screen this replaces
 * printed it in both places.
 */
export function ViewerChrome(props: {
  visible: boolean;
  position: string | null;
  palette: StagePalette;
  onBack: () => void;
  onMore: () => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(props.visible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(props.visible ? 1 : 0, { duration: FADE_MS });
  }, [props.visible, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }));

  const hit = props.visible ? "auto" : "none";

  return (
    <Animated.View
      testID="viewer-chrome"
      pointerEvents={hit}
      accessibilityElementsHidden={!props.visible}
      importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
      className="absolute inset-x-0 top-0 z-40 flex-row items-center gap-2.5 px-3.5 pb-3"
      style={[{ paddingTop: insets.top + 8, backgroundColor: "rgba(2,8,14,0.42)" }, style]}
    >
      <Pressable
        testID="viewer-back"
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        hitSlop={10}
        onPress={props.onBack}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: props.palette.chrome }}
      >
        <Icon name="chevron-back" size={19} color={props.palette.fg} />
      </Pressable>

      <View className="flex-1 items-center">
        {props.position ? (
          <Text
            testID="viewer-position"
            className="text-xs"
            style={{ fontFamily: fonts.mono, letterSpacing: 0.7, color: props.palette.fgMuted }}
          >
            {props.position}
          </Text>
        ) : null}
      </View>

      <Pressable
        testID="viewer-more-top"
        accessibilityRole="button"
        accessibilityLabel={t("files.action.moreActions")}
        hitSlop={10}
        onPress={props.onMore}
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: props.palette.chrome }}
      >
        <Icon name="ellipsis-horizontal" size={19} color={props.palette.fg} />
      </Pressable>
    </Animated.View>
  );
}
