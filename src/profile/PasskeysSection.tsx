import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import * as Device from "expo-device";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { rtlLine, useT } from "@/lib/i18n";
import { formatShortDate } from "@/lib/format-locale";
import { fonts } from "@/theme/fonts";
import {
  createPasskeyCredential, isPasskeyCancelled, isPasskeySupported, passkeyFailureMessage,
} from "@/auth/passkey";
import { PASSKEYS_KEY, usePasskeys } from "./hooks";
import { passkeyOptions, removePasskey, savePasskey, sendPasskeyCode, type PasskeyProof } from "./api";
import type { Passkey } from "./types";

export function PasskeysSection() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = usePasskeys();
  const [ask, setAsk] = useState<null | "password" | "code">(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [busy, setBusy] = useState(false);
  // The native sheet cannot present over a dialog that is still fading out.
  const { queue, onDismiss } = useAfterDismiss();

  const refresh = () => qc.invalidateQueries({ queryKey: PASSKEYS_KEY });

  const startAdd = async () => {
    if (data?.proof === "password") { setAsk("password"); return; }
    setBusy(true);
    try {
      await sendPasskeyCode();
      setAsk("code");
    } catch (e) {
      toast(passkeyFailureMessage(e, "security.error.weCouldNotAddThatPasskeyTryAgain", t), "error");
    }
    setBusy(false);
  };

  const enrol = async (proof: PasskeyProof) => {
    setBusy(true);
    try {
      const { challenge_token, options } = await passkeyOptions(proof);
      const response = await createPasskeyCredential(options);
      // Named after the phone so the list can tell passkeys apart. Without a
      // model the server falls back to "Passkey".
      await savePasskey(challenge_token, response, Device.modelName ?? undefined);
      await refresh();
      toast(t("security.status.passkeyAdded"));
    } catch (e) {
      if (!isPasskeyCancelled(e)) {
        toast(passkeyFailureMessage(e, "security.error.weCouldNotAddThatPasskeyTryAgain", t), "error");
      }
    }
    setBusy(false);
  };

  const submitProof = (value: string) => {
    const kind = ask;
    setAsk(null);
    if (!value || !kind) return;
    queue(() => void enrol(kind === "password" ? { password: value } : { code: value }));
  };

  const confirmRemove = async () => {
    const target = removing;
    setRemoving(null);
    if (!target) return;
    setBusy(true);
    try {
      await removePasskey(target.id);
      await refresh();
      toast(t("security.status.passkeyRemoved"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain"), "error");
    }
    setBusy(false);
  };

  const passkeys = data?.passkeys ?? [];

  return (
    <Section title={t("security.heading.passkeys")}>
      <View className="px-4 pt-4">
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("security.description.signInWithYourFaceFingerprintOrDevicePinInsteadOfAPassword")}
        </Text>
      </View>

      {isLoading ? (
        <View testID="passkeys-loading" className="items-center py-4"><ActivityIndicator /></View>
      ) : isError || !data ? (
        <View className="px-4 py-4">
          <Text className="mb-2 text-sm text-destructive" style={{ fontFamily: fonts.regular }}>
            {t("security.error.weCouldNotLoadYourPasskeys")}
          </Text>
          <Text testID="passkeys-retry" className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
        </View>
      ) : (
        <>
          {passkeys.length === 0 ? (
            <View className="px-4 pt-3">
              <Text testID="passkeys-empty" className="text-sm text-foreground" style={{ fontFamily: fonts.regular }}>
                {t("security.status.noPasskeysYet")}
              </Text>
            </View>
          ) : (
            <View className="mt-2">
              {passkeys.map((p, i) => (
                <SettingsRow
                  key={p.id}
                  testID={`passkey-${p.id}`}
                  icon="key-outline"
                  label={p.name}
                  description={rtlLine([
                    t("security.label.addedDate", { date: formatShortDate(p.created_at) }),
                    ...(p.last_used_at ? [t("security.label.lastUsedDate", { date: formatShortDate(p.last_used_at) })] : []),
                  ].join(" · "))}
                  value={p.backed_up ? t("security.label.synced") : undefined}
                  border={i < passkeys.length - 1}
                  right={
                    <Pressable testID={`passkey-remove-${p.id}`} accessibilityRole="button" disabled={busy} onPress={() => setRemoving(p)} hitSlop={8}>
                      <Text className="text-sm text-destructive" style={{ fontFamily: fonts.medium }}>{t("common.remove")}</Text>
                    </Pressable>
                  }
                />
              ))}
            </View>
          )}

          <View className="gap-3 px-4 py-4">
            {isPasskeySupported() ? (
              <Button title={t("security.action.addAPasskey")} testID="passkey-add" variant="ghost" onPress={startAdd} loading={busy} />
            ) : null}
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("security.description.yourVaultKeepsItsOwnPassphraseTheAppLockOnThisPhoneIsSeparateToo")}
            </Text>
          </View>
        </>
      )}

      {/* Two dialogs rather than one that swaps its text, so the password field
          stays secure and the code field stays readable. */}
      <PromptDialog
        visible={ask === "password"}
        title={t("common.heading.confirmYourPassword")}
        placeholder={t("common.placeholder.currentPassword")}
        confirmLabel={t("common.continue")}
        secure
        onSubmit={submitProof}
        onCancel={() => setAsk(null)}
        onDismiss={onDismiss}
      />
      <PromptDialog
        visible={ask === "code"}
        title={t("security.heading.enterTheCodeWeEmailedYou")}
        placeholder="123456"
        confirmLabel={t("common.continue")}
        onSubmit={submitProof}
        onCancel={() => setAsk(null)}
        onDismiss={onDismiss}
      />
      <ConfirmDialog
        visible={removing !== null}
        title={t("common.heading.areYouSure")}
        message={removing ? t("security.description.nameWillNoLongerSignYouInYourPasswordAndTwoFactorSettingsAreNotAffected", { name: removing.name }) : undefined}
        confirmLabel={t("common.remove")}
        destructive
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </Section>
  );
}
