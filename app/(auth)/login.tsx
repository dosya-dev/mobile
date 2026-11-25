import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { getLastMethod, type LastMethod } from "@/auth/lastMethod";
import { fonts } from "@/theme/fonts";
import { AuthCard } from "@/ui/AuthCard";
import { BrandHeader } from "@/ui/BrandHeader";
import { AuthProviders } from "@/ui/AuthProviders";
import { PasskeySignIn } from "@/ui/PasskeySignIn";
import { OrDivider } from "@/ui/OrDivider";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { isValidEmail } from "@/lib/validationPolicy.generated";

export default function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastMethod, setLM] = useState<LastMethod | null>(null);
  const signIn = useAuthStore((s) => s.signIn);
  const storeError = useAuthStore((s) => s.error);
  // The server answers a malformed address with "Email and password are
  // required", which names the wrong problem (QA report, 2026-10-15). Check
  // the shape here and say so; an empty field still gets the server's line.
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? storeError;

  useEffect(() => { getLastMethod().then(setLM); }, []);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (trimmed && !isValidEmail(trimmed)) {
      setLocalError(t("common.error.validEmailIsRequired"));
      return;
    }
    setLocalError(null);
    setSubmitting(true);
    await signIn(trimmed, password);
    setSubmitting(false);
  };

  return (
    <AuthCard>
      <BrandHeader title={t("common.heading.welcomeBack")} subtitle={t("sign-in.label.enterYourCredentialsToAccessYourAccount")} />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>
        </View>
      ) : null}

      <AuthProviders lastMethod={lastMethod} />
      <PasskeySignIn lastMethod={lastMethod} />

      <OrDivider />

      <TextField label={t("common.label.email")} testID="email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder={t("common.placeholder.nameExampleCom")} />
      <TextField label={t("common.label.password")} testID="password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="••••••••" />

      <View className="-mt-2 mb-4 flex-row justify-end">
        <Pressable testID="go-forgot-password" onPress={() => router.push("/(auth)/forgot-password")} hitSlop={8}>
          <Text className="text-xs text-muted-foreground underline" style={{ fontFamily: fonts.regular }}>
            {t("sign-in.description.forgotPassword")}
          </Text>
        </Pressable>
      </View>

      <Button title={t("sign-in.action.logIn")} onPress={onSubmit} loading={submitting} testID="signin" />

      <Text className="mt-4 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {richText(
          t("common.description.byContinuingYouAgreeToOurLink1AndLink2"),
          {
            link1: (
              <Text testID="terms-link" className="text-xs text-primary underline" style={{ fontFamily: fonts.regular }} onPress={() => router.push("/terms")}>{t("legal.heading.termsOfService")}</Text>
            ),
            link2: (
              <Text testID="privacy-link" className="text-xs text-primary underline" style={{ fontFamily: fonts.regular }} onPress={() => router.push("/privacy")}>{t("legal.heading.privacyPolicy")}</Text>
            ),
          },
        )}
      </Text>

      <View className="mt-6 flex-row justify-center">
        <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("sign-in.description.donTHaveAnAccount")} </Text>
        <Pressable testID="go-signup" onPress={() => router.push("/(auth)/signup")}>
          <Text className="text-sm text-foreground underline" style={{ fontFamily: fonts.medium }}>{t("sign-in.action.signUp")}</Text>
        </Pressable>
      </View>
    </AuthCard>
  );
}
