import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import * as Contacts from "expo-contacts";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { backupContacts, getLastContactsBackupAt } from "@/contacts/backupContacts";
import { restoreContacts } from "@/contacts/restoreContacts";
import { findContactsFolder } from "@/backup/folders";
import { listFiles, getDownloadUrl } from "@/files/api";
import { downloadToCache } from "@/files/download";
import { formatDate } from "@/files/format";

export default function ContactsScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Contacts permission left first run - this screen now asks for itself, in
  // context, and is the ONLY path to the OS prompt: the backup/restore
  // actions below are gated on this too, not just on activeId, so nothing on
  // this screen can reach Contacts.requestPermissionsAsync() cold. "checking"
  // (not "undetermined") is the initial value - mirrors app/_layout.tsx's
  // welcomeSeen null-first pattern, distinguishing "not looked yet" from "we
  // looked and it's not granted" - but the primer still renders for BOTH
  // ("checking" and "undetermined" behave the same for rendering), so a
  // fresh mount paints the rationale on the very first render rather than
  // waiting on the async check.
  type PermStatus = "checking" | "granted" | "undetermined" | "denied";
  const [permStatus, setPermStatus] = useState<PermStatus>("checking");
  const [requesting, setRequesting] = useState(false);
  // Same in-flight guard as WorkspaceStep's onCreate: `requesting` (state)
  // only becomes visible on the NEXT render, so it can't stop a second press
  // landing in the same tick as the first, before the button has had a
  // chance to disable itself.
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    setLastBackup(await getLastContactsBackupAt());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Re-checked on every focus, not just on mount: permission can change
  // OUTSIDE this screen (the user backs out to device Settings and grants it
  // there, or denies/grants it from the restore action on a file's viewer
  // screen - see app/(tabs)/(files)/file/[id].tsx). Local state set only by
  // this screen's own onAllow() would otherwise go stale and go on telling an
  // already-permitted user to tap Allow.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void Contacts.getPermissionsAsync()
        .then((res) => {
          if (!alive) return;
          setPermStatus(res.granted ? "granted" : res.status === "denied" ? "denied" : "undetermined");
        })
        .catch(() => { if (alive) setPermStatus("undetermined"); });
      return () => { alive = false; };
    }, []),
  );

  const onAllow = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(true);
    try {
      const res = await Contacts.requestPermissionsAsync();
      // Unlike the focus-time check below, this follows an explicit ask - any
      // non-granted answer here IS a denial (the user (or the OS) just said
      // no), regardless of what `status` string comes back.
      setPermStatus(res.granted ? "granted" : "denied");
    } finally {
      requestInFlight.current = false;
      setRequesting(false);
    }
  };

  const onBackup = async () => {
    if (!activeId || permStatus !== "granted" || backing) return;
    setBacking(true);
    try {
      const res = await backupContacts(activeId);
      toast(t("contacts.status.backingUpCountContacts", { count: res.count }));
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("contacts.error.contactsBackupFailed"), "error");
    } finally {
      setBacking(false);
    }
  };

  const onRestoreLatest = async () => {
    if (!activeId || permStatus !== "granted" || restoring) return;
    setRestoring(true);
    try {
      const folderId = await findContactsFolder(activeId);
      if (!folderId) { toast(t("contacts.error.noContactsBackupFound"), "error"); return; }
      const page = await listFiles({ workspaceId: activeId, folderId, filter: "all", sort: "name_desc", perPage: 500 });
      const latest = page.files
        .filter((f) => f.name.toLowerCase().endsWith(".vcf"))
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) { toast(t("contacts.error.noContactsBackupFound"), "error"); return; }
      const url = await getDownloadUrl(latest.id);
      const localUri = await downloadToCache(url, latest.name);
      const res = await restoreContacts(localUri);
      toast(
        res.failed ? t("common.error.addedAddedContactsFailedFailed", { added: res.added, failed: res.failed }) : t("common.status.addedAddedContacts", { added: res.added }),
        res.failed > 0 ? "error" : "success",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.restoreFailed"), "error");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <>
      {/* Pushed from Settings, so it needs the header's back arrow: without it the only way
          out is the iOS swipe or the Android hardware key. */}
      <Stack.Screen options={{ headerShown: true, title: t("contacts.heading.contacts") }} />
      <Screen underNativeHeader title={t("contacts.heading.contacts")}>
      {/* Fits at the default text size, but the permission primer plus both buttons runs
          past the bottom as soon as the system font is scaled up - and Screen does not
          scroll on its own. */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
      {permStatus !== "granted" ? (
        <View testID="contacts-primer" className="mb-6 rounded-lg border border-border bg-card p-4">
          <Text className="text-base text-foreground">
            {t("contacts.description.yourAddressBookIsExportedAsASingleVcfFileIntoYourWorkspaceSo")}
          </Text>
          <View className="mt-3 gap-2">
            <View className="flex-row items-center gap-2">
              <Icon name="document-text-outline" size={16} color={tokens.mutedForeground} />
              <Text className="flex-1 text-sm text-muted-foreground">{t("contacts.label.oneVcfFileKeptInYourWorkspace")}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon name="lock-closed-outline" size={16} color={tokens.mutedForeground} />
              <Text className="flex-1 text-sm text-muted-foreground">{t("contacts.label.accessOnlyHappensWhenYouTapAllow")}</Text>
            </View>
          </View>
          {permStatus === "denied" ? (
            <Text className="mt-4 text-xs text-destructive">
              {t("contacts.description.contactsAccessWasDeclinedYouCanTurnItOnFromYourDeviceSettingsThen")}
            </Text>
          ) : (
            <View className="mt-4">
              <Button
                title={requesting ? t("contacts.action.requesting") : t("contacts.action.allowContactsAccess")}
                onPress={() => { void onAllow(); }}
                loading={requesting}
                testID="contacts-allow"
              />
            </View>
          )}
        </View>
      ) : null}

      <View className="mb-6 rounded-lg border border-border bg-card p-4">
        <Text className="text-base text-foreground">
          {t("contacts.description.backUpYourPhoneSContactsAsAVcfFileInYourActiveWorkspace")}
        </Text>
        <Text className="mt-2 text-sm text-muted-foreground">{t("contacts.label.lastBackupHasBackupSelectTrueDateOtherNever", { hasBackup: lastBackup ? "true" : "false", date: lastBackup ? formatDate(lastBackup) : "" })}</Text>
      </View>

      <View className="mb-4">
        <Button
          title={backing ? t("contacts.action.backingUp") : t("contacts.action.backUpContactsNow")}
          onPress={() => { void onBackup(); }}
          loading={backing}
          // Gated on permission, not just activeId: without this, pressing
          // this button before ever seeing the primer above reaches
          // backupContacts -> readAllContacts -> requestContactsPermission(),
          // which fires the OS prompt with no rationale shown - the primer's
          // own "Access only happens when you tap Allow" would be a lie.
          disabled={!activeId || permStatus !== "granted"}
          testID="contacts-backup"
        />
      </View>

      <View className="mb-2">
        <Button
          title={restoring ? t("contacts.action.restoring") : t("contacts.action.restoreFromLatestBackup")}
          variant="ghost"
          onPress={() => { void onRestoreLatest(); }}
          loading={restoring}
          disabled={!activeId || permStatus !== "granted"}
          testID="contacts-restore"
        />
      </View>

      <Text className="text-xs text-muted-foreground">
        {t("contacts.description.restoreAddsContactsFromYourMostRecentVcfBackupExistingContactsArenTMerged")}
      </Text>
      </ScrollView>
      </Screen>
    </>
  );
}
