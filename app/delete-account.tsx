import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { useAuthStore } from "@/auth/authStore";
import { useMe } from "@/profile/hooks";
import { CODE_LENGTH, normaliseCode, isCompleteCode } from "@/auth/oneTimeCode";
import { formatBytes } from "@/files/format";
import {
  fetchDeletePreview, requestDeleteCode, confirmDelete, cancelDelete,
  cooldownRemaining, describeBlocker, formatScheduledDate, daysRemaining,
  classifyDeleteError,
} from "@/account/deletion";
import { localDigits } from "@/lib/format-locale";
import { useStoreStatus } from "@/billing/hooks";
import { storeBillingAvailable } from "@/billing/revenuecat";
import { storeDisplayName } from "@/billing/paywallModel";

/** Own component so the billing query only mounts on builds that can sell through a store. */
function StoreSubscriptionNote() {
  const t = useT();
  const { data: store } = useStoreStatus();
  if (!store) return null;
  return (
    <Text className="mt-4 text-sm text-foreground" testID="store-subscription-note">
      {t("upgrade.label.cancelInStoreFirst", { store: storeDisplayName(store.provider) })}
    </Text>
  );
}

type Step = "preview" | "password" | "code" | "done";

/**
 * Account deletion. Required in-app by both app stores for any app that supports
 * account creation, which is why this screen exists rather than a link to the web.
 *
 * States: preview, a confirmation step, done, and already-scheduled. The last is
 * entered directly when the account has a pending deletion, because someone
 * returning here wants to cancel far more often than they want to delete twice.
 *
 * The confirmation step depends on the account. One with a password re-enters
 * it; one created through Google or Apple has no password and gets an emailed
 * code. App Review rejected 1.0.2 under 5.1.1(v) because the flow was
 * email-only: the reviewer signs in with the demo account, cannot read its
 * mailbox, and so could never finish. A password is the same proof (something
 * a stolen session does not carry) and is completable on the device.
 *
 * "Done" is its own state rather than an immediate sign-out for the same
 * reason: the user, and the reviewer's screen recording, must see that it
 * worked and when the erasure happens before the login screen replaces it.
 */
