import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { formatDateWith } from "@/lib/format-locale";
import type { T } from "@/i18n/translator";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useMe, ME_KEY } from "@/profile/hooks";
import { updateName, requestEmailChange, confirmEmailChange, uploadAvatar, avatarUrl } from "@/profile/api";
import { useFamily } from "@/family/hooks";
import { showsFamilyEntry } from "@/family/visibility";
import type { MeUser } from "@/profile/types";

function memberSince(unixSeconds: number): string {
  return formatDateWith(new Date(unixSeconds * 1000), { month: "long", year: "numeric" });
}

function errMessage(e: unknown, t: T): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

export default function ProfileScreen() {
  const t = useT();
  const { data: me, isLoading, isError, refetch } = useMe();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("profile.heading.profile") }} />
      <Screen underNativeHeader title={t("profile.heading.profile")}>
        {isLoading ? (
          <View testID="profile-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !me ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("profile.error.couldnTLoadYourProfile")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Hero me={me} />
            <IdentitySection me={me} />
            <ProfileNav />
          </ScrollView>
        )}
      </Screen>
    </>
  );
}

/**
 * Web stacks every profile section in one scrolling pane (its left rail only scrolls to
 * them). On a phone that would be unwieldy, so the sections become pushed sub-screens
 * and this is the hub - the mobile-idiomatic translation of that rail.
 */
function ProfileNav() {
  const t = useT();
  const router = useRouter();
  const family = useFamily();
  return (
    <Section title={t("profile.heading.account")}>
      <SettingsRow
        icon="lock-closed"
        label={t("profile.action.password2FA")}
        testID="nav-security"
        border
        onPress={() => router.push("/security")}
      />
      <SettingsRow
        icon="notifications"
        label={t("profile.action.notificationSettings")}
        testID="nav-notifications"
        border
        onPress={() => router.push("/notification-settings")}
      />
      <SettingsRow
        icon="color-palette"
        label={t("common.action.appearance")}
        testID="nav-appearance"
        border
        onPress={() => router.push("/appearance")}
      />
      <SettingsRow
        icon="phone-portrait"
        label={t("profile.action.sessions")}
        testID="nav-sessions"
        border
        onPress={() => router.push("/sessions")}
      />
      <SettingsRow
        icon="business"
        label={t("common.action.myWorkspaces")}
        testID="nav-workspaces"
        border
        onPress={() => router.push("/workspaces")}
      />
      {/* Only for people with a family to manage: a free user with nobody
          would see nothing but an invitation to buy, which the stores do not
          allow in the app. */}
      {showsFamilyEntry(family.data) && (
        <SettingsRow
          icon="people"
          label={t("profile.action.familyPlan")}
          testID="nav-family"
          border
          onPress={() => router.push("/family")}
        />
      )}
      <SettingsRow
        icon="alert-circle"
        label={t("profile.action.reportAProblem")}
        description={t("profile.description.tellUsAboutABugDeviceDetailsTravelWithIt")}
        testID="nav-report-problem"
        border
        onPress={() => router.push({ pathname: "/report-problem", params: { from: "/profile" } })}
      />
      {/* Both app stores require deletion to be startable in the app, and about
          as findable as sign-up was. Last in the list because it is the only
          destructive row here, not because it is hidden. */}
      <SettingsRow
        icon="trash"
        label={t("profile.action.deleteAccount")}
        testID="nav-delete-account"
        onPress={() => router.push("/delete-account")}
      />
    </Section>
  );
}

