import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { byteCount } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";

/**
 * Three figures under the ring: backed up, pending, failed. One strip rather
 * than tiles, because the ring above already carries the headline number and
 * these are its breakdown. Failed is a way in: the engine stops retrying past
 * its attempt cap and only the failed-items screen releases them.
 */
export function CoverageFigures({
  uploaded,
  pending,
  failed,
  skipped,
  onPressFailed,
}: {
  uploaded: number;
  pending: number;
  failed: number;
  /** Items past the user's size limit. Never retried, so never "pending". */
  skipped: number;
  onPressFailed?: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const failedIsWayIn = failed > 0 || skipped > 0;
  return (
    <View className="mt-4 flex-row overflow-hidden rounded-2xl border border-border bg-card">
      <Figure label={t("backup.label.backedUp")}>
        <Text testID="count-uploaded" className="text-lg font-bold text-foreground">
          {uploaded}
        </Text>
      </Figure>
      <Figure label={t("backup.label.pending")}>
        <Text testID="count-pending" className="text-lg font-bold text-foreground">
          {pending}
        </Text>
      </Figure>
      <Pressable
        testID="failed-tile"
        accessibilityRole={failedIsWayIn ? "button" : undefined}
        accessibilityLabel={failedIsWayIn ? t("backup.error.failedItems") : undefined}
        accessibilityState={{ disabled: !failedIsWayIn }}
        disabled={!failedIsWayIn || !onPressFailed}
        onPress={onPressFailed}
        className="flex-1 items-center px-1 py-2.5"
      >
        <Text testID="count-error" className={`text-lg font-bold ${failed > 0 ? "text-destructive" : "text-foreground"}`}>
          {failed}
        </Text>
        <View className="flex-row items-center gap-0.5">
          <Text className="text-[10px] text-muted-foreground">{t("common.error.failed")}</Text>
          {failedIsWayIn ? <Icon name="chevron-forward" size={10} color={tokens.mutedForeground} /> : null}
        </View>
        {skipped > 0 ? (
          <Text testID="count-skipped" className="mt-0.5 text-[10px] text-muted-foreground">
            {t("backup.label.skippedTooLarge", { skipped: byteCount(skipped) })}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-1 items-center border-border px-1 py-2.5" style={{ borderEndWidth: 1 }}>
      {children}
      <Text className="text-[10px] text-muted-foreground">{label}</Text>
    </View>
  );
}
