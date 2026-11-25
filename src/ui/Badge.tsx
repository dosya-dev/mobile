import { View } from "react-native";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";

export function Badge(props: { label: string; variant?: "secondary" | "outline" }) {
  const outline = props.variant === "outline";
  return (
    <View className={"rounded-full px-2 py-0.5 " + (outline ? "border border-border" : "bg-secondary")}>
      <Text
        className={"text-[10px] " + (outline ? "text-muted-foreground" : "text-secondary-foreground")}
        style={{ fontFamily: fonts.medium }}
      >
        {props.label}
      </Text>
    </View>
  );
}
