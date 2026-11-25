import { useState } from "react";
import { Pressable, ScrollView, View, useColorScheme as useOSScheme } from "react-native";
import { Stack } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import type { MessageKey } from "@/i18n/keys";
import { useT } from "@/lib/i18n";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme, resolveScheme } from "@/theme/useColorTheme";
import { sweepTheme } from "@/theme/ThemeSweep";
import { useAppearance } from "@/theme/themeStore";
import { THEME_META, THEME_TOKENS, type ThemeId, type ThemeMode } from "@/theme/tokens";
import { THEME_LABEL_KEYS } from "@/theme/themeLabels";
import type { T } from "@/i18n/translator";

// Keys, not text: the label is produced at render so a language switch reaches it.
const MODES: { id: ThemeMode; labelKey: MessageKey }[] = [
  { id: "light", labelKey: "common.option.light" },
  { id: "dark", labelKey: "common.option.dark" },
  { id: "system", labelKey: "common.label.system" },
];

function errMessage(e: unknown, t: T): string {
  return e instanceof Error ? e.message : t("common.error.couldnTSaveTryAgain");
}

export default function AppearanceScreen() {
  const { tokens, scheme } = useColorTheme();
  const os = useOSScheme();
  const theme = useAppearance((s) => s.theme);
  const mode = useAppearance((s) => s.mode);
  const setTheme = useAppearance((s) => s.setTheme);
  const setMode = useAppearance((s) => s.setMode);
  const [busy, setBusy] = useState(false);
  const t = useT();

  // The store applies optimistically and rolls back if the server rejects, so the only
  // job here is surfacing the failure. `busy` also keeps a second pick from starting
  // while a sweep is mid-flight.
  const save = (saving: Promise<unknown>) => {
    saving.catch((e) => toast(errMessage(e, t), "error")).finally(() => setBusy(false));
  };
  // The swap itself runs inside sweepTheme's callback, hidden under the band, so the
  // colour handed to it is the one the app will be wearing when the band pulls away.
  const pickMode = (m: ThemeMode) => {
    if (m === mode) return;
    setBusy(true);
    sweepTheme(THEME_TOKENS[theme][resolveScheme(m, os)].background, () => save(setMode(m)));
  };
  const pickTheme = (id: ThemeId) => {
    if (id === theme) return;
    setBusy(true);
    sweepTheme(THEME_TOKENS[id][scheme].background, () => save(setTheme(id)));
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("appearance.heading.appearance") }} />
      <Screen underNativeHeader title={t("appearance.heading.appearance")}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Section title={t("appearance.heading.mode")}>
            <View className="px-4 py-4">
              <View className="flex-row rounded-lg bg-muted p-1">
                {MODES.map((m) => {
                  const active = mode === m.id;
                  return (
                    <Pressable
                      key={m.id}
                      testID={`mode-${m.id}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      disabled={busy}
                      onPress={() => pickMode(m.id)}
                      className={"flex-1 items-center rounded-md px-1 py-2 " + (active ? "bg-card" : "")}
                    >
                      <Text
                        className={"text-sm " + (active ? "text-foreground" : "text-muted-foreground")}
                        style={{ fontFamily: active ? fonts.medium : fonts.regular }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                      >
                        {t(m.labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="mt-2 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                {t("appearance.description.yourChoiceFollowsYouAcrossDevices")}
              </Text>
            </View>
          </Section>

          <Section title={t("appearance.heading.theme")}>
            <View className="flex-row flex-wrap p-2">
              {THEME_META.map((meta) => {
                const active = theme === meta.id;
                // Preview each theme in the *current* scheme, so the swatches match what
                // you'd actually get if you picked one.
                const preview = THEME_TOKENS[meta.id][scheme];
                return (
                  <Pressable
                    key={meta.id}
                    testID={`theme-${meta.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    disabled={busy}
                    onPress={() => pickTheme(meta.id)}
                    className="w-1/2 p-2"
                  >
                    <View
                      className={"overflow-hidden rounded-lg border " + (active ? "border-primary" : "border-border")}
                      style={active ? { borderWidth: 2 } : undefined}
                    >
                      <View className="h-11 flex-row items-center gap-2 px-3" style={{ backgroundColor: preview.background }}>
                        <View className="h-4 w-4 rounded-full" style={{ backgroundColor: preview.primary }} />
                        <View className="h-2 flex-1 rounded-full" style={{ backgroundColor: preview.accent }} />
                      </View>
                      <View className="flex-row items-center justify-between bg-card px-3 py-2">
                        <Text className="text-xs text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                          {t(THEME_LABEL_KEYS[meta.id])}
                        </Text>
                        {active ? <Icon name="checkmark" size={14} color={tokens.primary} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        </ScrollView>
      </Screen>
    </>
  );
}
