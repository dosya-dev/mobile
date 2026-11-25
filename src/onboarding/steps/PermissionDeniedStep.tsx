import { Linking, Platform, View } from "react-native";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { StepScreen } from "../ui/StepScreen";

/**
 * A denial is a state, not a crash. The OS will not ask again from inside the
 * app, so the exact path out is the only useful thing this screen can offer -
 * and "Continue without backup" keeps the rest of the product reachable.
 */
export function PermissionDeniedStep({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  const path = Platform.OS === "ios"
    ? t("onboarding.label.settingsDosyaDevPhotosFullAccess")
    : t("onboarding.label.settingsAppsDosyaDevPermissionsPhotosAndVideos");
  return (
    <StepScreen
      step={2}
      testID="onboarding-photos-denied"
      title={t("onboarding.heading.photoAccessIsOff")}
      subtitle={t("onboarding.description.photoBackupCannotRunWithoutItAndTheSystemWillNotAskAgainFrom")}
      primaryLabel={t("onboarding.action.openSettings")}
      // openSettings() rejects on any OS that refuses the jump. This is the
      // ONE way out of the permission-denied journey, so an uncaught rejection
      // here is a dead end with no message at all - the written path below is
      // the fallback, and the toast is what points at it. Same
      // .catch-into-a-toast shape as app/workspace-settings.tsx.
      onPrimary={() => {
        void Linking.openSettings().catch(() => {
          toast(t("onboarding.error.couldnTOpenSettingsUseThePathBelowInstead"), "error");
        });
      }}
      secondaryLabel={t("onboarding.action.continueWithoutBackup")}
      onSecondary={onContinue}
    >
      <View className="rounded-2xl border border-border bg-card p-4">
        <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>
          {t("onboarding.label.toTurnItOnLater")}
        </Text>
        <Text className="mt-2 text-xs leading-5 text-muted-foreground" style={{ fontFamily: fonts.mono }}>
          {path}
        </Text>
      </View>
      <View className="mt-4 rounded-2xl border border-border bg-card p-4">
        <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>
          {t("onboarding.label.youCanStillUseEverythingElse")}
        </Text>
        <Text className="mt-1 text-xs leading-5 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("onboarding.description.uploadManuallyBrowseYourFilesShareLinksAndUseTheVault")}
        </Text>
      </View>
    </StepScreen>
  );
}
