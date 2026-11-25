import { View } from "react-native";
import { Text } from "@/ui/Text";
import { DosyaLogo } from "./brand-icons";
import { fonts } from "@/theme/fonts";

/**
 * Branded auth-card header: the dosya.dev folder mark + italic Space Mono wordmark
 * + title + subtitle - mirroring the web login card.
 *
 * Font families are set explicitly rather than via font-weight classes: RN can't
 * synthesise a weight from a single-weight face, so each weight is its own family.
 */
export function BrandHeader(props: { title: string; subtitle: string }) {
  return (
    <View className="mb-8 items-center">
      <View className="flex-row items-center gap-2" accessibilityLabel="dosya.dev">
        <DosyaLogo size={28} />
        <Text className="text-lg text-foreground" style={{ fontFamily: fonts.mono, fontStyle: "italic" }}>
          dosya.dev
        </Text>
      </View>
      <Text className="mt-3 text-2xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
        {props.title}
      </Text>
      <Text className="mt-1 text-center text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {props.subtitle}
      </Text>
    </View>
  );
}
