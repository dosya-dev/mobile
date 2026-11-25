// The workspace's folders as an indented tree in a bottom sheet; one tap picks
// a folder. Shared by the settings that keep a list of folders to leave out
// (AI search, Personas). The rows come flattened from `flattenTree`
// (src/ai-search/api.ts) so the caller decides which folders are offered.
//
// The backdrop, Cancel, the Android back button and a swipe down on the
// header (SheetHandle, src/ui) close it; the tree below scrolls.
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { SheetHandle } from "@/ui/SheetHandle";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import type { flattenTree } from "@/ai-search/api";

export interface FolderPickerSheetProps {
  visible: boolean;
  loading: boolean;
  rows: ReturnType<typeof flattenTree>;
  /** The sheet's heading. */
  title: string;
  onPick: (id: string) => void;
  onClose: () => void;
  /** testIDs: `<prefix>-folder-picker` on the sheet, `<prefix>-pick-<id>` on each row. */
  testIDPrefix: string;
}

export function FolderPickerSheet({ visible, loading, rows, title, onPick, onClose, testIDPrefix }: FolderPickerSheetProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const bottomPad = useSheetBottomPad();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <View testID={`${testIDPrefix}-folder-picker`} className="max-h-[70%] rounded-t-2xl bg-background" style={{ paddingBottom: bottomPad }}>
        <SheetHandle onDismiss={onClose} testID={`${testIDPrefix}-folder-picker-handle`}>
          <View className="flex-row items-center justify-between pb-2">
            <Text className="text-base text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">{title}</Text>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={onClose} className="min-h-[44px] justify-center">
              <Text className="text-sm text-primary" style={{ fontFamily: fonts.medium }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </SheetHandle>
        {loading ? (
          <View className="py-8"><ActivityIndicator /></View>
        ) : (
          <ScrollView>
            {rows.map(({ folder, depth }) => (
              <Pressable
                key={folder.id}
                testID={`${testIDPrefix}-pick-${folder.id}`}
                accessibilityRole="button"
                accessibilityLabel={folder.name}
                onPress={() => onPick(folder.id)}
                className="min-h-[44px] flex-row items-center gap-2 py-3 pe-5"
                style={{ paddingStart: 20 + depth * 16 }}
              >
                <Icon name="folder-outline" size={18} color={tokens.mutedForeground} />
                <Text className="flex-1 text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{folder.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
