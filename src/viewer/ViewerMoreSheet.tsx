import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { FileThumb } from "@/files/FileThumb";
import { formatBytes, kindLabel } from "@/files/format";
import type { FileItem } from "@/files/types";
import { rtlLine } from "@/lib/i18n";

// Same curve and timings as the viewer's own sheet, so the two read as one family.
const DRAWER = Easing.bezier(0.32, 0.72, 0, 1);
const OPEN = { duration: 300, easing: DRAWER };
const CLOSE = { duration: 220, easing: DRAWER };

export interface MoreAction {
  /** Stable name for the row (its testID), so the id does not follow the language. */
  id?: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * The overflow menu, finally reachable from the preview.
 *
 * Rename, move, copy and delete lived only in the file LIST's action sheet, so
 * getting to any of them from an open file meant going back, finding the row
 * again and long-pressing it. Six of the seven actions on a file were
 * unreachable from the screen showing that file.
 *
 * The header is not decoration: this menu ends in a destructive action, and it
 * opens over a full-screen viewer where the filename may be hidden behind the
 * scrim. Naming the target makes the delete unambiguous.
 */
export function ViewerMoreSheet(props: {
  visible: boolean;
  file: FileItem;
  actions: MoreAction[];
  onClose: () => void;
}) {
  const { tokens } = useColorTheme();
  const sheetPad = useSheetBottomPad();
  const reduceMotion = useReducedMotion();
  // The sheet now stays presented through its close animation, and Rename,
  // the Live Photo delete prompt and Share all present something of their own.
  // On iOS that would land on top of the closing sheet and go down with it, so
  // each action waits for the dismissal. See afterDismiss.ts.
  const after = useAfterDismiss();

  // The Modal's own "slide" carried the dimmed scrim up with the sheet, so the
  // whole screen appeared to lift. Here the scrim fades in place and only the
  // sheet travels; the Modal stays up until the sheet is gone, so closing is
  // animated too rather than cut.
  const [mounted, setMounted] = useState(props.visible);
  const progress = useSharedValue(0);
  const sheetHeight = useSharedValue(600);
  useEffect(() => {
    if (props.visible) {
      setMounted(true);
      progress.value = withTiming(1, OPEN);
    } else {
      progress.value = withTiming(0, CLOSE, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [props.visible, progress]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * sheetHeight.value }],
    opacity: reduceMotion ? progress.value : 1,
  }));

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={props.onClose}
      onDismiss={after.onDismiss}
    >
      <View className="flex-1 justify-end">
        <Animated.View className="absolute inset-0 bg-black/50" style={scrimStyle} pointerEvents="none" />
        <Pressable className="absolute inset-0" onPress={props.onClose} testID="more-scrim" />
        <Animated.View
          style={sheetStyle}
          onLayout={(e) => { sheetHeight.value = e.nativeEvent.layout.height; }}
          // A closing sheet must not take a second tap meant for the viewer.
          pointerEvents={props.visible ? "auto" : "none"}
        >
          <View className="rounded-t-[22px] bg-card px-2" style={{ paddingBottom: sheetPad }}>
            <View className="items-center py-2.5">
              <View className="h-1 w-9 rounded-full bg-border" />
            </View>

            <View className="flex-row items-center gap-3 px-3 pb-3">
              <View className="h-10 w-10 overflow-hidden rounded-lg">
                <FileThumb file={props.file} variant="grid" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                  {props.file.name}
                </Text>
                <Text className="text-[10.5px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
                  {rtlLine(`${formatBytes(props.file.size_bytes)} · ${kindLabel(props.file.mime_type, props.file.extension)}`)}
                </Text>
              </View>
            </View>

            <View className="mx-3 h-px bg-border" />

            <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
              {props.actions.map((a) => (
                <Pressable
                  key={a.id ?? a.label}
                  testID={`more-${a.id ?? a.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  accessibilityRole="button"
                  onPress={() => { props.onClose(); after.queue(a.onPress); }}
                  className="flex-row items-center gap-3.5 px-3 py-3.5"
                >
                  <Icon name={a.icon} size={20} color={a.destructive ? tokens.destructive : tokens.foreground} />
                  <Text className={"text-[15px] " + (a.destructive ? "text-destructive" : "text-foreground")}>
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
