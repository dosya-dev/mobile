import { Pressable } from "react-native";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; testID?: string; accessibilityLabel?: string }) {
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
      accessibilityLabel={props.accessibilityLabel}
      onPress={() => props.onChange(!props.checked)}
      hitSlop={8}
    >
      <Icon
        name={props.checked ? "checkbox" : "square-outline"}
        size={22}
        color={props.checked ? tokens.primary : tokens.mutedForeground}
      />
    </Pressable>
  );
}
