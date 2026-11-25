import { useRef, useState } from "react";
import { Platform, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { requestPhotoAccess } from "../permissions";
import { StepScreen } from "../ui/StepScreen";

/** Message keys, not text: the text is produced at render so it follows the language. */
const POINTS: { icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { icon: "images", title: "onboarding.heading.originalsAtFullResolution", body: "onboarding.description.neverACompressedOrResizedCopy" },
  { icon: "wifi", title: "onboarding.heading.inTheBackgroundOnWiFi", body: "onboarding.description.youCanCloseTheAppItPicksUpWhereItLeftOff" },
  {
    icon: "lock-closed",
    title: "onboarding.heading.nothingUploadsYet",
    // This screen ships on both platforms, so it cannot name one of them: an
    // Android user was being told "iOS asks next". The platform is a value of
    // the message and is read at render.
    body: "onboarding.description.platformSelectIosIOSOtherAndroidAsksNextYouChooseWhatGetsBackedUp",
  },
];

/**
 * The rationale the OS dialog cannot carry. iOS shows that dialog once per
 * install, so it fires from the primary action here and nowhere else - never
 * on mount, never twice.
 *
 * Guideline 5.1.1(iv) governs the shape of this screen, and 1.0.0 (16) was
 * rejected on both halves of it:
 *
 *  - The button may not say "Allow". That word belongs to the OS dialog, and
 *    a custom button wearing it reads as the permission grant itself. Apple
 *    names "Continue" and "Next" as the acceptable wording.
 *  - There may be no way off this screen that SKIPS the OS dialog. The old
 *    "Not now" let the user dismiss the rationale and defer the request, which
 *    Apple treats as discouraging the prompt just as a pushy pre-prompt
 *    encourages it. Every exit now lands on the system dialog.
 *
 * Nothing is taken away from the user by that: declining is still one tap, it
 * just happens in Apple's dialog instead of ours, and PermissionDeniedStep
 * already turns a denial into a real screen with a way onward.
 */
export function PhotoAccessStep({
  workspaceName, onGranted, onDenied,
}: {
  workspaceName: string;
  onGranted: (p: "granted" | "limited") => void;
  onDenied: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [busy, setBusy] = useState(false);
  // See WorkspaceStep.tsx: `busy` only reaches the button's disabled prop on
  // the next render, which is too late to stop a second press landing in the
  // same tick as the first. A ref closes that gap. Here a second call isn't
  // just wasted work - the OS shows this dialog once per install, so letting
  // a double-tap fire it twice can burn the app's only real prompt.
  const inFlight = useRef(false);

  const onAsk = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await requestPhotoAccess();
      if (result === "denied") onDenied();
      else onGranted(result);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <StepScreen
      step={2}
      testID="onboarding-photos"
      title={t("onboarding.heading.turnOnPhotoBackup")}
      subtitle={t("onboarding.description.dosyaDevNeedsAccessToYourPhotoLibraryToCopyNewPhotosAndVideos", { workspaceName })}
      primaryLabel={t("common.continue")}
      onPrimary={() => { void onAsk(); }}
      primaryLoading={busy}
      footnote={t("onboarding.description.contactsBackupIsSetUpLaterFromTheContactsScreen")}
    >
      <View className="rounded-2xl border border-border bg-card">
        {POINTS.map((p, i) => (
          <View
            key={p.title}
            className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
              <Icon name={p.icon} size={19} color={tokens.foreground} />
            </View>
            <View className="flex-1">
              <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>
                {t(p.title)}
              </Text>
              <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                {t(p.body, { platform: Platform.OS === "ios" ? "ios" : "android" })}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </StepScreen>
  );
}
