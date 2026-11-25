import { Modal, Pressable, ScrollView, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { useReaderPrefs, FONT_MIN, FONT_MAX, FONT_STEP } from "./readerPrefs";
import { READING_THEMES, APP_READER_THEMES, type ReaderTheme } from "./readerThemes";
import { useSheetBottomPad } from "@/ui/sheetInsets";

function ThemeSwatch(props: { theme: ReaderTheme; selected: boolean; onPress: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={`theme-${props.theme.id}`}
      accessibilityRole="button"
      accessibilityLabel={t("reader.label.labelTheme", { label: props.theme.label })}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={{ width: "23%", marginBottom: 12 }}
    >
      <View
        style={{
          aspectRatio: 1,
          borderRadius: 11,
          backgroundColor: props.theme.bg,
          borderWidth: props.selected ? 2 : 1,
          borderColor: props.selected ? tokens.primary : "rgba(0,0,0,0.14)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: props.theme.fg, fontSize: 16, fontWeight: "600" }}>Aa</Text>
      </View>
      <Text className="mt-1 text-center text-[11px] text-muted-foreground" numberOfLines={1}>
        {props.theme.label}
      </Text>
    </Pressable>
  );
}

/**
 * Half-height sheet for reading preferences: text size, reading themes, app
 * themes. Reads and writes useReaderPrefs directly, so there is nothing to
 * wire from the caller besides visibility and navigation. Replaces
 * SettingsSheet now that app themes need more than three fixed swatches.
 */
export function ThemesSheet(props: { visible: boolean; onClose: () => void; onBack: () => void }) {
  const t = useT();
  const sheetPad = useSheetBottomPad();
  const { tokens } = useColorTheme();
  const fontSizePct = useReaderPrefs((s) => s.fontSizePct);
  const themeId = useReaderPrefs((s) => s.themeId);
  const setFontSizePct = useReaderPrefs((s) => s.setFontSizePct);
  const setThemeId = useReaderPrefs((s) => s.setThemeId);

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={props.onClose}>
        <View className="rounded-t-2xl bg-card" style={{ height: "50%", paddingBottom: sheetPad }}>
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
            <Text className="text-base font-semibold text-foreground">{t("reader.label.themesSettings")}</Text>
            <Pressable testID="sheet-done" accessibilityRole="button" accessibilityLabel={t("common.done")} onPress={props.onClose} hitSlop={8}>
              <Text style={{ color: tokens.primary }} className="text-[15px]">{t("common.done")}</Text>
            </Pressable>
          </View>

          {/* Side padding on the content: iOS shifts a vertical ScrollView's content by its own padding in RTL.
              14 is what `px-4` gave (NativeWind's native rem is 14). */}
          <ScrollView className="pt-4" contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}>
            <Text className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reader.label.textSize")}</Text>
            <View className="mb-6 flex-row items-center justify-center gap-6">
              <Pressable
                testID="font-smaller"
                accessibilityRole="button"
                accessibilityLabel={t("reader.action.decreaseTextSize")}
                disabled={fontSizePct <= FONT_MIN}
                onPress={() => void setFontSizePct(fontSizePct - FONT_STEP)}
                className={"h-11 flex-1 items-center justify-center rounded-lg bg-muted " + (fontSizePct <= FONT_MIN ? "opacity-40" : "")}
              >
                <Text className="text-sm text-foreground">A</Text>
              </Pressable>
              <Text className="w-16 text-center text-sm text-muted-foreground">{fontSizePct}%</Text>
              <Pressable
                testID="font-larger"
                accessibilityRole="button"
                accessibilityLabel={t("reader.action.increaseTextSize")}
                disabled={fontSizePct >= FONT_MAX}
                onPress={() => void setFontSizePct(fontSizePct + FONT_STEP)}
                className={"h-11 flex-1 items-center justify-center rounded-lg bg-muted " + (fontSizePct >= FONT_MAX ? "opacity-40" : "")}
              >
                <Text className="text-xl text-foreground">A</Text>
              </Pressable>
            </View>

            <Text className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reader.label.readingThemes")}</Text>
            <View className="mb-2 flex-row flex-wrap justify-between">
              {READING_THEMES.map((th) => (
                <ThemeSwatch key={th.id} theme={th} selected={themeId === th.id} onPress={() => void setThemeId(th.id)} />
              ))}
            </View>

            <Text className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("reader.label.appThemes")}</Text>
            <View className="flex-row flex-wrap justify-between">
              {APP_READER_THEMES.map((th) => (
                <ThemeSwatch key={th.id} theme={th} selected={themeId === th.id} onPress={() => void setThemeId(th.id)} />
              ))}
            </View>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}