function Hero({ me }: { me: MeUser }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();
  const [bust, setBust] = useState<number | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast(t("profile.error.photoAccessIsNeededToChangeYourAvatar"), "error"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      // fileName matters: the server derives the stored key's extension from it.
      await uploadAvatar(asset.uri, asset.mimeType ?? "image/jpeg", asset.fileName ?? "avatar.jpg");
      await qc.invalidateQueries({ queryKey: ME_KEY });
      setBust(Date.now()); // the endpoint caches for an hour and the url is stable
      toast(t("profile.label.avatarUpdated"));
    } catch (e) {
      toast(errMessage(e, t), "error");
    }
    setUploading(false);
  };

  return (
    <View className="mb-6 flex-row items-center gap-4">
      <Pressable testID="avatar-pick" accessibilityRole="button" accessibilityLabel={t("profile.action.changeAvatar")} onPress={pick}>
        <Avatar
          testID="profile-avatar"
          imageUrl={me.avatar_url ? avatarUrl(bust) : null}
          initials={me.initials}
          color={tokens.muted}
          textColor={tokens.mutedForeground}
          size={64}
          radius={32}
        />
        <View className="absolute bottom-0 end-0 rounded-full bg-primary p-1.5">
          {uploading ? (
            <ActivityIndicator size="small" color={tokens.primaryForeground} />
          ) : (
            <Icon name="camera" size={12} color={tokens.primaryForeground} />
          )}
        </View>
      </Pressable>
      <View className="min-w-0 flex-1">
        <Text className="text-lg text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>{me.name}</Text>
        <Text className="text-sm text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{me.email}</Text>
        <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("profile.description.memberSinceMemberSinceWorkspaceCountPluralOneWorkspaceOtherWorkspaces", {
            memberSince: memberSince(me.created_at),
            workspaceCount: me.workspace_count,
          })}
        </Text>
      </View>
    </View>
  );
}

function IdentitySection({ me }: { me: MeUser }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [savingName, setSavingName] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { setName(me.name); setEmail(me.email); }, [me.name, me.email]);

  const nameDirty = name.trim() !== me.name && name.trim().length > 0;
  const emailDirty = email.trim().toLowerCase() !== me.email.toLowerCase() && email.trim().length > 0;

  const saveName = async () => {
    setSavingName(true);
    try {
      await updateName(name.trim());
      await qc.invalidateQueries({ queryKey: ME_KEY });
      toast(t("profile.label.nameUpdated"));
    } catch (e) {
      toast(errMessage(e, t), "error");
    }
    setSavingName(false);
  };

  const startEmailChange = async (password: string) => {
    setAskPassword(false);
    if (!password) return;
    try {
      const res = await requestEmailChange(email.trim(), password);
      if (res.kind === "unchanged") { toast(t("profile.status.thatSAlreadyYourEmailAddress")); return; }
      setPendingEmail(res.newEmail);
      toast(t("profile.status.weSentACodeToNewEmail", { newEmail: res.newEmail }));
    } catch (e) {
      toast(errMessage(e, t), "error");
    }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      await confirmEmailChange(code.trim());
      await qc.invalidateQueries({ queryKey: ME_KEY });
      setPendingEmail(null);
      setCode("");
      toast(t("profile.label.emailAddressUpdated"));
    } catch (e) {
      // 410 (expired) / 429 (too many attempts) end the flow - there is no resend
      // endpoint, so the user restarts Change and re-enters their password.
      toast(errMessage(e, t), "error");
    }
    setConfirming(false);
  };

  return (
    <Section title={t("profile.heading.identity")}>
      <View className="gap-2 px-4 py-4">
        <TextField label={t("profile.label.fullName")} testID="profile-name" value={name} onChangeText={setName} placeholder={t("common.placeholder.janeDoe")} />
        <Button title={t("common.save")} testID="save-name" onPress={saveName} loading={savingName} disabled={!nameDirty} />
      </View>

      <View className="border-t border-border px-4 py-4">
        <View className="mb-1 flex-row items-center gap-2">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("common.label.email")}</Text>
          <Badge label={me.email_verified_at ? t("common.status.verified") : t("profile.status.unverified")} variant={me.email_verified_at ? "secondary" : "outline"} />
        </View>
        <TextField testID="profile-email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder={t("common.placeholder.nameExampleCom")} />

        {pendingEmail ? (
          <View className="gap-2">
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("profile.label.enterThe6DigitCodeWeSentToPendingEmail", { pendingEmail })}
            </Text>
            <TextField testID="email-code" value={code} onChangeText={setCode} keyboardType="number-pad" autoCapitalize="none" placeholder="123456" />
            <Button title={t("common.action.confirm")} testID="confirm-email" onPress={confirm} loading={confirming} />
          </View>
        ) : emailDirty ? (
          <Button title={t("profile.action.change")} testID="change-email" onPress={() => setAskPassword(true)} />
        ) : null}
      </View>

      <PromptDialog
        visible={askPassword}
        title={t("common.heading.confirmYourPassword")}
        placeholder={t("common.placeholder.currentPassword")}
        confirmLabel={t("common.continue")}
        secure
        onSubmit={startEmailChange}
        onCancel={() => setAskPassword(false)}
      />
    </Section>
  );
}
