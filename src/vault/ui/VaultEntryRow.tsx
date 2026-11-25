import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatBytes } from "@/files/format";
import type { VaultEntry } from "@/vault/engine";
import { useT } from "@/lib/i18n";

/**
 * One entry in a Space.
 *
 * No thumbnail: a Vault file has no server-side derivative to show, and making
 * one would mean decrypting every file in the folder just to fill a list.
 */
export function VaultEntryRow({ entry, onPress, onMore }: { entry: VaultEntry; onPress: () => void; onMore: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const isFolder = entry.kind === "folder";
  return (
    <Pressable
      testID={`vault-entry-${entry.id}`}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3"
    >
      <Icon name={isFolder ? "folder" : "document-outline"} size={24} color={isFolder ? tokens.primary : tokens.mutedForeground} />
      <View className="flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>{entry.name}</Text>
        {!isFolder && entry.size !== null ? (
          <Text className="text-xs text-muted-foreground">{formatBytes(entry.size)}</Text>
        ) : null}
      </View>
      <Pressable
        testID={`vault-entry-more-${entry.id}`}
        accessibilityRole="button"
        accessibilityLabel={t("files.accessibility.actionsForName", { name: entry.name })}
        hitSlop={8}
        onPress={onMore}
      >
        <Icon name="ellipsis-horizontal" size={20} color={tokens.mutedForeground} />
      </Pressable>
    </Pressable>
  );
}
