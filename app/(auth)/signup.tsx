import { translateExternal } from "@/lib/external-text";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/auth/authStore";
import { fetchEmailSignupOpen } from "@/auth/api";
import { fonts } from "@/theme/fonts";
import { AuthCard } from "@/ui/AuthCard";
import { BrandHeader } from "@/ui/BrandHeader";
import { AuthProviders } from "@/ui/AuthProviders";
import { OrDivider } from "@/ui/OrDivider";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { validateEmail, validatePassword } from "@/lib/validationPolicy.generated";
import { useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";

export default function SignUpScreen() {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const signUp = useAuthStore((s) => s.signUp);
  const storeError = useAuthStore((s) => s.error);
  const error = localError ?? storeError;
  // Email sign-up is switched on and off from the admin dashboard, and the API
  // refuses it when off. Null while asking, so the form never flashes up and
  // vanishes; if the question itself fails, show the form and let the server
  // have the final say.
  const [emailSignupOpen, setEmailSignupOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetchEmailSignupOpen(ctrl.signal)
      .then((open) => setEmailSignupOpen(open))
      .catch(() => { if (!ctrl.signal.aborted) setEmailSignupOpen(true); });
    return () => ctrl.abort();
  }, []);

  const onSubmit = async () => {
    if (!terms) { setLocalError(t("sign-up.description.pleaseAcceptTheTermsOfServiceToContinue")); return; }
    // This screen used to check the terms box and nothing else, so every
    // malformed address and every weak password cost a round trip - and on a
    // phone connection that is the difference between a correctable mistake and
    // a form that feels broken. Same rules and same sentences as the API.
    const trimmedName = name.trim();
    if (!trimmedName) { setLocalError(t("common.error.nameIsRequired")); return; }
    const emailError = validateEmail(email.trim());
    if (emailError) { setLocalError(translateExternal(emailError)); return; }
    const passwordError = validatePassword(password);
    if (passwordError) { setLocalError(translateExternal(passwordError)); return; }
    setLocalError(null);
    setSubmitting(true);
    await signUp(trimmedName, email.trim(), password);
    setSubmitting(false);
  };

  return (
    <AuthCard>
      <Pressable accessibilityRole="button" testID="signup-back" onPress={() => router.replace("/(auth)/welcome")}>
        <Text className="mb-3 p-1 text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("common.back")}</Text>
      </Pressable>
      <BrandHeader title={t("sign-up.heading.createAnAccount")} subtitle={t("sign-up.description.5GBFreeSetupTakesAboutAMinuteAfterThis")} />

      {error ? (
        <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>
        </View>
      ) : null}

      <AuthProviders />

      {emailSignupOpen === true ? (<>
      <OrDivider />

      <TextField label={t("common.label.name")} testID="name" value={name} onChangeText={setName} placeholder={t("common.placeholder.janeDoe")} autoCapitalize="sentences" />
      <TextField label={t("common.label.email")} testID="email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder={t("common.placeholder.nameExampleCom")} />
      <TextField label={t("common.label.password")} testID="password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="••••••••" />

      {/* The single consent point on this screen. Both documents are named
          here - the Terms are the contract, the Privacy Policy is the notice
          owed at the moment personal data is collected - and both open the
          in-app screens backed by src/legal/content.ts rather than bouncing
          out to the system browser mid-signup. */}
      <View className="mb-4 flex-row items-start gap-2">
        <Checkbox checked={terms} onChange={setTerms} testID="terms" />
        <Text className="flex-1 text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {richText(
            t("sign-up.label.iAgreeToTheLink1AndAcknowledgeTheLink2"),
            {
              link1: (
                <Text testID="terms-link" className="text-foreground underline" style={{ fontFamily: fonts.medium }} onPress={() => router.push("/terms")}>
                  {t("legal.heading.termsOfService")}
                </Text>
              ),
              link2: (
                <Text testID="privacy-link" className="text-foreground underline" style={{ fontFamily: fonts.medium }} onPress={() => router.push("/privacy")}>
                  {t("legal.heading.privacyPolicy")}
                </Text>
              ),
            },
          )}
        </Text>
      </View>

      <Button title={t("sign-up.action.createAccount")} onPress={onSubmit} loading={submitting} testID="create" />
      </>) : null}

      {/* Covers the provider buttons at the top of this screen: OAuth creates a
          real account without ever touching the checkbox above, and the API
          stamps those accounts as having accepted the Terms. This line is what
          that stamp rests on. */}
      <Text className="mt-4 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {richText(
          t("common.description.byContinuingYouAgreeToOurLink1AndLink2"),
          {
            link1: (
              <Text testID="oauth-terms-link" className="text-xs text-primary underline" style={{ fontFamily: fonts.regular }} onPress={() => router.push("/terms")}>{t("legal.heading.termsOfService")}</Text>
            ),
            link2: (
              <Text testID="oauth-privacy-link" className="text-xs text-primary underline" style={{ fontFamily: fonts.regular }} onPress={() => router.push("/privacy")}>{t("legal.heading.privacyPolicy")}</Text>
            ),
          },
        )}
      </Text>

      <View className="mt-6 flex-row justify-center">
        <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("sign-up.description.alreadyHaveAnAccount")} </Text>
        <Pressable testID="go-login" onPress={() => router.push("/(auth)/login")}>
          <Text className="text-sm text-foreground underline" style={{ fontFamily: fonts.medium }}>{t("common.action.logIn")}</Text>
        </Pressable>
      </View>
    </AuthCard>
  );
}
