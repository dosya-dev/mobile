import { View } from "react-native";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";

export function OrDivider() {
  const t = useT();
  return (
    <View className="my-5 flex-row items-center">
      <View className="h-px flex-1 bg-border" />
      <Text className="mx-3 text-xs uppercase text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {t("common.label.or")}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
