import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { AuthCard } from "@/ui/AuthCard";
import { BrandHeader } from "@/ui/BrandHeader";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { requestResetCode, classifyResetError } from "@/auth/passwordReset";
import { useT } from "@/lib/i18n";

export default function ForgotPasswordScreen() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const canSubmit = trimmed.length > 3 && trimmed.includes("@") && !submitting;

  const goToCodeScreen = () => {
    router.push({
      pathname: "/(auth)/reset-password",
      params: { email: trimmed.toLowerCase() },
    });
  };

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await requestResetCode(trimmed);
      goToCodeScreen();
    } catch (e) {
      const failure = classifyResetError(e);
      // A cooldown 429 means a code was already sent and is still valid, so
      // stopping here would strand someone who simply tapped twice. Every other
      // failure is real and gets reported.
      if (failure.kind === "rate_limited") goToCodeScreen();
      else setError(failure.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard>
      <BrandHeader
        title={t("forgot-password.heading.resetYourPassword")}
        subtitle={t("forgot-password.description.enterYourEmailAndWeLlSendYouA6DigitCode")}
      />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }} testID="forgot-error">
            {error}
          </Text>
        </View>
      ) : null}

      <TextField
        label={t("common.label.email")}
        testID="email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder={t("common.placeholder.nameExampleCom")}
      />

      <Button title={t("profile.action.sendCode")} onPress={onSubmit} loading={submitting} disabled={!canSubmit} testID="send-code" />

      {/* Deliberately makes no claim about whether the address has an account.
          The endpoint is enumeration-safe and this copy has to stay that way. */}
      <Text
        className="mt-4 text-center text-xs text-muted-foreground"
        style={{ fontFamily: fonts.regular }}
      >
        {t("forgot-password.description.ifThatEmailHasAnAccountACodeWillArriveWithinAMinute")}
      </Text>

      <View className="mt-6 flex-row justify-center">
        <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("forgot-password.description.rememberedIt")}{" "}
        </Text>
        <Pressable testID="back-to-login" onPress={() => router.back()}>
          <Text className="text-sm text-foreground underline" style={{ fontFamily: fonts.medium }}>
            {t("common.action.logIn")}
          </Text>
        </Pressable>
      </View>
    </AuthCard>
  );
}
