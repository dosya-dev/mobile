import { ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { useLocale, useT } from "@/lib/i18n";
import type { LegalSection } from "./content";

/** Shared renderer for the Terms / Privacy screens - same text as the web pages. */
export function LegalScreen({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <Screen underNativeHeader title={title}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }} testID="legal-scroll">
        {/* The documents are English only; in another language the screen says which version applies. */}
        {locale !== "en" ? (
          <Text testID="legal-english-note" className="mb-2 text-xs text-muted-foreground">{t("legal.description.englishVersionApplies")}</Text>
        ) : null}
        <Text className="mb-6 text-xs text-muted-foreground">{updated}</Text>
        {sections.map((s) => (
          <View key={s.title} className="mb-6">
            <Text className="mb-2 text-base font-bold text-foreground">{s.title}</Text>
            {s.paragraphs.map((p, i) => (
              <Text key={i} className="mb-2 text-sm leading-5 text-muted-foreground">
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
