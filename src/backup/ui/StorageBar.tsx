import { View } from "react-native";
import { Text } from "@/ui/Text";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * Workspace storage meter: how much of the plan's quota is used, with the
 * remaining space spelled out. Fill turns destructive at ≥ 90% so running
 * out of space is visible before a backup starts failing on it.
 */
export function StorageBar({ used, total }: { used: number; total: number }) {
  const t = useT();
  if (!(total > 0)) return null;
  const pct = Math.min(100, Math.round((used / total) * 100));
  const warning = pct >= 90;
  return (
    <View testID="storage-bar" className="mt-6 rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-baseline justify-between">
        <Text testID="storage-label" className="text-xs text-muted-foreground">
          {t("backup.label.usedsizeOfTotalSizeUsed", { usedSize: formatBytes(used), totalSize: formatBytes(total) })}
        </Text>
        <Text testID="storage-free" className={"text-xs font-medium " + (warning ? "text-destructive" : "text-foreground")}>
          {t("backup.label.freesizeFree", { freeSize: formatBytes(Math.max(0, total - used)) })}
        </Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
        <View
          testID="storage-fill"
          className={"h-full rounded-full " + (warning ? "bg-destructive" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </View>
    </View>
  );
}