export default function DeleteAccountScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const signOut = useAuthStore((s) => s.signOut);
  const me = useMe();
  const hasPassword = me.data?.has_password === true;

  const [step, setStep] = useState<Step>("preview");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  const q = useQuery({ queryKey: ["account", "delete-preview"], queryFn: fetchDeletePreview });

  // Enter the scheduled state straight away when the server says one is pending.
  useEffect(() => {
    if (q.data?.deletion_scheduled_for != null) setScheduledFor(q.data.deletion_scheduled_for);
  }, [q.data?.deletion_scheduled_for]);

  // A live countdown, not a dead button: the server rejects a resend inside its
  // cooldown, so the control has to say when it will work rather than just fail.
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (sentAt == null) return;
    const update = () => setRemaining(cooldownRemaining(sentAt, Date.now()));
    update();
    tick.current = setInterval(update, 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [sentAt]);

  const preview = q.data;
  const blockers = preview?.blockers ?? [];
  const nowSeconds = Math.floor(Date.now() / 1000);

  const onContinue = async () => {
    setError(null);
    if (hasPassword) {
      setStep("password");
      return;
    }
    await onRequestCode();
  };

  const onRequestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      await requestDeleteCode();
      setSentAt(Date.now());
      setStep("code");
    } catch (e) {
      setError(classifyDeleteError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const when = await confirmDelete(step === "password" ? { password } : { code });
      setScheduledFor(when);
      setPassword("");
      setStep("done");
    } catch (e) {
      const f = classifyDeleteError(e);
      if (f.kind === "code_burned") setCode("");
      if (f.kind === "wrong_password") setPassword("");
      setError(f.message);
    } finally {
      setBusy(false);
    }
  };

  // Every session was revoked server-side, so once the user has read the
  // confirmation the app must stop holding credentials the API will refuse.
  const onDone = async () => {
    await signOut();
  };

  const onCancel = async () => {
    setError(null);
    setBusy(true);
    try {
      await cancelDelete();
      setScheduledFor(null);
      setStep("preview");
      toast(t("delete-account.status.deletionCancelled"));
      await q.refetch();
    } catch (e) {
      setError(classifyDeleteError(e).message);
    } finally {
      setBusy(false);
    }
  };

  // One message with the date in bold, so each language keeps its own word order.
  const scheduledSentence = (when: number) =>
    richText(
      t("profile.description.yourAccountAndItsFilesWillBeDeletedOn", {
        days: localDigits(daysRemaining(when, nowSeconds)),
      }),
      {
        scheduledFor: (
          <Text className="text-foreground" style={{ fontFamily: fonts.medium }}>
            {formatScheduledDate(when)}
          </Text>
        ),
      },
    );

  const canConfirm = step === "password" ? password.length > 0 : isCompleteCode(code);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("profile.heading.deleteAccount") }} />
      <View className="flex-1 px-5 pt-4">
        {error ? (
          <View className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <Text className="text-sm text-destructive" style={{ fontFamily: fonts.regular }} testID="delete-error">
              {error}
            </Text>
          </View>
        ) : null}

        {/* ── Done: it is scheduled, here is when ─────────────── */}
        {step === "done" && scheduledFor != null ? (
          <View testID="done-state">
            <View className="mb-4 flex-row items-center gap-2">
              <Icon name="checkmark-circle" size={22} color={tokens.foreground} />
              <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>
                {t("profile.label.deletionScheduled")}
              </Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              {scheduledSentence(scheduledFor)}
            </Text>
            <Text className="mt-3 text-sm text-muted-foreground">
              {t("delete-account.description.youHaveBeenSignedOutOnEveryDeviceIfYouChangeYourMindSign")}
            </Text>
            <View className="mt-6">
              <Button title={t("common.done")} onPress={onDone} testID="done" />
            </View>
          </View>
        ) : scheduledFor != null ? (
          /* ── Already scheduled ─────────────────────────────── */
          <View testID="scheduled-state">
            <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>
              {t("profile.label.deletionScheduled")}
            </Text>
            <Text className="mt-2 text-sm text-muted-foreground">
              {scheduledSentence(scheduledFor)}
            </Text>
            <View className="mt-6">
              <Button title={t("profile.action.cancelDeletion")} onPress={onCancel} loading={busy} testID="cancel-deletion" />
            </View>
          </View>
        ) : q.isLoading ? (
          <View className="mt-10 items-center"><ActivityIndicator color={tokens.primary} /></View>
        ) : step === "preview" ? (
          /* ── Step 1: what this destroys ───────────────────── */
          <View testID="preview-state">
            <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>
              {t("delete-account.label.thisDeletesEverything")}
            </Text>
            <Text className="mt-2 text-sm text-muted-foreground">
              {t("delete-account.description.yourAccountIsScheduledForDeletionInWindowDaysDaysYouCanCancelAnyTime", {
                windowDays: localDigits(preview?.window_days ?? 30),
              })}
            </Text>

            <View className="mt-5 rounded-lg border border-border bg-card">
              <Row label={t("delete-account.label.workspacesDeleted")} value={String(preview?.workspaces.length ?? 0)} />
              <Row label={t("delete-account.label.filesDeleted")} value={String(preview?.file_count ?? 0)} />
              <Row label={t("delete-account.label.storageFreed")} value={formatBytes(preview?.total_bytes ?? 0)} last />
            </View>

            {storeBillingAvailable() ? <StoreSubscriptionNote /> : null}

            {blockers.length > 0 ? (
              <View className="mt-5" testID="blockers">
                <Text className="mb-2 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                  {t("delete-account.label.resolveTheseFirst")}
                </Text>
                {blockers.map((b) => (
                  <View
                    key={b.workspace_id}
                    className="mb-2 flex-row gap-2 rounded-lg border border-border bg-card p-3"
                  >
                    <Icon name="alert-circle-outline" size={18} color={tokens.mutedForeground} />
                    <Text className="flex-1 text-sm text-muted-foreground">{describeBlocker(b)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View className="mt-6">
              <Button
                title={t("common.continue")}
                onPress={onContinue}
                loading={busy}
                disabled={blockers.length > 0 || busy}
                testID="continue"
              />
            </View>
            <Text className="mt-2 text-center text-xs text-muted-foreground">
              {blockers.length > 0
                ? t("delete-account.description.youCannotDeleteYourAccountWhileYouOwnAWorkspaceWithOtherPeopleIn")
                : hasPassword
                  ? t("delete-account.description.youWillBeAskedForYourPasswordToConfirm")
                  : t("delete-account.description.weWillEmailYouACodeToConfirm")}
            </Text>
          </View>
        ) : step === "password" ? (
          /* ── Step 2a: confirm with the password ───────────── */
          <View testID="password-state">
            <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>
              {t("delete-account.label.confirmWithYourPassword")}
            </Text>
            <Text className="mt-2 mb-4 text-sm text-muted-foreground">
              {t("delete-account.description.enterThePasswordForThisAccountThisSchedulesTheDeletion")}
            </Text>

            <TextField
              label={t("common.label.password")}
              testID="password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            <Button
              title={t("profile.action.deleteMyAccount")}
              onPress={onConfirm}
              loading={busy}
              disabled={!canConfirm || busy}
              testID="confirm-delete"
            />
          </View>
        ) : (
          /* ── Step 2b: confirm with the emailed code ───────── */
          <View testID="code-state">
            <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>
              {t("delete-account.label.enterYourCode")}
            </Text>
            <Text className="mt-2 mb-4 text-sm text-muted-foreground">
              {t("profile.description.weEmailedYouADeleteCodeLengthDigitCodeEnteringIt", { deleteCodeLength: localDigits(CODE_LENGTH) })}
            </Text>

            <TextField
              label={t("common.label.code")}
              testID="code"
              value={code}
              onChangeText={(v) => setCode(normaliseCode(v))}
              keyboardType="number-pad"
              autoCapitalize="none"
              placeholder="000000"
              mono
              maxLength={CODE_LENGTH}
            />

            <View className="-mt-2 mb-4 flex-row justify-center">
              {remaining > 0 ? (
                <Text className="text-xs text-muted-foreground" testID="resend-countdown">
                  {t("common.label.resendAvailableInRemainingS", { remaining: localDigits(remaining) })}
                </Text>
              ) : (
                <Pressable testID="resend" onPress={onRequestCode} accessibilityRole="button" hitSlop={8}>
                  <Text className="text-xs text-foreground underline" style={{ fontFamily: fonts.medium }}>
                    {t("common.action.resendCode")}
                  </Text>
                </Pressable>
              )}
            </View>

            <Button
              title={t("profile.action.deleteMyAccount")}
              onPress={onConfirm}
              loading={busy}
              disabled={!canConfirm || busy}
              testID="confirm-delete"
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View className={"flex-row items-center justify-between px-4 py-3" + (last ? "" : " border-b border-border")}>
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{value}</Text>
    </View>
  );
}
