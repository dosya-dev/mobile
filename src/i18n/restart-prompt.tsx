import { Alert } from "react-native";
import { LOCALE_LABELS, localeDir, type Locale } from "@/i18n/locales";
import { t } from "@/lib/i18n";

/**
 * Asks before a language change that flips the layout direction: the native
 * direction only changes when the app restarts. Written in the language on
 * screen now, naming the target in its own name. `direction` chooses a branch,
 * so it is never isolated (see i18n.tsx).
 */
export function showRestartPrompt(target: Locale, onConfirm: () => void): void {
  Alert.alert(
    t("appearance.heading.restartToChangeLanguage"),
    t("appearance.description.restartToChangeDirection", {
      // Isolated in every language: the name is in the target's own script, and a
      // Hebrew or Arabic name opening an English or Turkish sentence would make the
      // whole alert a right-to-left paragraph. In RTL languages t() strips this and
      // wraps once. The alert is display only, never a data sink.
      language: `\u2068${LOCALE_LABELS[target]}\u2069`,
      direction: localeDir(target),
    }),
    [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("appearance.action.restart"), style: "default", onPress: onConfirm },
    ],
  );
}
