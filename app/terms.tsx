import { Stack } from "expo-router";
import { useT } from "@/lib/i18n";
import { LegalScreen } from "@/legal/LegalScreen";
import { TERMS_SECTIONS, TERMS_UPDATED } from "@/legal/content";

export default function TermsScreen() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("legal.heading.termsOfService") }} />
      <LegalScreen title={t("legal.heading.termsOfService")} updated={TERMS_UPDATED} sections={TERMS_SECTIONS} />
    </>
  );
}
