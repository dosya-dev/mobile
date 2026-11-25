import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { Icon, type IconName } from "@/ui/Icon";
import { ApiError } from "@/api";
import { useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { normalizeTvCode } from "@/tv/code";
import { decideTv, lookupTvCode, TV_NAME_MAX, type TvDecision, type TvLookup } from "@/tv/api";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; lookup: TvLookup }
  | { kind: "gone" } // 404: unknown, expired or already used
  | { kind: "decided" } // 409: already allowed or cancelled
  | { kind: "allowed" }
  | { kind: "denied" }
  | { kind: "failed"; message: string };

/**
 * Signing in a dosya TV app (RFC 8628 device flow, docs/TV-API-CONTRACT.md).
 *
 * The TV's QR code is https://app.dosya.dev/tv?code=KDTR-9WMX: with the app
 * installed, that universal link lands here (app.config.ts associated domains
 * and the Android https intent filter); Settings > "Sign in on a TV" opens it
 * with no code, for typing the one on the TV screen.
 *
 * The code is shown again and the person is asked to compare it with the TV,
 * because a QR code someone else put in front of them would otherwise sign
 * THEIR TV into this account.
 */
export default function TvScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const raw = (Array.isArray(params.code) ? params.code[0] : params.code) ?? "";
  const [entered, setEntered] = useState<string | null>(null);
  const code = entered ?? (raw ? normalizeTvCode(raw) : null);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("tv.heading.signInOnATv") }} />
      <Screen underNativeHeader>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {code ? <Approve key={code} code={code} /> : <EnterCode initial={raw} invalid={raw !== ""} onCode={setEntered} />}
        </ScrollView>
      </Screen>
    </>
  );
}

function EnterCode({ initial, invalid, onCode }: { initial: string; invalid: boolean; onCode: (code: string) => void }) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [showError, setShowError] = useState(invalid);

  const submit = () => {
    const code = normalizeTvCode(value);
    if (!code) { setShowError(true); return; }
    onCode(code);
  };

  return (
    <View>
      <Text className="mb-1 text-2xl text-foreground" style={{ fontFamily: fonts.bold }}>{t("tv.heading.signInOnATv")}</Text>
      <Text className="mb-5 text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {t("tv.description.enterTheCodeShownOnYourTv")}
      </Text>
      <TextField
        testID="tv-code-input"
        label={t("tv.label.tvCode")}
        value={value}
        onChangeText={(v) => { setValue(v); setShowError(false); }}
        placeholder="XXXX-XXXX"
        autoCapitalize="characters"
        mono
        maxLength={12}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {showError ? (
        <Text testID="tv-code-error" accessibilityRole="alert" className="-mt-2 mb-4 text-sm text-destructive" style={{ fontFamily: fonts.regular }}>
          {t("tv.error.enterThe8CharacterCodeFromYourTv")}
        </Text>
      ) : null}
      <Button testID="tv-code-continue" title={t("common.continue")} onPress={submit} />
    </View>
  );
}

