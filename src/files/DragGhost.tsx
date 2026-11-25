import { View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { FileThumb } from "./FileThumb";
import type { FileItem } from "./types";
import { useT } from "@/lib/i18n";

/** Where the card sits relative to the finger: above and to the start, so the finger does not cover it. */
const OFFSET_X = 24;
const OFFSET_Y = 64;

/**
 * The card that follows the finger during a drag: the held item's thumbnail
 * or folder glyph and name, plus an "N items" pill when the drag carries a
 * selection. Positioned from shared values so the move handler never
 * re-renders the list.
 */
export function DragGhost({ x, y, name, file, count }: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  name: string;
  /** The held file, for its thumbnail; a folder has none. */
  file: FileItem | null;
  count: number;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const style = useAnimatedStyle(() => ({
    // rtl-ok: pointer coordinates (the card follows the finger)
    transform: [{ translateX: x.value - OFFSET_X }, { translateY: y.value - OFFSET_Y }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      testID="drag-ghost"
      className="absolute max-w-[220px] flex-row items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2"
      // rtl-ok: pointer coordinates (anchored to the area's physical corner, the finger's frame)
      style={[{ left: 0, top: 0, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }, style]}
    >
      {file ? <FileThumb file={file} variant="list" /> : (
        <View className="h-10 w-10 items-center justify-center">
          <Icon name="folder" size={26} color={tokens.primary} />
        </View>
      )}
      <Text className="shrink text-sm text-foreground" numberOfLines={1}>{name}</Text>
      {count > 1 ? (
        <View className="rounded-full bg-primary px-2 py-0.5">
          <Text className="text-xs text-primary-foreground">{t("common.label.item", { count })}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
