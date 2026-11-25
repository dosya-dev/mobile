import { useState } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Icon } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useVault } from "@/vault/store";
import { useT } from "@/lib/i18n";
import { OnboardingFrame, OnboardingHeading, PrimaryPill, StepBar } from "./OnboardingFrame";
import { GOOD_LENGTH, GOOD_WORDS, filledSegments, isAcceptable, strengthOf, wordCount, type Strength } from "./passphraseStrength";

/**
 * Setup, step 1: choose the passphrase the Vault's keys are wrapped with.
 *
 * The passphrase exists here only as the live text of the two fields, and both
 * are cleared the moment it has been handed to the store - the screen keeps no
 * copy, logs nothing, and never puts it in a message. The store creates the
 * Vault on submit and hands back the recovery key, which is step 2.
 */
export function PassphraseStep(props: { onBack: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const busy = useVault((s) => s.busy);
  const error = useVault((s) => s.error);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const strength = strengthOf(passphrase);
  const matches = passphrase.length > 0 && passphrase === confirmation;
  const mismatch = confirmation.length > 0 && !matches;
  const ready = matches && isAcceptable(passphrase);

  const submit = () => {
    const entered = passphrase;
    setPassphrase("");
    setConfirmation("");
    void useVault.getState().setup(entered);
  };

  const tone: Record<Strength, string> = {
    empty: tokens.mutedForeground,
    tooShort: tokens.destructive,
    weak: tokens.warning,
    good: tokens.brandText,
    strong: tokens.brandText,
  };
  const label: Record<Strength, string> = {
    empty: "",
    tooShort: t("vault.status.tooShort"),
    weak: t("vault.status.weak"),
    good: t("vault.status.good"),
    strong: t("vault.status.strong"),
  };
  const filled = filledSegments(strength);

  return (
    <OnboardingFrame
      testID="vault-setup"
      scroll
      onBack={props.onBack}
      step={t("vault.label.stepIndexOfCount", { index: 1, count: 2 })}
      footer={
        <PrimaryPill
          title={t("common.continue")}
          testID="vault-setup-submit"
          disabled={!ready}
          loading={busy}
          onPress={submit}
        />
      }
    >
      <StepBar index={0} count={2} />
      <View className="gap-6 px-5 pt-6">
        <OnboardingHeading title={t("vault.heading.chooseAPassphrase")} body={t("vault.description.itUnlocksYourVaultOnThisPhoneMakeItLongAndMemorable")} />

        <View>
          <TextField
            label={t("vault.label.passphrase")}
            testID="vault-setup-pass"
            value={passphrase}
            onChangeText={setPassphrase}
            secureTextEntry
            autoCapitalize="none"
          />
          <View testID="vault-setup-strength" className="-mt-1 flex-row items-center gap-2.5" accessible accessibilityLabel={label[strength]}>
            <View className="flex-1 flex-row gap-1">
              {[0, 1, 2, 3].map((i) => (
                <View key={i} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: i < filled ? tone[strength] : tokens.border }} />
              ))}
            </View>
            <Text className="min-w-[56px] text-right text-xs" style={{ color: tone[strength], fontFamily: fonts.medium }}>{label[strength]}</Text>
          </View>
        </View>

        <View className="gap-2.5 rounded-2xl bg-card p-4">
          <Tip met={[...passphrase].length >= GOOD_LENGTH} text={t("vault.description.atLeast12Characters")} testID="vault-tip-length" />
          <Tip met={wordCount(passphrase) >= GOOD_WORDS} text={t("vault.description.fourOrMoreRandomWordsAreEasyToRememberAndHardTo")} testID="vault-tip-words" />
          <Tip met={null} text={t("vault.description.notOneYouUseAnywhereElse")} />
        </View>

        <View>
          <TextField
            label={t("vault.label.confirmPassphrase")}
            testID="vault-setup-confirm"
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            autoCapitalize="none"
          />
          {matches ? (
            <View className="-mt-1 flex-row items-center gap-1">
              <Icon name="checkmark" size={16} color={tokens.brandText} />
              <Text className="text-sm" style={{ color: tokens.brandText, fontFamily: fonts.medium }}>{t("vault.status.matches")}</Text>
            </View>
          ) : null}
          {mismatch ? <Text className="-mt-1 text-sm text-destructive">{t("vault.error.passphrasesDoNotMatch")}</Text> : null}
        </View>

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
      </View>
    </OnboardingFrame>
  );
}

/** One line of advice. `met: null` is advice nothing on screen can check. */
function Tip(props: { met: boolean | null; text: string; testID?: string }) {
  const { tokens } = useColorTheme();
  return (
    <View testID={props.testID} className="flex-row items-start gap-2.5" accessibilityState={props.met === null ? undefined : { checked: props.met }}>
      {props.met ? (
        <View className="mt-px h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: tokens.brandText }}>
          <Icon name="checkmark" size={12} color={tokens.card} strokeWidth={3} />
        </View>
      ) : (
        <View className="mt-px h-5 w-5 rounded-full border-[1.5px] border-muted-foreground/50" />
      )}
      <Text className={"flex-1 text-sm leading-5 " + (props.met ? "text-foreground" : "text-muted-foreground")}>{props.text}</Text>
    </View>
  );
}
