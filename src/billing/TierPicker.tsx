import { Pressable, View } from "react-native";
import { useT } from "@/lib/i18n";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { stepTier, tickLabelIndexes } from "./paywallModel";

/** Width of one dot's slot; the track line runs between the first and last slot centres. */
const SLOT = 22;

/**
 * Pick a storage tier: − / + steps, one tappable dot per plan in catalog
 * order, the track filled up to the chosen tier. Taps only, no dragging.
 * Screen readers get one adjustable control that steps with swipe up/down.
 */
export function TierPicker(props: {
  tiers: { planId: string; storageLabel: string }[];
  index: number;
  onChange: (index: number) => void;
  /** Freezes the picker (e.g. while a purchase runs). */
  disabled?: boolean;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { tiers, index, onChange } = props;
  const frozen = !!props.disabled;
  const count = tiers.length;
  const atStart = frozen || index <= 0;
  const atEnd = frozen || index >= count - 1;
  const fillPct = count > 1 ? (index / (count - 1)) * 100 : 0;
  const labels = new Set(tickLabelIndexes(count));
  const go = (next: number) => {
    if (!frozen && next !== index) onChange(next);
  };

  return (
    <View className={"flex-row items-start gap-3" + (frozen ? " opacity-60" : "")} testID="tier-picker">
      <StepButton
        testID="tier-less"
        icon="remove"
        label={t("upgrade.action.lessSpace")}
        disabled={atStart}
        color={tokens.foreground}
        onPress={() => go(stepTier(index, -1, count))}
      />
      <View className="flex-1">
        <View
          testID="tier-track"
          accessible
          accessibilityRole="adjustable"
          accessibilityValue={{ text: tiers[index]?.storageLabel ?? "" }}
          accessibilityState={{ disabled: frozen }}
          accessibilityActions={frozen ? [] : [{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "increment") go(stepTier(index, 1, count));
            else if (e.nativeEvent.actionName === "decrement") go(stepTier(index, -1, count));
          }}
          style={{ height: 36, justifyContent: "center" }}
        >
          <View
            className="flex-row overflow-hidden rounded-full bg-muted"
            style={{ position: "absolute", left: SLOT / 2, right: SLOT / 2, height: 4 }}
          >
            <View className="rounded-full bg-brand" style={{ width: `${fillPct}%` }} />
          </View>
          <View className="flex-row justify-between">
            {tiers.map((tier, i) => {
              const on = i === index;
              return (
                <Pressable
                  key={tier.planId}
                  testID={`tier-dot-${tier.planId}`}
                  // 12 pt up and down; sideways only 4 pt so neighbouring dots' tap areas never overlap.
                  hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}
                  disabled={frozen}
                  onPress={() => go(i)}
                  style={{ width: SLOT, height: 36, alignItems: "center", justifyContent: "center" }}
                >
                  <View
                    className={on ? "border-4 border-card bg-brand" : i < index ? "bg-brand" : "bg-border"}
                    style={on ? { width: 22, height: 22, borderRadius: 11 } : { width: 8, height: 8, borderRadius: 4 }}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
        <View className="mt-1 flex-row justify-between" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {tiers.map((tier, i) => (
            <View key={tier.planId} style={{ width: SLOT, alignItems: "center" }}>
              {labels.has(i) ? (
                <Text
                  numberOfLines={1}
                  className={"text-center text-[11px] " + (i === index ? "text-foreground" : "text-muted-foreground")}
                  style={{ width: 64 }}
                >
                  {tier.storageLabel}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <StepButton
        testID="tier-more"
        icon="add"
        label={t("upgrade.action.moreSpace")}
        disabled={atEnd}
        color={tokens.foreground}
        onPress={() => go(stepTier(index, 1, count))}
      />
    </View>
  );
}

function StepButton(props: {
  testID: string;
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      hitSlop={6}
      onPress={props.onPress}
      className={"items-center justify-center rounded-full border border-border bg-card" + (props.disabled ? " opacity-40" : "")}
      style={{ width: 36, height: 36 }}
    >
      <Icon name={props.icon} size={18} color={props.color} />
    </Pressable>
  );
}
