import { Stack } from "expo-router";
import { useT } from "@/lib/i18n";
import { LegalScreen } from "@/legal/LegalScreen";
import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from "@/legal/content";

export default function PrivacyScreen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("legal.heading.privacyPolicy") }} />
      <LegalScreen title={t("legal.heading.privacyPolicy")} updated={PRIVACY_UPDATED} sections={PRIVACY_SECTIONS} />
    </>
  );
}
