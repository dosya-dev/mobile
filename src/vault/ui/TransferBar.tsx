import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { formatBytes } from "@/files/format";
import type { Transfer } from "@/vault/store";
import { useT } from "@/lib/i18n";

/**
 * What the Vault is moving right now.
 *
 * Deliberately plain rows rather than the Files tab's orbit button: a Vault
 * transfer is bound to the unlocked session, so it cannot outlive this screen
 * the way a normal upload can, and there is nothing for a global surface to
 * keep showing once the Vault locks.
 */
export function TransferBar({
  transfers,
  onRetry,
  onDismiss,
}: {
  transfers: Transfer[];
  onRetry: (transfer: Transfer) => void;
  onDismiss: (id: string) => void;
}) {
  const t = useT();
  if (transfers.length === 0) return null;
  return (
    <View>
      {transfers.map((tr) => (
        <View key={tr.id} testID={`vault-transfer-${tr.id}`} className="flex-row items-center gap-3 border-b border-border bg-card px-5 py-3">
          <View className="flex-1">
            <Text className="text-sm text-foreground" numberOfLines={1}>{tr.name}</Text>
            <Text className="text-xs text-muted-foreground">
              {tr.total > 0 ? t("common.label.sentOfTotal", { sent: formatBytes(tr.done), total: formatBytes(tr.total) }) : formatBytes(tr.done)}
            </Text>
            {tr.error ? <Text className="mt-0.5 text-xs text-destructive">{tr.error}</Text> : null}
          </View>
          {tr.retry ? (
            <Pressable
              testID={`vault-transfer-retry-${tr.id}`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onRetry(tr)}
            >
              <Text className="text-sm text-primary">{t("common.retry")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            testID={`vault-transfer-dismiss-${tr.id}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onDismiss(tr.id)}
          >
            <Text className="text-sm text-muted-foreground">{t("common.action.dismiss")}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
