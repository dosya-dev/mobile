import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { PIN_LENGTH } from "./appLock";

const ROWS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];

/**
 * Full-screen number pad with PIN_LENGTH dots. Calls `onComplete` once the last
 * digit is typed and clears itself when that settles, so every caller gets a
 * fresh pad for the next try (or the confirm step) without managing digits.
 *
 * `biometric` puts a Face ID / fingerprint key in the bottom-left slot.
 */
export function PinPad(props: {
  title: string;
  description?: string;
  error?: string | null;
  onComplete: (pin: string) => void | Promise<void>;
  biometric?: { icon: IconName; label: string; onPress: () => void };
  footer?: ReactNode;
  testID?: string;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);

  const press = (d: string) => {
    if (busy || digits.length >= PIN_LENGTH) return;
    void Haptics.selectionAsync().catch(() => {});
    const next = digits + d;
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      setBusy(true);
      void Promise.resolve(props.onComplete(next)).finally(() => {
        setDigits("");
        setBusy(false);
      });
    }
  };

  const key = (d: string) => (
    <Pressable
      key={d}
      testID={`pin-key-${d}`}
      accessibilityRole="button"
      accessibilityLabel={d}
      onPress={() => press(d)}
      className="h-20 w-20 items-center justify-center rounded-full bg-muted active:opacity-60"
    >
      <Text className="text-3xl text-foreground" style={{ fontFamily: fonts.regular }}>{d}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView testID={props.testID} className="flex-1 items-center justify-center bg-background px-6">
      <Icon name="lock-closed-outline" size={28} color={tokens.mutedForeground} />
      <Text className="mt-4 text-center text-xl text-foreground" style={{ fontFamily: fonts.medium }}>{props.title}</Text>
      {props.description ? (
        <Text className="mt-2 max-w-xs text-center text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {props.description}
        </Text>
      ) : null}

      <View testID="pin-dots" accessibilityLabel={`${digits.length}/${PIN_LENGTH}`} className="mt-8 flex-row gap-4">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View
            key={i}
            className={"h-3.5 w-3.5 rounded-full border border-foreground" + (i < digits.length ? " bg-foreground" : "")}
          />
        ))}
      </View>
      <Text testID="pin-error" className="mt-4 h-5 text-center text-sm text-destructive" style={{ fontFamily: fonts.regular }}>
        {props.error ?? ""}
      </Text>

      <View className="mt-4 gap-4">
        {ROWS.map((row) => (
          <View key={row[0]} className="flex-row gap-6">{row.map(key)}</View>
        ))}
        <View className="flex-row gap-6">
          {props.biometric ? (
            <Pressable
              testID="pin-key-biometric"
              accessibilityRole="button"
              accessibilityLabel={props.biometric.label}
              onPress={props.biometric.onPress}
              className="h-20 w-20 items-center justify-center rounded-full active:opacity-60"
            >
              <Icon name={props.biometric.icon} size={30} color={tokens.foreground} />
            </Pressable>
          ) : (
            <View className="h-20 w-20" />
          )}
          {key("0")}
          <Pressable
            testID="pin-key-delete"
            accessibilityRole="button"
            accessibilityLabel={t("security.action.deleteDigit")}
            onPress={() => setDigits((s) => s.slice(0, -1))}
            disabled={busy || digits.length === 0}
            className={"h-20 w-20 items-center justify-center rounded-full active:opacity-60" + (digits.length === 0 ? " opacity-0" : "")}
          >
            <Icon name="backspace-outline" size={28} color={tokens.foreground} />
          </Pressable>
        </View>
      </View>

      {props.footer ? <View className="mt-6 items-center">{props.footer}</View> : null}
    </SafeAreaView>
  );
}
