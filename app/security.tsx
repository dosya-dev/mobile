import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Switch, View } from "react-native";
import { Stack } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { isBiometricAvailable, getBiometricEnabled, authenticateBiometric } from "@/auth/biometric";
import {
  hasPin, getLockAfter, setLockAfter, setBiometricUnlock, clearAppLock,
  LOCK_AFTER_OPTIONS, DEFAULT_LOCK_AFTER, type LockAfter,
} from "@/auth/appLock";
import { PinCheck, PinSetup } from "@/auth/PinScreens";
import { ActionSheet } from "@/ui/ActionSheet";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { use2faStatus, useMe, TWO_FA_KEY } from "@/profile/hooks";
import { RecoveryCodes } from "@/profile/RecoveryCodes";
import { PasskeysSection } from "@/profile/PasskeysSection";
import {
  passwordRules, changePassword, enableEmail2fa, setupTotp, verifyTotp,
  disable2fa, regenerateRecoveryCodes,
} from "@/profile/api";
import type { TwoFaStatus } from "@/profile/types";

function errMessage(e: unknown, t: T): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

/**
 * `has_password` is false for OAuth-created accounts, whose stored password is a random
 * value they were never told. Kept as a belt-and-braces hint for the window where an
 * older client/server still lacks the flag.
 */
function withOauthHint(e: unknown, t: T): string {
  const msg = errMessage(e, t);
  return /incorrect password/i.test(msg)
    ? `${msg}. ${t("security.description.ifYouSignedUpWithGoogleOrGitHubSetAPasswordFirstUsingForgot")}`
    : msg;
}

export default function SecurityScreen() {
  const t = useT();
  const { data: status, isLoading, isError, refetch } = use2faStatus();
  const { data: me } = useMe();
  // Default to true: if /api/me hasn't resolved we'd rather show an action that might
  // 401 than hide a working one from someone who does have a password.
  const hasPassword = me?.has_password ?? true;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("profile.heading.password2FA") }} />
      <Screen underNativeHeader title={t("profile.heading.password2FA")}>
        {isLoading ? (
          <View testID="security-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !status ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("security.error.couldnTLoadSecuritySettings")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <AppLockSection />
            {hasPassword ? <PasswordSection /> : <NoPasswordSection />}
            <PasskeysSection />
            <TwoFactorSection status={status} hasPassword={hasPassword} />
          </ScrollView>
        )}
      </Screen>
    </>
  );
}

/**
 * App lock: a PIN, with Face ID / fingerprint as the faster way past it. Shown
 * on every phone, since the PIN needs no biometric hardware; the biometric
 * switch only appears once a PIN is set and the phone has biometrics enrolled.
 */
function AppLockSection() {
  const t = useT();
  const [pinOn, setPinOn] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [after, setAfter] = useState<LockAfter>(DEFAULT_LOCK_AFTER);
  const [flow, setFlow] = useState<null | "setup" | "turnOff" | "changeVerify" | "changeNew">(null);
  const [pickAfter, setPickAfter] = useState(false);

  const load = async () => {
    const [pin, available, bio, lockAfter] = await Promise.all([hasPin(), isBiometricAvailable(), getBiometricEnabled(), getLockAfter()]);
    setPinOn(pin);
    setBioAvailable(available);
    setBioOn(bio);
    setAfter(lockAfter);
  };
  useEffect(() => {
    void load();
  }, []);

  const finish = () => {
    setFlow(null);
    void load();
  };

  return (
    <Section title={t("security.heading.appLock")}>
      <SettingsRow
        icon="lock-closed-outline"
        label={t("security.label.requireAPin")}
        description={t("security.description.askForYourPinWhenYouComeBack")}
        border={pinOn}
        right={<Switch testID="pin-toggle" value={pinOn} onValueChange={(v) => setFlow(v ? "setup" : "turnOff")} />}
      />
      {pinOn && bioAvailable ? (
        <SettingsRow
          icon="finger-print"
          label={t("security.label.unlockWithBiometrics")}
          border
          right={
            <Switch
              testID="bio-toggle"
              value={bioOn}
              onValueChange={async (v) => {
                // Prove the scan works before relying on it.
                if (v && !(await authenticateBiometric({ pinFallback: true }))) return;
                setBioOn(v);
                await setBiometricUnlock(v);
              }}
            />
          }
        />
      ) : null}
      {pinOn ? (
        <>
          <SettingsRow icon="time-outline" label={t("security.label.lockAfter")} value={lockAfterLabel(after, t)} onPress={() => setPickAfter(true)} border testID="lock-after" />
          <SettingsRow icon="key-outline" label={t("security.label.changePin")} onPress={() => setFlow("changeVerify")} testID="change-pin" />
        </>
      ) : null}

      <ActionSheet
        visible={pickAfter}
        onClose={() => setPickAfter(false)}
        actions={LOCK_AFTER_OPTIONS.map((s) => ({
          label: lockAfterLabel(s, t),
          icon: s === after ? "checkmark" : undefined,
          onPress: () => {
            setAfter(s);
            void setLockAfter(s);
          },
        }))}
      />

      <Modal visible={flow !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setFlow(null)}>
        {flow === "setup" || flow === "changeNew" ? (
          <PinSetup onDone={finish} secondary={{ label: t("common.cancel"), onPress: () => setFlow(null) }} />
        ) : flow === "turnOff" || flow === "changeVerify" ? (
          <PinCheck
            title={t("security.heading.enterYourCurrentPin")}
            onCancel={() => setFlow(null)}
            onSuccess={() => {
              if (flow === "changeVerify") setFlow("changeNew");
              else void clearAppLock().then(finish);
            }}
          />
        ) : null}
      </Modal>
    </Section>
  );
}

