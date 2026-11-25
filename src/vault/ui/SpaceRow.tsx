import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import type { KnownSpace } from "@/vault/store";
import { useT } from "@/lib/i18n";

/** One Space in the Vault's list. Same row shape as the Files browser's folders. */
export function SpaceRow({ space, border, onPress }: { space: KnownSpace; border?: boolean; onPress: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={`space-row-${space.id}`}
      accessibilityRole="button"
      onPress={onPress}
      className={"flex-row items-center gap-3 px-4 py-3" + (border ? " border-b border-border" : "")}
    >
      <Icon name="folder-outline" size={22} color={tokens.mutedForeground} />
      <View className="flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>{space.name}</Text>
        {space.shared ? <Text className="mt-0.5 text-xs text-muted-foreground">{t("vault.status.sharedSpace")}</Text> : null}
      </View>
      <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
    </Pressable>
  );
}
