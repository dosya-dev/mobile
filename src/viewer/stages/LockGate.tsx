import { useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import type { StagePalette } from "../stageTheme";
import { inputStartAlign } from "@/lib/direction";

/**
 * The password gate for a full_lock file, on the stage itself.
 *
 * It used to be a system prompt dialog launched from a button, which put the
 * keyboard over the screen and hid which file was being unlocked. Inline, the
 * filename stays visible in the sheet below the whole time.
 *
 * Only full_lock ever reaches here. view_only has no password and nothing to
 * unlock to - it is readable already and never downloadable - and treating the
 * two the same is exactly what once left view-only files unopenable on mobile.
 */
export function LockGate(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  palette: StagePalette;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const canSubmit = password.length > 0 && !props.busy;

  return (
    <View className="flex-1 items-center justify-center gap-3.5 px-9">
      <View
        className="h-[70px] w-[70px] items-center justify-center rounded-full border"
        style={{ backgroundColor: props.palette.chrome, borderColor: props.palette.hairline }}
      >
        <Icon name="lock-closed-outline" size={28} color={props.palette.fg} />
      </View>
      <Text className="text-[17px] font-bold" style={{ color: props.palette.fg }}>
        {t("common.heading.passwordRequired")}
      </Text>
      <Text className="max-w-[260px] text-center text-[13px] leading-5" style={{ color: props.palette.fgMuted }}>
        {t("files.description.thisFileIsLockedEnterItsPasswordToPreviewOrDownloadIt")}
      </Text>

      <View
        className="mt-1.5 h-[46px] w-full flex-row items-center gap-2.5 rounded-xl border ps-4 pe-2"
        style={{ backgroundColor: props.palette.chrome, borderColor: props.palette.hairline }}
      >
        <TextInput
          testID="unlock-password"
          value={password}
          onChangeText={setPassword}
          placeholder={t("common.placeholder.password")}
          placeholderTextColor={props.palette.fgMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => { if (canSubmit) props.onSubmit(password); }}
          className="flex-1 text-[15px]"
          style={{ color: props.palette.fg, fontFamily: fonts.regular, ...inputStartAlign() }}
        />
        <Pressable
          testID="unlock"
          accessibilityRole="button"
          accessibilityLabel={t("common.action.unlock")}
          disabled={!canSubmit}
          onPress={() => props.onSubmit(password)}
          className={"h-8 items-center justify-center rounded-lg bg-primary px-3.5" + (canSubmit ? "" : " opacity-50")}
        >
          {props.busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-[13px] font-bold text-primary-foreground">{t("common.action.unlock")}</Text>
          )}
        </Pressable>
      </View>

      {props.error ? (
        <Text testID="unlock-error" className="text-[12.5px]" style={{ color: "#f2565f" }}>
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}
