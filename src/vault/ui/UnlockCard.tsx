import { useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Button } from "@/ui/Button";
import { fonts } from "@/theme/fonts";
import { useVault } from "@/vault/store";
import { useT } from "@/lib/i18n";

/**
 * The lock screen for a Vault that already exists on this account.
 *
 * Two ways in, one at a time: the passphrase, or the recovery key for the day
 * the passphrase is gone. Whichever field is showing is cleared after every
 * attempt, successful or not - the screen holds no secret between taps.
 */
export function UnlockCard() {
  const t = useT();
  const busy = useVault((s) => s.busy);
  const error = useVault((s) => s.error);
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");

  const submitPassphrase = () => {
    const entered = passphrase;
    setPassphrase("");
    void useVault.getState().unlock(entered);
  };

  const submitRecoveryKey = () => {
    const entered = recoveryKey;
    setRecoveryKey("");
    void useVault.getState().unlockWithRecoveryKey(entered);
  };

  return (
    <View className="rounded-lg border border-border bg-card p-5">
      <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>{t("vault.label.unlockYourVault")}</Text>
      <Text className="mb-4 mt-1 text-sm text-muted-foreground">
        {t("vault.description.yourVaultStaysLockedUntilYouUnlockItOnThisPhone")}
      </Text>

      {useRecoveryKey ? (
        <TextField
          label={t("vault.label.recoveryKey")}
          testID="vault-recovery-key"
          value={recoveryKey}
          onChangeText={setRecoveryKey}
          autoCapitalize="none"
        />
      ) : (
        <TextField
          label={t("vault.label.passphrase")}
          testID="vault-unlock-pass"
          value={passphrase}
          onChangeText={setPassphrase}
          secureTextEntry
          autoCapitalize="none"
        />
      )}

      {error ? <Text className="mb-3 text-sm text-destructive">{error}</Text> : null}

      {useRecoveryKey ? (
        <Button
          title={t("vault.action.unlockWithRecoveryKey")}
          testID="vault-recovery-submit"
          disabled={recoveryKey.length === 0 || busy}
          onPress={submitRecoveryKey}
        />
      ) : (
        <Button
          title={t("common.action.unlock")}
          testID="vault-unlock-submit"
          disabled={passphrase.length === 0 || busy}
          onPress={submitPassphrase}
        />
      )}

      <Pressable
        testID="vault-recovery-toggle"
        accessibilityRole="button"
        hitSlop={8}
        className="mt-4 self-center"
        onPress={() => {
          // Whatever was typed into the other field goes with the switch.
          setPassphrase("");
          setRecoveryKey("");
          setUseRecoveryKey((on) => !on);
        }}
      >
        <Text className="text-sm text-primary">{useRecoveryKey ? t("vault.action.useYourPassphrase") : t("vault.action.useRecoveryKey")}</Text>
      </Pressable>
    </View>
  );
}
