import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { AuthCard } from "@/ui/AuthCard";
import { BrandHeader } from "@/ui/BrandHeader";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { useAuthStore } from "@/auth/authStore";
import {
  CODE_LENGTH, RESEND_COOLDOWN_SECONDS,
  normaliseCode, isCompleteCode, cooldownRemaining,
  requestResetCode, submitReset, classifyResetError,
} from "@/auth/passwordReset";
import { useT } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export default function ResetPasswordScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email ?? "").toLowerCase();
  const signIn = useAuthStore((s) => s.signIn);

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The screen is reached straight after a send, so the cooldown starts now.
  const [sentAt, setSentAt] = useState<number>(() => Date.now());
  const [remaining, setRemaining] = useState<number>(RESEND_COOLDOWN_SECONDS);

  // A visible countdown, not a dead button: the server rejects a resend inside
  // 30s, so the control has to say when it will work rather than just fail.
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const update = () => setRemaining(cooldownRemaining(sentAt, Date.now()));
    update();
    tick.current = setInterval(update, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [sentAt]);

  const passwordsMatch = password.length > 0 && password === confirm;
  const canSubmit = isCompleteCode(code) && passwordsMatch && !submitting;

  const onResend = async () => {
    if (remaining > 0) return;
    setError(null);
    try {
      await requestResetCode(email);
      setSentAt(Date.now());
      setCode("");
    } catch (e) {
      setError(classifyResetError(e).message);
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!passwordsMatch) {
      setError(t("reset-password.error.thosePasswordsDoNotMatch"));
      return;
    }
    setSubmitting(true);
    try {
      await submitReset(email, code, password);
    } catch (e) {
      const failure = classifyResetError(e);
      // A burned code can never succeed again, so clear the field: leaving the
      // dead digits sitting there invites the user to just press the button
      // harder.
      if (failure.kind === "code_burned") setCode("");
      setError(failure.message);
      setSubmitting(false);
      return;
    }

    // The reset revoked every session and issued a new one as a cookie. Mobile
    // authenticates with tokens from SecureStore, so that cookie is unusable
    // here - sign in properly with the password we just set, which is also what
    // puts the user straight into the app instead of back at the login screen.
    try {
      await signIn(email, password);
      router.replace("/(tabs)/(files)");
    } catch {
      setError(t("reset-password.error.passwordUpdatedPleaseLogInWithYourNewPassword"));
      setSubmitting(false);
    }
  };

  return (
    <AuthCard>
      <BrandHeader
        title={t("reset-password.heading.enterYourCode")}
        subtitle={email
          ? t("reset-password.description.weSentACodeLengthDigitCodeToEmail", { codeLength: localDigits(CODE_LENGTH), email })
          : t("reset-password.description.enterTheCodeLengthDigitCodeWeEmailedYou", { codeLength: localDigits(CODE_LENGTH) })}
      />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }} testID="reset-error">
            {error}
          </Text>
        </View>
      ) : null}

      <TextField
        label={t("common.label.code")}
        testID="code"
        value={code}
        onChangeText={(text) => setCode(normaliseCode(text))}
        keyboardType="number-pad"
        autoCapitalize="none"
        placeholder="000000"
        mono
        maxLength={CODE_LENGTH}
      />

      <View className="-mt-2 mb-4 flex-row items-center justify-center">
        {remaining > 0 ? (
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }} testID="resend-countdown">
            {t("common.label.resendAvailableInRemainingS", { remaining: localDigits(remaining) })}
          </Text>
        ) : (
          <Pressable testID="resend" onPress={onResend} accessibilityRole="button" hitSlop={8}>
            <Text className="text-xs text-foreground underline" style={{ fontFamily: fonts.medium }}>
              {t("common.action.resendCode")}
            </Text>
          </Pressable>
        )}
      </View>

      <TextField
        label={t("common.label.newPassword")}
        testID="password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="••••••••"
      />
      <TextField
        label={t("common.label.confirmNewPassword")}
        testID="confirm"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        placeholder="••••••••"
      />
      {/* QA MOB-REG-013: the disabled button alone never said WHY. Say it
          under the field as soon as both have text and differ. */}
      {confirm.length > 0 && password !== confirm ? (
        <Text className="-mt-2 mb-4 text-xs text-destructive" style={{ fontFamily: fonts.regular }} testID="password-mismatch">
          {t("reset-password.error.thosePasswordsDoNotMatch")}
        </Text>
      ) : null}

      <Button
        title={t("forgot-password.action.resetPassword")}
        onPress={onSubmit}
        loading={submitting}
        disabled={!canSubmit}
        testID="submit-reset"
      />

      <View className="mt-6 flex-row justify-center">
        <Pressable testID="back-to-login" onPress={() => router.replace("/(auth)/login")}>
          <Text className="text-sm text-muted-foreground underline" style={{ fontFamily: fonts.regular }}>
            {t("reset-password.action.backToLogIn")}
          </Text>
        </Pressable>
      </View>
    </AuthCard>
  );
}
