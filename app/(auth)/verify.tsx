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

export default function VerifyScreen() {
  const t = useT();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const email = useAuthStore((s) => s.pendingVerificationEmail);
  const error = useAuthStore((s) => s.error);

  const onSubmit = async () => {
    setSubmitting(true);
    await verifyEmail(code.trim());
    setSubmitting(false);
  };

  return (
    <AuthCard>
      <BrandHeader
        title={t("verify.heading.verifyYourEmail")}
        subtitle={email ? t("verify.label.enterTheCodeWeEmailedToEmail", { email }) : t("common.label.enterTheCodeWeEmailedYou")}
      />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>
        </View>
      ) : null}

      <TextField label={t("common.label.verificationCode")} testID="code" value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" placeholder="123456" />

      <Button title={t("common.action.verify")} onPress={onSubmit} loading={submitting} testID="verify" />
    </AuthCard>
  );
}
