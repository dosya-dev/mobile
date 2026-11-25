import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { RollingCount } from "./RollingCount";

/** `× | N selected | Move to`, shown in place of the Files header while selecting. */
export function SelectionHeader({ count, onCancel, onMove, moveDisabled, roll = true }: {
  count: number; onCancel: () => void; onMove: () => void; moveDisabled: boolean;
  /** Animate count changes (off while the header is not showing). */
  roll?: boolean;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row items-center gap-3 px-5 py-2" testID="selection-header">
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.cancel")} hitSlop={8} onPress={onCancel} testID="selection-close">
        <Icon name="close" size={22} color={tokens.foreground} />
      </Pressable>
      <RollingCount count={count} roll={roll} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: moveDisabled }}
        disabled={moveDisabled}
        onPress={onMove}
        testID="selection-move"
        className={"flex-row items-center gap-1.5 rounded-full px-3 py-1 " + (moveDisabled ? "bg-secondary" : "bg-primary")}
      >
        <Icon name="arrow-forward-outline" size={16} color={moveDisabled ? tokens.mutedForeground : tokens.primaryForeground} />
        <Text className={moveDisabled ? "text-muted-foreground text-sm" : "text-primary-foreground text-sm"}>{t("files.action.moveTo")}</Text>
      </Pressable>
    </View>
  );
}