function Approve({ code }: { code: string }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const [view, setView] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<TvDecision | null>(null);
  const [error, setError] = useState("");

  const failure = useCallback(
    (e: unknown) => (e instanceof ApiError && e.status !== 0 ? e.message : t("tv.error.weCouldNotReachDosya")),
    [t],
  );

  useEffect(() => {
    // Starts in "loading": a new code remounts this component (key={code}) and
    // Try again sets it before bumping the attempt.
    let alive = true;
    lookupTvCode(code).then(
      (lookup) => {
        if (!alive) return;
        setName(lookup.device_type);
        setView({ kind: "ready", lookup });
      },
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setView({ kind: "gone" });
        else setView({ kind: "failed", message: failure(e) });
      },
    );
    return () => { alive = false; };
  }, [code, attempt, failure]);

  const decide = async (decision: TvDecision) => {
    if (view.kind !== "ready") return;
    setBusy(decision); setError("");
    try {
      await decideTv(code, decision, name.trim() || view.lookup.device_type);
      setView({ kind: decision === "allow" ? "allowed" : "denied" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setView({ kind: "gone" });
      else if (e instanceof ApiError && e.status === 409) setView({ kind: "decided" });
      else setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  switch (view.kind) {
    case "loading":
      return (
        <View testID="tv-loading" className="items-center gap-3 py-16">
          <ActivityIndicator />
          <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("tv.description.lookingUpTheCode")}</Text>
        </View>
      );
    case "gone":
      return <Outcome testID="tv-gone" icon="time-outline" title={t("tv.description.thisCodeHasExpiredOrWasAlreadyUsed")} onDone={close} />;
    case "decided":
      return <Outcome testID="tv-decided" icon="alert-circle-outline" title={t("tv.description.thisCodeWasAlreadyApprovedOrCancelled")} onDone={close} />;
    case "allowed":
      return <Outcome testID="tv-allowed" icon="checkmark-circle-outline" title={t("tv.heading.yourTvIsSignedIn")} onDone={close} />;
    case "denied":
      return <Outcome testID="tv-denied" icon="close-circle-outline" title={t("tv.heading.tvSignInCancelled")} body={t("tv.description.weDidNotSignInTheTv")} onDone={close} />;
    case "failed":
      return (
        <View testID="tv-failed" className="items-center gap-4 py-16">
          <Text accessibilityRole="alert" className="text-center text-base text-destructive" style={{ fontFamily: fonts.regular }}>{view.message}</Text>
          <Button testID="tv-retry" variant="ghost" title={t("common.action.tryAgain")} onPress={() => { setView({ kind: "loading" }); setAttempt((n) => n + 1); }} />
        </View>
      );
    case "ready": {
      const { lookup } = view;
      return (
        <View testID="tv-ready" className="gap-5">
          <View className="gap-1.5">
            <Text className="text-2xl text-foreground" style={{ fontFamily: fonts.bold }}>{t("tv.heading.signInOnATvQuestion")}</Text>
            <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("tv.description.checkThisMatchesTheCodeOnYourTv")}</Text>
          </View>

          <View className="items-center rounded-2xl border border-border bg-card px-4 py-4">
            <Text testID="tv-code" className="text-foreground" style={{ fontFamily: fonts.bold, fontSize: 32, letterSpacing: 3, writingDirection: "ltr" }}>
              {lookup.user_code || code}
            </Text>
          </View>

          <View className="overflow-hidden rounded-2xl border border-border bg-card">
            <Fact icon="tv-outline" value={lookup.device_type} hint={t("tv.label.deviceTypeReportedByTheTv")} border={!!lookup.location} />
            {lookup.location ? (
              <Fact icon="location-outline" value={t("tv.label.nearLocation", { location: lookup.location })} hint={t("tv.label.approximateLocation")} />
            ) : null}
          </View>

          <View>
            <Text className="mb-2 text-sm text-muted-foreground" style={{ fontFamily: fonts.medium }}>{t("tv.label.nameThisTv")}</Text>
            <TextInput
              testID="tv-name"
              accessibilityLabel={t("tv.label.nameThisTv")}
              value={name}
              onChangeText={setName}
              maxLength={TV_NAME_MAX}
              editable={busy === null}
              className="rounded-lg border border-border bg-card px-3 py-3 text-foreground"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholderTextColor={tokens.mutedForeground}
              returnKeyType="done"
            />
          </View>

          <View testID="tv-warning" className="flex-row gap-3 rounded-2xl border border-border px-4 py-3.5">
            <Icon name="eye-outline" size={22} color={tokens.foreground} />
            <Text className="flex-1 text-sm text-foreground" style={{ fontFamily: fonts.regular, lineHeight: 21 }}>
              {richText(t("tv.description.thisTvWillBeAbleToSeeAll"), {
                seeAllPhotosAndVideos: <Text style={{ fontFamily: fonts.bold }}>{t("tv.label.seeAllPhotosAndVideos")}</Text>,
              })}
            </Text>
          </View>

          {error ? (
            <Text testID="tv-error" accessibilityRole="alert" className="text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>
          ) : null}

          <View className="gap-2.5">
            <Button testID="tv-allow" title={t("tv.action.allow")} onPress={() => { void decide("allow"); }} loading={busy === "allow"} disabled={busy !== null} />
            <Pressable
              testID="tv-cancel"
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => { void decide("deny"); }}
              className={"items-center justify-center rounded-lg border border-border px-5 py-3" + (busy !== null ? " opacity-60" : "")}
            >
              {busy === "deny" ? <ActivityIndicator /> : (
                <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>{t("common.cancel")}</Text>
              )}
            </Pressable>
          </View>
        </View>
      );
    }
  }
}

function Fact({ icon, value, hint, border }: { icon: IconName; value: string; hint: string; border?: boolean }) {
  const { tokens } = useColorTheme();
  return (
    <View className={"flex-row items-center gap-3.5 px-4 py-3.5" + (border ? " border-b border-border" : "")}>
      <Icon name={icon} size={22} color={tokens.foreground} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>{value}</Text>
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{hint}</Text>
      </View>
    </View>
  );
}

function Outcome({ testID, icon, title, body, onDone }: { testID: string; icon: IconName; title: string; body?: ReactNode; onDone: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View testID={testID} className="items-center gap-3 py-12">
      <Icon name={icon} size={40} color={tokens.mutedForeground} />
      <Text className="text-center text-lg text-foreground" style={{ fontFamily: fonts.medium }}>{title}</Text>
      {body ? <Text className="text-center text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{body}</Text> : null}
      <View className="mt-3 self-stretch">
        <Button testID="tv-done" title={t("common.done")} onPress={onDone} />
      </View>
    </View>
  );
}
