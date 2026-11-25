import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { inputStartAlign } from "@/lib/direction";

export function TextField(props: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "email-address" | "default" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "characters";
  placeholder?: string;
  testID?: string;
  /**
   * Render the value as a literal machine value: mono face, wide tracking,
   * centred. For one-time codes and similar - not for prose, and not as a
   * "technical" costume.
   */
  mono?: boolean;
  maxLength?: number;
  /** The keyboard's action key, and what it does (a search field's "search"). */
  returnKeyType?: "done" | "search" | "go" | "next";
  onSubmitEditing?: () => void;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const [visible, setVisible] = useState(false);
  const isPassword = !!props.secureTextEntry;
  return (
    <View className="mb-4">
      {props.label ? (
        <Text className="mb-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
          {props.label}
        </Text>
      ) : null}
      <View className="relative justify-center">
        <TextInput
          testID={props.testID}
          className={
            "rounded-lg border border-border bg-card px-3 py-3 text-foreground" +
            (isPassword ? " pe-11" : "")
          }
          // fontSize is set here rather than via `text-base`: that class also sets
          // lineHeight (24), which clips descenders inside the padded input. Letting
          // the font pick its natural line height keeps the text fully visible.
          style={
            props.mono
              ? {
                  fontFamily: fonts.mono,
                  fontSize: 22,
                  letterSpacing: 8,
                  textAlign: "center",
                  // letterSpacing adds its gap AFTER the last glyph too, so a
                  // centred string sits half a gap left of true centre. Push it
                  // back by the same amount rather than eyeballing the padding. The
                  // digits run left to right in every language, so this stays physical.
                  // rtl-ok: centering
                  paddingLeft: 8,
                }
              // Starts at the start edge on iOS in RTL (see inputStartAlign).
              : { fontFamily: fonts.regular, fontSize: 16, ...inputStartAlign() }
          }
          maxLength={props.maxLength}
          // The label above is a separate sibling Text - RN never associates it with
          // the input for assistive tech on its own, so without this the field has no
          // accessible name at all when a placeholder isn't also set.
          accessibilityLabel={props.label}
          placeholder={props.placeholder}
          placeholderTextColor={tokens.mutedForeground}
          value={props.value}
          onChangeText={props.onChangeText}
          secureTextEntry={isPassword && !visible}
          keyboardType={props.keyboardType ?? "default"}
          autoCapitalize={props.autoCapitalize ?? "sentences"}
          autoCorrect={false}
          returnKeyType={props.returnKeyType}
          onSubmitEditing={props.onSubmitEditing}
        />
        {isPassword ? (
          <Pressable
            testID={props.testID ? `${props.testID}-eye` : undefined}
            onPress={() => setVisible((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={visible ? t("common.accessibility.hidePassword") : t("common.accessibility.showPassword")}
            hitSlop={8}
            className="absolute end-3"
          >
            <Icon name={visible ? "eye-off" : "eye"} size={20} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
