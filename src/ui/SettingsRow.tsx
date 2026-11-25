import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";

/** One row of a settings list: optional icon, label (+ description), and a right slot. */
export function SettingsRow(props: {
  icon?: IconName;
  label: string;
  description?: ReactNode;
  /** Current state shown before the chevron (e.g. "On", "System"), so the screen
   * reports the setting without a tap. */
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  border?: boolean;
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  const showChevron = !!props.onPress && props.right === undefined;

  const body = (
    <View className={"flex-row items-center gap-3 px-4 py-3" + (props.border ? " border-b border-border" : "")}>
      {props.icon ? <Icon name={props.icon} size={20} color={tokens.mutedForeground} /> : null}
      <View className="flex-1">
        <Text className="text-base text-foreground" style={{ fontFamily: fonts.regular }}>{props.label}</Text>
        {props.description ? (
          <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {props.description}
          </Text>
        ) : null}
      </View>
      {props.value ? (
        <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {props.value}
        </Text>
      ) : null}
      {props.right ?? null}
      {showChevron ? (
        <Icon
          testID={props.testID ? `${props.testID}-chevron` : undefined}
          name="chevron-forward"
          size={18}
          color={tokens.mutedForeground}
        />
      ) : null}
    </View>
  );

  if (!props.onPress) return <View testID={props.testID}>{body}</View>;
  return (
    <Pressable testID={props.testID} accessibilityRole="button" onPress={props.onPress}>
      {body}
    </Pressable>
  );
}
