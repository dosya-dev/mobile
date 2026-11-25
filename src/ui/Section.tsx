import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";

/** A titled card of rows - mirrors web's <h2> + <Card><CardContent>. */
export function Section(props: { title?: string; children: ReactNode }) {
  return (
    <View className="mb-6">
      {props.title ? (
        <Text className="mb-2 text-base text-foreground" style={{ fontFamily: fonts.bold }}>{props.title}</Text>
      ) : null}
      <View className="overflow-hidden rounded-lg border border-border bg-card">{props.children}</View>
    </View>
  );
}
