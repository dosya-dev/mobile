import { ActivityIndicator, Pressable } from "react-native";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";

export function Button(props: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** "brand": the green call to action (the paywall's Continue). */
  variant?: "primary" | "ghost" | "brand";
  testID?: string;
}) {
  const disabled = props.disabled || props.loading;
  const isGhost = props.variant === "ghost";
  const isBrand = props.variant === "brand";
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={props.onPress}
      className={
        (isGhost ? "bg-transparent" : isBrand ? "bg-brand" : "bg-primary") +
        // px-5 matters only where a Button is NOT stretched by its parent:
        // in a centred column or a row slot the Pressable shrinks to its label,
        // and without horizontal padding the text sat flush against both edges
        // (the reader's "Try again", Save-to's empty state, the workspace rows).
        // Stretched call sites are unaffected - the padding just sits inside.
        " rounded-lg px-5 py-3 items-center justify-center" +
        (disabled ? " opacity-60" : "")
      }
    >
      {props.loading ? (
        <ActivityIndicator {...(isBrand ? { color: tokens.brandForeground } : null)} />
      ) : (
        <Text
          className={(isGhost ? "text-primary" : isBrand ? "text-brand-foreground" : "text-primary-foreground") + " text-base"}
          style={{ fontFamily: fonts.medium }}
        >
          {props.title}
        </Text>
      )}
    </Pressable>
  );
}
