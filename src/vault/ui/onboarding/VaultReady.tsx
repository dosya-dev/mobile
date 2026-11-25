import { View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { OnboardingFrame, OnboardingHeading, PrimaryPill, QuietButton } from "./OnboardingFrame";

/**
 * The end of setup: the Vault exists and is open, and the next useful thing
 * is a Space to put files in. Two facts people otherwise learn by surprise -
 * it locks itself, and sharing keeps the encryption - are said once here.
 */
export function VaultReady(props: { onCreateSpace: () => void; onDone: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <OnboardingFrame
      testID="vault-ready"
      scroll
      footer={
        <>
          <PrimaryPill title={t("vault.action.createYourFirstSpace")} icon="add" onPress={props.onCreateSpace} testID="vault-ready-create" />
          <QuietButton title={t("vault.action.goToVault")} onPress={props.onDone} testID="vault-ready-done" />
        </>
      }
    >
      <View className="items-center gap-6 px-7 pt-14">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View
            className="h-[120px] w-[120px] items-center justify-center rounded-[32px] bg-primary"
            style={{ shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 8 }}
          >
            <Icon name="lock-closed-outline" size={48} color={tokens.primaryForeground} />
          </View>
          <View
            className="absolute -bottom-2.5 -end-2.5 h-11 w-11 items-center justify-center rounded-full border-4 border-background"
            style={{ backgroundColor: tokens.brandText }}
          >
            <Icon name="checkmark" size={22} color={tokens.background} strokeWidth={3} />
          </View>
        </View>
        <View className="w-full items-center">
          <OnboardingHeading title={t("vault.heading.yourVaultIsReady")} body={t("vault.description.createASpaceToStartAddingFilesEverythingInItIsEncrypted")} />
        </View>
      </View>

      <View className="mx-5 mt-8 rounded-[18px] border border-border bg-card">
        <Fact icon="time-outline" title={t("vault.label.locksItself")} body={t("vault.description.after5MinutesAwayFromTheAppYouLlNeedYourPassphrase")} />
        <View className="ms-[66px] h-px bg-border" />
        <Fact icon="people-outline" title={t("vault.label.shareASpaceSafely")} body={t("vault.description.peopleYouAddGetTheirOwnKeyItStaysEncryptedForEach")} />
      </View>
    </OnboardingFrame>
  );
}

function Fact(props: { icon: IconName; title: string; body: string }) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row items-start gap-3.5 p-4">
      <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-background">
        <Icon name={props.icon} size={18} color={tokens.foreground} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{props.title}</Text>
        <Text className="text-sm leading-5 text-muted-foreground">{props.body}</Text>
      </View>
    </View>
  );
}
