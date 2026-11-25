import { useState } from "react";
import { FlatList, Modal, Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { formatDateWith } from "@/lib/format-locale";
import { useColorTheme } from "@/theme/useColorTheme";
import type { TocItem } from "./bridge";
import type { Bookmark } from "./readingState";
import { useSheetBottomPad } from "@/ui/sheetInsets";

type Tab = "contents" | "bookmarks";

/** Bottom sheet with two tabs: the book's table of contents and its bookmarks. */
export function TocSheet(props: {
  visible: boolean;
  toc: TocItem[];
  bookmarks: Bookmark[];
  onClose: () => void;
  onSelectToc: (href: string) => void;
  onSelectBookmark: (b: Bookmark) => void;
  onRemoveBookmark: (id: string) => void;
  onBack?: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [tab, setTab] = useState<Tab>("contents");

  const sheetPad = useSheetBottomPad();

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={props.onClose}>
        <View className="max-h-[70%] rounded-t-2xl bg-card" style={{ paddingBottom: sheetPad }}>
          {props.onBack ? (
            <View className="flex-row items-center border-b border-border px-4 py-2">
              <Pressable
                testID="sheet-back"
                accessibilityRole="button"
                accessibilityLabel={t("reader.action.backToMenu")}
                onPress={props.onBack}
                hitSlop={8}
                className="flex-row items-center gap-1"
              >
                <Icon name="chevron-back" size={18} color={tokens.primary} />
                <Text style={{ color: tokens.primary }} className="text-[15px]">{t("navigation.accessibility.menu")}</Text>
              </Pressable>
            </View>
          ) : null}
          <View className="flex-row border-b border-border">
            <Pressable testID="toc-tab-contents" className="flex-1 items-center py-3" onPress={() => setTab("contents")}>
              <Text className={"text-base " + (tab === "contents" ? "text-foreground font-medium" : "text-muted-foreground")}>{t("common.tooltip.contents")}</Text>
            </Pressable>
            <Pressable testID="toc-tab-bookmarks" className="flex-1 items-center py-3" onPress={() => setTab("bookmarks")}>
              <Text className={"text-base " + (tab === "bookmarks" ? "text-foreground font-medium" : "text-muted-foreground")}>{t("common.tooltip.bookmarks")}</Text>
            </Pressable>
          </View>

          {tab === "contents" ? (
            <FlatList
              data={props.toc}
              keyExtractor={(item, i) => `${item.href}-${i}`}
              style={{ maxHeight: 420 }}
              renderItem={({ item }) => (
                <Pressable
                  className="py-3 pe-4"
                  style={{ paddingStart: 16 + item.depth * 16 }}
                  onPress={() => {
                    props.onSelectToc(item.href);
                    props.onClose();
                  }}
                >
                  <Text className="text-base text-foreground" numberOfLines={2}>{item.label}</Text>
                </Pressable>
              )}
            />
          ) : props.bookmarks.length === 0 ? (
            <View className="items-center py-10">
              <Text className="text-sm text-muted-foreground">{t("reader.empty.noBookmarksYet")}</Text>
            </View>
          ) : (
            <FlatList
              data={props.bookmarks}
              keyExtractor={(b) => b.id}
              style={{ maxHeight: 420 }}
              renderItem={({ item: b }) => (
                <View className="flex-row items-center gap-3 px-4 py-3">
                  <Pressable
                    className="flex-1"
                    onPress={() => {
                      props.onSelectBookmark(b);
                      props.onClose();
                    }}
                  >
                    <Text className="text-base text-foreground">{b.label}</Text>
                    <Text className="text-xs text-muted-foreground">{formatDateWith(b.createdAt, {})}</Text>
                  </Pressable>
                  <Pressable
                    testID={`remove-bookmark-${b.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.tooltip.removeBookmark")}
                    hitSlop={8}
                    onPress={() => props.onRemoveBookmark(b.id)}
                  >
                    <Icon name="trash-outline" size={20} color={tokens.destructive} />
                  </Pressable>
                </View>
              )}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}
