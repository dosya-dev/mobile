import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useVault } from "@/vault/store";
import { useT } from "@/lib/i18n";
import { SaveCancelled, saveOutcomeMessage, saveToDevice } from "@/files/saveToDevice";
import { OnboardingFrame, OnboardingHeading, PrimaryPill, StepBar } from "./OnboardingFrame";
import { groupRecoveryKey } from "./passphraseStrength";

/** Not translated: it is a file name, and the same one in every language keeps support answers simple. */
const FILE_NAME = "dosya-vault-recovery-key";

/**
 * Setup, step 2: the recovery key, shown once.
 *
 * The store hands it over exactly once (`recoveryKeyOnce`) and forgets it when
 * this step is finished; there is no second chance to read it. So there is no
 * Back here - the Vault already exists - and Finish stays off until the person
 * says the key is somewhere safe.
 *
 * Every way out (copy, file, share) carries the key WITHOUT the grouping
 * spaces: the groups are for reading, and the unlock screen takes either.
 */
export function RecoveryKeyStep(props: { onDone: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const recoveryKey = useVault((s) => s.recoveryKeyOnce);
  const [stored, setStored] = useState(false);
  if (!recoveryKey) return null;
  const bare = recoveryKey.replace(/\s+/g, "");
  const groups = groupRecoveryKey(bare);

  const copy = async () => {
    await Clipboard.setStringAsync(bare);
    toast(t("common.status.copied"));
  };

  const saveFile = async () => {
    const uri = `${FileSystem.cacheDirectory}${FILE_NAME}.txt`;
    const body = [t("vault.label.dosyaVaultRecoveryKey"), "", bare, "", t("vault.description.keepThisFileSomewhereSafeWithItAnyoneWhoCanSignIn")].join("\n");
    try {
      await FileSystem.writeAsStringAsync(uri, body);
      const outcome = await saveToDevice({ localUri: uri, fileName: FILE_NAME, mimeType: "text/plain", extension: "txt", sizeBytes: body.length });
      toast(saveOutcomeMessage(outcome));
    } catch (e) {
      if (e instanceof SaveCancelled) toast(e.message);
      else toast(t("vault.error.couldnTSaveTheFile"), "error");
    } finally {
      // The copy in the cache is the key in plain text: never leave it there.
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  };

  const share = () => {
    void Share.share({ message: bare }).catch(() => {});
  };

  const finish = () => {
    useVault.getState().dismissRecoveryKey();
    props.onDone();
  };

  return (
    <OnboardingFrame
      testID="vault-recovery"
      scroll
      step={t("vault.label.stepIndexOfCount", { index: 2, count: 2 })}
      footer={
        <>
          <Pressable
            testID="vault-recovery-stored"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: stored }}
            onPress={() => setStored((s) => !s)}
            className="min-h-11 flex-row items-center gap-3 pb-2"
          >
            {stored ? (
              <View className="h-6 w-6 items-center justify-center rounded-[7px] bg-primary">
                <Icon name="checkmark" size={14} color={tokens.primaryForeground} strokeWidth={3} />
              </View>
            ) : (
              <View className="h-6 w-6 rounded-[7px] border-[1.5px] border-muted-foreground" />
            )}
            <Text className="flex-1 text-sm leading-5 text-foreground">{t("vault.label.iVeStoredMyRecoveryKeySomewhereSafe")}</Text>
          </Pressable>
          <PrimaryPill title={t("vault.action.finishSetup")} testID="vault-recovery-dismiss" disabled={!stored} onPress={finish} />
        </>
      }
    >
      <StepBar index={1} count={2} />
      <View className="gap-5 px-5 pt-6">
        <OnboardingHeading title={t("vault.label.saveYourRecoveryKey")} body={t("vault.description.ifYouForgetYourPassphraseThisIsTheOnlyWayBackIn")} />

        <View className="gap-3.5 rounded-[20px] bg-primary p-[18px]">
          <Text className="text-xs tracking-wide text-primary-foreground/60" style={{ fontFamily: fonts.medium }}>{t("vault.label.recoveryKey")}</Text>
          <View
            testID="vault-recovery-key-value"
            accessible
            // Read out as the bare string; the grid would be sixteen separate stops.
            accessibilityLabel={bare.split("").join(" ")}
            className="flex-row flex-wrap"
            // The key reads left to right in every language.
            style={{ direction: "ltr", rowGap: 10 }}
          >
            {groups.map((g, i) => (
              <Text key={i} selectable className="w-1/4 text-base text-primary-foreground" style={{ fontFamily: fonts.mono }}>
                {g}
              </Text>
            ))}
          </View>
        </View>

        <View className="-mt-2 flex-row gap-2">
          <KeyAction icon="copy-outline" label={t("common.copy")} testID="vault-recovery-copy" onPress={() => void copy()} />
          <KeyAction icon="download-outline" label={t("vault.action.saveFile")} testID="vault-recovery-save" onPress={() => void saveFile()} />
          <KeyAction icon="share-outline" label={t("common.action.share")} testID="vault-recovery-share" onPress={share} />
        </View>

        <View className="flex-row items-start gap-2.5 rounded-2xl p-3.5" style={{ backgroundColor: tokens.warning + "1A" }}>
          <Icon name="information-circle-outline" size={18} color={tokens.warning} />
          <Text className="flex-1 text-sm leading-5 text-foreground">{t("vault.description.aPasswordManagerIsTheSafestPlaceScreenshotsCanEndUp")}</Text>
        </View>
      </View>
    </OnboardingFrame>
  );
}

function KeyAction(props: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      onPress={props.onPress}
      className="h-16 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-border bg-card"
    >
      <Icon name={props.icon} size={20} color={tokens.foreground} />
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{props.label}</Text>
    </Pressable>
  );
}