function lockAfterLabel(seconds: LockAfter, t: T): string {
  if (seconds === 0) return t("security.option.immediately");
  if (seconds === 3600) return t("security.option.oneHour");
  return t("security.option.minutes", { count: seconds / 60 });
}

/**
 * Shown when the account has no password it knows (OAuth signup). Changing a password,
 * disabling 2FA and regenerating recovery codes all verify the current password, so they
 * would 401 forever. The escape hatch is a password reset, which sets a real one.
 */
function NoPasswordSection() {
  const t = useT();
  return (
    <Section title={t("security.heading.password")}>
      <View className="gap-2 px-4 py-4" testID="no-password">
        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("security.status.noPasswordSet")}</Text>
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("security.description.youSignedUpWithGoogleOrGitHubSoThisAccountHasNoPasswordYet")}
        </Text>
      </View>
    </Section>
  );
}

function PasswordSection() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (next !== confirm) { toast(t("security.error.newPasswordsDonTMatch"), "error"); return; }
    setSaving(true);
    try {
      await changePassword(current, next);
      setCurrent(""); setNext(""); setConfirm("");
      toast(t("common.label.passwordUpdated"));
    } catch (e) {
      toast(withOauthHint(e, t), "error");
    }
    setSaving(false);
  };

  return (
    <Section title={t("security.heading.password")}>
      <View className="gap-2 px-4 py-4">
        <TextField label={t("profile.label.currentPassword")} testID="pw-current" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
        <TextField label={t("common.label.newPassword")} testID="pw-new" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
        <TextField label={t("common.label.confirmNewPassword")} testID="pw-confirm" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
        <Text className="mb-1 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{passwordRules()}</Text>
        <Button
          title={t("common.action.updatePassword")}
          testID="pw-save"
          onPress={save}
          loading={saving}
          disabled={!current || !next || !confirm}
        />
      </View>
    </Section>
  );
}

