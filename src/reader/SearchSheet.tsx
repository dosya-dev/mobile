import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import type { SearchHit } from "./bridge";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { inputStartAlign } from "@/lib/direction";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

/**
 * In-book search sheet. Debounces the query locally and hands the trimmed
 * string to the host via onQuery once the user pauses typing; the sheet
 * holds no result state of its own beyond the input text - hits, the
 * searching flag, idle and empty copy are all driven by props.
 */
export function SearchSheet(props: {
  visible: boolean;
  hits: SearchHit[];
  searching: boolean;
  error: string | null;
  onQuery: (q: string) => void;
  onSelect: (cfi: string) => void;
  onClose: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) return;
    const id = setTimeout(() => props.onQuery(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // The sheet stays mounted (and its local `query` state alive) while
  // hidden behind the menu or after Done - reset it whenever the sheet
  // closes so reopening starts from a clean idle state instead of
  // re-evaluating stale copy (e.g. "No results for ...") against a query
  // no search actually ran for.
  useEffect(() => {
    if (!props.visible) setQuery("");
  }, [props.visible]);

  const trimmed = query.trim();
  const showIdle = trimmed.length < MIN_CHARS;
  const showError = !showIdle && !!props.error;
  const showEmpty = !showIdle && !showError && !props.searching && props.hits.length === 0;

  const sheetPad = useSheetBottomPad();

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={props.onClose}>
        <View className="rounded-t-2xl bg-card" style={{ height: "72%", paddingBottom: sheetPad }}>
          <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
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
            <Text className="text-base font-semibold text-foreground">{t("common.tooltip.search")}</Text>
            <Pressable testID="sheet-done" accessibilityRole="button" accessibilityLabel={t("common.done")} onPress={props.onClose} hitSlop={8}>
              <Text style={{ color: tokens.primary }} className="text-[15px]">{t("common.done")}</Text>
            </Pressable>
          </View>

          <View className="px-4 pt-3">
            <TextInput
              testID="search-input"
              value={query}
              onChangeText={setQuery}
              placeholder={t("common.placeholder.searchInThisBook")}
              placeholderTextColor={tokens.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              className="rounded-lg bg-muted px-3 py-2 text-[15px] text-foreground"
              style={inputStartAlign()}
            />
          </View>

          <View className="flex-1 px-4 pt-3">
            {showIdle ? (
              <Text className="px-1 py-3 text-[13px] text-muted-foreground">{t("reader.description.typeAtLeastTwoLetters")}</Text>
            ) : showError ? (
              <Text testID="search-error" className="px-1 py-3 text-[13px] text-destructive">{props.error}</Text>
            ) : props.searching ? (
              <View className="flex-row items-center gap-2 px-1 py-3">
                <ActivityIndicator testID="search-indicator" size="small" color={tokens.foreground} />
                <Text className="text-[13px] text-muted-foreground">{t("reader.description.searching")}</Text>
              </View>
            ) : showEmpty ? (
              <Text className="px-1 py-3 text-[13px] text-muted-foreground">{t("reader.description.noResultsForTrimmed", { trimmed })}</Text>
            ) : (
              <FlatList
                data={props.hits}
                keyExtractor={(item, i) => `${item.cfi}-${i}`}
                renderItem={({ item, index }) => (
                  <Pressable
                    testID={`search-hit-${index}`}
                    className="border-b border-border py-3"
                    onPress={() => props.onSelect(item.cfi)}
                  >
                    <Text className="text-[13px] leading-5 text-foreground" numberOfLines={3}>
                      {item.excerpt}
                    </Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
