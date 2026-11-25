import { Pressable, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { attentionHeading, type AttentionId, type AttentionItem } from "./attention";

const ICONS: Record<AttentionId, IconName> = {
  "finish-setup": "flag",
  "photo-access": "images",
  "limited-access": "images",
  "nothing-selected": "folder-open",
  "choose-what": "options",
  excluded: "eye-off",
  blocked: "pause-circle",
  offline: "cloud-offline",
  "waiting-for-wifi": "wifi",
  "cellular-data": "cellular",
};

/**
 * One card above the ring for everything that needs the user, instead of a
 * stack of banners that pushed the engine below the fold. The rows are
 * derived in attention.ts; this only draws them.
 */
export function AttentionList({
  items,
  firstRun,
  onPress,
}: {
  items: AttentionItem[];
  /** No run has ever completed: the heading says "before the first backup". */
  firstRun: boolean;
  onPress: (id: AttentionId) => void;
}) {
  const { tokens } = useColorTheme();
  if (items.length === 0) return null;
  const heading = attentionHeading(items.length, firstRun);
  return (
    <View testID="attention" className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
      {heading ? (
        <View className="flex-row items-center gap-2 border-b border-border bg-secondary px-3 py-2">
          <Icon name="alert-circle" size={16} color={tokens.secondaryForeground} />
          <Text testID="attention-heading" className="text-xs font-medium text-secondary-foreground">
            {heading}
          </Text>
        </View>
      ) : null}
      {items.map((item, idx) => {
        const color = item.tone === "warn" ? tokens.destructive : tokens.primary;
        const last = idx === items.length - 1;
        return (
          <Pressable
            key={item.id}
            testID={`attention-${item.id}`}
            accessibilityRole={item.actionable ? "button" : undefined}
            accessibilityLabel={item.actionable ? item.title : undefined}
            disabled={!item.actionable}
            onPress={() => onPress(item.id)}
            className={`flex-row items-center gap-3 px-3 py-2.5 ${last ? "" : "border-b border-border"}`}
          >
            <Icon name={ICONS[item.id]} size={18} color={color} />
            <View className="flex-1">
              <Text className="text-xs font-semibold text-foreground">{item.title}</Text>
              <Text className="mt-0.5 text-xs leading-4 text-muted-foreground">{item.detail}</Text>
            </View>
            {item.actionable ? <Icon name="chevron-forward" size={16} color={tokens.mutedForeground} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
