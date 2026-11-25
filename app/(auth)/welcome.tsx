import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { setWelcomeSeen } from "@/onboarding/onboardingState";
import { BackupArt, ReachArt, VaultArt } from "@/onboarding/ui/DeckArt";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { localDigits } from "@/lib/format-locale";

interface Slide {
  /** Message keys, not text: the text is produced at render so it follows the language. */
  title: MessageKey;
  body: MessageKey;
  /** The hero visual. Product surface, not an illustration of an idea. */
  art: () => React.JSX.Element;
  chips?: string[];
  footnote?: MessageKey;
}

/**
 * Value before signup. The app used to open on a login form, which asks a
 * first-time visitor to decide with nothing to decide on.
 *
 * Slide 3 states the Vault's real primitives rather than the word "secure".
 * AES-256 must never appear here: that is R2 at-rest encryption, and attaching
 * it to the end-to-end claim turns a true statement false. The Vault is also
 * not plan-gated, which is why the free plan is named.
 */
const SLIDES: Slide[] = [
  {
    title: "welcome.heading.everyPhotoOffYourPhoneAutomatically",
    body: "welcome.description.fullResolutionOriginalsCopiedToYourWorkspaceInTheBackgroundNotCompressedNotResized",
    art: BackupArt,
  },
  {
    title: "welcome.heading.theSameFilesOnEveryDeviceYouOwn",
    body: "welcome.description.webDesktopAndMobilePlusS3WebDAVSFTPAndRcloneIfYouWouldRather",
    art: ReachArt,
  },
  {
    title: "welcome.heading.encryptedOnYourPhoneBeforeItLeaves",
    body: "welcome.description.anythingYouPutInTheVaultIsEncryptedOnYourDeviceTheServerStores",
    art: VaultArt,
    chips: ["Argon2id", "XChaCha20-Poly1305", "HPKE (X25519)"],
    footnote: "welcome.description.theCodeThatDoesItIsSourceAvailableAndItIsIncludedOnThe",
  },
];

export default function WelcomeScreen() {
  const t = useT();
  const router = useRouter();
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const last = i === SLIDES.length - 1;

  const leave = async (to: "/(auth)/signup" | "/(auth)/login") => {
    await setWelcomeSeen();
    router.replace(to);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row justify-end px-6 pt-2">
        <Pressable
          testID="welcome-signin"
          accessibilityRole="button"
          accessibilityLabel={t("common.action.signIn")}
          onPress={() => { void leave("/(auth)/login"); }}
          hitSlop={12}
        >
          <Text className="p-2 text-base text-foreground" style={{ fontFamily: fonts.medium }}>{t("common.action.signIn")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="flex-grow justify-center px-6" showsVerticalScrollIndicator={false}>
        {/* The hero leads. It is decorative to assistive tech - every claim it
            makes is also stated in the title and body below it. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <slide.art />
        </View>
        <Text className="mt-7 text-3xl leading-9 text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
          {t(slide.title)}
        </Text>
        <Text className="mt-3 text-base leading-6 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t(slide.body)}
        </Text>
        {slide.chips ? (
          <View className="mt-5 flex-row flex-wrap gap-2">
            {slide.chips.map((c) => (
              <View key={c} className="rounded-full bg-secondary px-3 py-1.5">
                <Text className="text-xs text-secondary-foreground" style={{ fontFamily: fonts.mono }}>{c}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {slide.footnote ? (
          <Text className="mt-4 text-xs leading-5 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t(slide.footnote)}
          </Text>
        ) : null}
      </ScrollView>

      <View className="px-6 pb-8 pt-4">
        {/* Perceivable to assistive tech via role+value, not just the
            width/colour difference between the active and inactive dots
            (see StepScreen's progress bar for the same pattern). */}
        <View
          testID="welcome-progress"
          accessibilityRole="progressbar"
          accessibilityLabel={t("welcome.label.slideIndexOfTotal", { index: localDigits(i + 1), total: localDigits(SLIDES.length) })}
          accessibilityValue={{ min: 1, max: SLIDES.length, now: i + 1 }}
          className="mb-4 flex-row justify-center gap-1.5"
        >
          {SLIDES.map((s, n) => (
            <View
              key={s.title}
              className={`h-1.5 rounded-full ${n === i ? "w-5 bg-primary" : "w-1.5 bg-input"}`}
            />
          ))}
        </View>
        <Button
          testID="welcome-primary"
          title={last ? t("welcome.action.createAFreeAccount") : t("common.continue")}
          onPress={() => { if (last) void leave("/(auth)/signup"); else setI(i + 1); }}
        />
        <Text className="mt-3 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("welcome.description.5GBFreeNoCard")}
        </Text>
      </View>
    </SafeAreaView>
  );
}