function TwoFactorSection({ status, hasPassword }: { status: TwoFaStatus; hasPassword: boolean }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | "disable" | "regen">(null);

  const refresh = () => qc.invalidateQueries({ queryKey: TWO_FA_KEY });

  const startTotp = async () => {
    setBusy(true);
    try { setSetup(await setupTotp()); } catch (e) { toast(errMessage(e, t), "error"); }
    setBusy(false);
  };

  const confirmTotp = async () => {
    setBusy(true);
    try {
      setCodes(await verifyTotp(code.trim()));
      setSetup(null); setCode("");
      await refresh();
    } catch (e) { toast(errMessage(e, t), "error"); }
    setBusy(false);
  };

  const doEnableEmail = async () => {
    setBusy(true);
    try { await enableEmail2fa(); await refresh(); toast(t("security.status.email2FAEnabled")); }
    catch (e) { toast(errMessage(e, t), "error"); }
    setBusy(false);
  };

  const submitPassword = async (password: string) => {
    const mode = ask;
    setAsk(null);
    if (!password || !mode) return;
    setBusy(true);
    try {
      if (mode === "disable") { await disable2fa(password); await refresh(); toast(t("security.status.twoFactorAuthenticationDisabled")); }
      else { setCodes(await regenerateRecoveryCodes(password)); await refresh(); }
    } catch (e) { toast(withOauthHint(e, t), "error"); }
    setBusy(false);
  };

  if (codes) {
    return (
      <Section title={t("common.heading.twoFactorAuthentication")}>
        <View className="px-4 py-4">
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        </View>
      </Section>
    );
  }

  if (setup) {
    return (
      <Section title={t("profile.heading.setUpAuthenticator")}>
        <View className="gap-3 px-4 py-4">
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("security.description.scanThisWithYourAuthenticatorAppThenEnterThe6DigitCodeItShows")}
          </Text>
          {/* Rendered locally. The web app sends this URI - which contains the TOTP
              secret - to api.qrserver.com to draw the QR; we don't. */}
          <View className="items-center rounded-lg bg-white p-4" testID="totp-qr">
            <QRCode value={setup.uri} size={180} />
          </View>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("security.label.orEnterThisKeyManually")}</Text>
          <Text
            testID="totp-secret"
            className="text-center text-sm text-foreground"
            style={{ fontFamily: fonts.mono }}
            onPress={async () => { await Clipboard.setStringAsync(setup.secret); toast(t("security.status.secretCopied")); }}
          >
            {setup.secret}
          </Text>
          <TextField label={t("common.label.sixDigitCode")} testID="totp-code" value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" placeholder="123456" />
          <Button title={t("profile.action.verifyEnable")} testID="totp-verify" onPress={confirmTotp} loading={busy} />
          <Button title={t("common.cancel")} variant="ghost" testID="totp-cancel" onPress={() => { setSetup(null); setCode(""); }} />
        </View>
      </Section>
    );
  }

  const enabled = status.method === "totp" || status.method === "email";

  return (
    <>
      <Section title={t("common.heading.twoFactorAuthentication")}>
        <View className="gap-3 px-4 py-4">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("common.label.status")}</Text>
            {enabled ? (
              <Badge label={status.method === "totp" ? t("security.label.authenticator") : t("common.label.email")} />
            ) : (
              <Badge label={t("security.label.off")} variant="outline" />
            )}
          </View>

          {/* Enrolling needs no password but disabling does - so without one you'd be
              locked in permanently. Block enrolment rather than create that trap. */}
          {!hasPassword && !enabled ? (
            <Text testID="tfa-needs-password" className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("security.description.setAPasswordBeforeTurningOnTwoFactorAuthenticationTurningItOffLaterRequires")}
            </Text>
          ) : enabled ? (
            <Button
              title={t("security.action.disableTwoFactor")}
              testID="tfa-disable"
              variant="ghost"
              disabled={!hasPassword}
              onPress={() => setAsk("disable")}
            />
          ) : (
            <>
              <Button title={t("security.action.enableAuthenticator")} testID="tfa-totp" onPress={startTotp} loading={busy} />
              <Button title={t("security.action.enableEmail2FA")} testID="tfa-email" variant="ghost" onPress={doEnableEmail} />
            </>
          )}
          {!hasPassword && enabled ? (
            <Text testID="tfa-locked" className="text-xs text-destructive" style={{ fontFamily: fonts.regular }}>
              {t("security.description.turningThisOffRequiresAPasswordUseForgotPasswordToSetOneFirst")}
            </Text>
          ) : null}
        </View>
      </Section>

      {status.method === "totp" ? (
        <Section title={t("profile.heading.recoveryCodes")}>
          <View className="gap-3 px-4 py-4">
            <Text className="text-sm text-foreground" style={{ fontFamily: fonts.regular }}>
              {t("security.label.recoverycodesremainingOf10CodesRemaining", { recoveryCodesRemaining: status.recovery_codes_remaining })}
            </Text>
            <Button title={t("profile.action.regenerateCodes")} testID="tfa-regen" variant="ghost" onPress={() => setAsk("regen")} />
          </View>
        </Section>
      ) : null}

      <PromptDialog
        visible={ask !== null}
        title={t("common.heading.confirmYourPassword")}
        placeholder={t("common.placeholder.currentPassword")}
        confirmLabel={t("common.continue")}
        secure
        onSubmit={submitPassword}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}
