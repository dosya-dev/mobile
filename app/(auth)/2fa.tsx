import { useState } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { useAuthStore } from "@/auth/authStore";
import { fonts } from "@/theme/fonts";
import { AuthCard } from "@/ui/AuthCard";
import { BrandHeader } from "@/ui/BrandHeader";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { useT } from "@/lib/i18n";

export default function TwoFactorScreen() {
  const t = useT();
  const [code, setCode] = useState("");
  const [isRecovery, setIsRecovery] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submit2fa = useAuthStore((s) => s.submit2fa);
  const pending = useAuthStore((s) => s.pending2fa);
  const error = useAuthStore((s) => s.error);

  const onSubmit = async () => {
    setSubmitting(true);
    await submit2fa(code.trim(), isRecovery);
    setSubmitting(false);
  };

  const hint = isRecovery
    ? t("two-factor.label.enterOneOfYourRecoveryCodes")
    : pending?.method === "email"
      ? t("common.label.enterTheCodeWeEmailedYou")
      : t("two-factor.label.enterTheCodeFromYourAuthenticatorApp");

  return (
    <AuthCard>
      <BrandHeader title={t("common.heading.twoFactorAuthentication")} subtitle={hint} />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>
        </View>
      ) : null}

      <TextField
        label={isRecovery ? t("two-factor.label.recoveryCode") : t("common.label.code")}
        testID="code"
        value={code}
        onChangeText={setCode}
        keyboardType={isRecovery ? "default" : "number-pad"}
        autoCapitalize="none"
      />

      <Button title={t("common.action.verify")} onPress={onSubmit} loading={submitting} testID="verify" />
      <View className="h-3" />
      <Button
        title={isRecovery ? t("two-factor.action.useAuthenticatorCode") : t("two-factor.action.useARecoveryCode")}
        variant="ghost"
        onPress={() => setIsRecovery((v) => !v)}
        testID="toggle-recovery"
      />
    </AuthCard>
  );
}
