import { Pressable } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";

/** One cell of the Settings shortcut grid: a place you visit, not a thing you configure. */
export function ShortcutTile(props: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      testID={props.testID}
      onPress={props.onPress}
      className="items-center gap-1.5 rounded-lg border border-border bg-card py-3"
      style={{ width: "23.5%" }}
    >
      <Icon name={props.icon} size={22} color={tokens.foreground} />
      <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
        {props.label}
      </Text>
    </Pressable>
  );
}
