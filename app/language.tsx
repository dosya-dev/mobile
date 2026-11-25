import { Pressable, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import type { LocalePreference } from "@/lib/locale-store";
import { confirmDirectionSwitch, requestPreference, t as translate, useLocale, useT } from "@/lib/i18n";
import { showRestartPrompt } from "@/i18n/restart-prompt";
import { toast } from "@/ui/toast";

/**
 * The language picker: "Device language" first, then every shipped language in
 * its own name (a reader must find theirs whatever the app currently shows).
 * The choice applies at once and is kept on this device only, except a choice
 * that flips the layout direction: that one asks, then restarts the app.
 */
export default function LanguageScreen() {
  const { tokens } = useColorTheme();
  const t = useT();
  const { preference } = useLocale();

  const options: { id: LocalePreference; label: string }[] = [
    { id: "device", label: t("appearance.option.deviceLanguage") },
    ...LOCALES.map((l) => ({ id: l as LocalePreference, label: LOCALE_LABELS[l] })),
  ];

  // A failed switch keeps the old language, which is already the right thing to show.
  const pick = (id: LocalePreference) => {
    if (id === preference) return;
    void requestPreference(id)
      .then((r) => {
        if (r.kind === "restart") showRestartPrompt(r.locale, () => restart(id));
      })
      .catch(() => {});
  };

  // When the app cannot restart, the language is applied in place; the layout
  // follows at the next start. The note reads in the new language.
  const restart = (id: LocalePreference) => {
    void confirmDirectionSwitch(id)
      .then((r) => {
        if (r === "applied-in-place") toast(translate("appearance.description.reopenToFinishLanguageChange"));
      })
      .catch(() => {});
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("appearance.label.language") }} />
      <Screen underNativeHeader title={t("appearance.label.language")}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Section>
            {options.map((o, i) => {
              const selected = preference === o.id;
              return (
                <Pressable
                  key={o.id}
                  testID={`language-${o.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => pick(o.id)}
                  className={"flex-row items-center gap-3 px-4 py-3" + (i < options.length - 1 ? " border-b border-border" : "")}
                >
                  <View className="flex-1">
                    <Text className="text-base text-foreground" style={{ fontFamily: selected ? fonts.medium : fonts.regular }}>
                      {o.label}
                    </Text>
                  </View>
                  {selected ? <Icon name="checkmark" size={18} color={tokens.primary} /> : null}
                </Pressable>
              );
            })}
          </Section>
          <Text className="px-1 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("appearance.description.languageSavedOnThisDevice")}
          </Text>
        </ScrollView>
      </Screen>
    </>
  );
}
