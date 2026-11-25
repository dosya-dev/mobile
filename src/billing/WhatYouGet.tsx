import { View } from "react-native";
import { useT } from "@/lib/i18n";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { featureLines, type PaywallRow } from "./paywallModel";

/** What the chosen tier includes, at most four lines (see featureLines). */
export function WhatYouGet({ row }: { row: PaywallRow }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View testID="what-you-get" className="rounded-xl border border-border bg-card px-4 py-3">
      <Text className="mb-2 text-xs uppercase text-muted-foreground" style={{ letterSpacing: 1.5, fontFamily: fonts.medium }}>
        {t("upgrade.heading.whatYouGet")}
      </Text>
      {featureLines(row).map((line) => (
        <View key={line.key} className="flex-row items-start gap-2 py-0.5">
          <Icon name="checkmark" size={16} color={tokens.brand} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-sm text-foreground">{t(line.key, line.params)}</Text>
        </View>
      ))}
    </View>
  );
}
