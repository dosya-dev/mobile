// The Personas settings screen's body (app/personas-settings.tsx). Ported
// from the desktop's components/settings/PersonasSection.tsx (from
// apps/web/src/pages/settings/personas.tsx) onto the phone's settings pattern
// (Section + SettingsRow) - keep the behaviour and copy in step.
//
// Personas is each member's own, on their own devices, so everything here is
// about this user in this workspace:
//
// - "Personas in this workspace": on = engine.turnOn. Off asks "Are you
//   sure?" and then engine.turnOff, which deletes the people, names and
//   corrections from all the user's devices.
// - "Read on this device": pause / resume reading on this phone.
// - "When Personas reads": only while dosya is open / while charging (the
//   default) / any time, and "Use mobile data" (off by default), kept on this
//   phone (./device/settings.ts). Under the choice, for a background mode:
//   the iPhone helper lines, the phone settings that stop background reading
//   (each with "Open Settings"), and when it last read in the background.
//   Picking a background mode on Android asks for notifications, once.
// - "Skipped folders": photos under them are never read (engine.skipFolder).
// - "Delete my people in this workspace": the same as switching off.
// - Locked or without a Vault: a line and "Open Personas", which has the
//   Vault step.
//
// Skipped folders are named from the workspace's folder tree, which the Add
// folder picker needs anyway (as the Smart Search settings do).
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Modal, Platform, Pressable, ScrollView, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { isolateInRtl, useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { timeAgo } from "@/files/workspace-format";
import { fetchFolderTree, flattenTree } from "@/ai-search/api";
import { FolderPickerSheet } from "@/files/FolderPickerSheet";
import { openPersonasPrivacy } from "./api";
import { usePersonasEngine } from "./device/engine-host";
import { lastPersonasUser } from "./device/teardown";
import { clearKeyIfLastWorkspace } from "./device/wipe";
import { askNotificationsOnce, setMobileData, setReadMode, useReadSettings, type ReadMode } from "./device/settings";
import { lastBackgroundSummary } from "./device/health";
import {
  backgroundBlocks, openAppSettings, requestNotificationPermission, supportsContinued, type BackgroundBlock,
} from "../../modules/dosya-personas-background";

const MODES: { mode: ReadMode; label: MessageKey }[] = [
  { mode: "open", label: "personas.label.onlyWhileDosyaIsOpen" },
  { mode: "charging", label: "personas.label.whileCharging" },
  { mode: "anytime", label: "personas.label.anyTime" },
];

const BLOCK_KEYS: Record<BackgroundBlock, MessageKey> = {
  refreshOff: "personas.description.backgroundAppRefreshIsOffForDosya",
  notificationsOff: "personas.description.notificationsAreOffForDosya",
  batteryOptimized: "personas.description.somePhonesStopAppsInTheBackgroundToSaveBattery",
};

export function PersonasSettings({ wsId }: { wsId: string }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const { engine, status, error, refresh } = usePersonasEngine(wsId);
  const { mode, mobileData } = useReadSettings();
  const [busy, setBusy] = useState<"on" | "skip" | null>(null);
  const [offOpen, setOffOpen] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [offFailed, setOffFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const ready = status?.state === "ready";
  const inBackground = mode !== "open";
  // What stops background reading and when it last ran: read again whenever a
  // background mode is chosen, after the notification ask, and when the user
  // comes back to the app (from the phone's Settings, say).
  const [blocks, setBlocks] = useState<BackgroundBlock[]>([]);
  const [last, setLast] = useState<{ at: number; photos: number } | null>(null);
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setRecheck((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!ready || !inBackground) {
      setBlocks([]);
      return;
    }
    let live = true;
    void backgroundBlocks().then((b) => { if (live) setBlocks(b); });
    void lastBackgroundSummary().then((l) => { if (live) setLast(l); }, () => undefined);
    return () => { live = false; };
  }, [ready, inBackground, recheck]);

  const pickMode = (m: ReadMode) => {
    setReadMode(m);
    if (Platform.OS !== "android" || m === "open") return;
    void askNotificationsOnce(requestNotificationPermission).then((asked) => {
      if (asked) setRecheck((n) => n + 1);
    });
  };
  // Read on every render: the hook re-renders on every engine change.
  const skipped = engine && ready ? engine.skippedFolders() : [];

  const tree = useQuery({
    queryKey: ["folders-tree", wsId],
    queryFn: () => fetchFolderTree(wsId),
    enabled: ready && (skipped.length > 0 || pickerOpen),
  });
  const folders = tree.data ?? [];

  const header = (
    <View className="mb-4 gap-1">
      <Text className="text-sm text-muted-foreground">{t("personas.description.groupsThePhotosInThisWorkspaceByThePeopleInThem")}</Text>
      <Pressable
        testID="personas-privacy-link"
        accessibilityRole="link"
        onPress={() => void openPersonasPrivacy()}
        className="min-h-[44px] flex-row items-center gap-1.5 self-start py-2"
      >
        <Text className="text-sm text-primary" style={{ fontFamily: fonts.medium }}>{t("personas.action.howPersonasProtectsYourPrivacy")}</Text>
        <Icon name="open-outline" size={14} color={tokens.primary} />
      </Pressable>
    </View>
  );

  const frame = (body: React.ReactNode) => (
    <View className="flex-1" testID="personas-settings-body">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {header}
        {body}
      </ScrollView>
    </View>
  );

  if (!engine || (!status && !error)) {
    return frame(<View className="items-center py-10"><ActivityIndicator testID="personas-settings-loading" accessibilityLabel={t("common.status.loading")} /></View>);
  }
  if (!status) {
    return frame(
      <View className="items-center gap-3 py-6">
        <Text className="text-center text-sm text-muted-foreground" accessibilityLiveRegion="polite">{t("personas.error.couldNotLoadPersonas")}</Text>
        <Button title={t("common.action.tryAgain")} variant="ghost" testID="personas-settings-retry" onPress={refresh} />
      </View>,
    );
  }
  if (status.state === "needs_identity" || status.state === "needs_unlock") {
    return frame(
      <View className="gap-3 rounded-lg border border-border bg-card px-4 py-4" testID="personas-settings-vault">
        <Text className="text-sm text-muted-foreground">
          {status.state === "needs_identity" ? t("personas.description.personasUsesYourVaultPassphrase") : t("personas.description.unlockWithYourVaultPassphrase")}
        </Text>
        <View className="self-start">
          <Button title={t("personas.action.openPersonas")} variant="ghost" testID="personas-open" onPress={() => router.push("/personas")} />
        </View>
      </View>,
    );
  }

  const paused = ready && status.paused;

  const turnOn = async () => {
    setBusy("on");
    try {
      await engine.turnOn();
      toast(t("common.status.saved"));
    } catch {
      toast(t("personas.error.somethingWentWrongTryAgain"), "error");
    }
    setBusy(null);
  };

  const turnOff = async () => {
    setTurningOff(true);
    setOffFailed(false);
    try {
      await engine.turnOff();
      // The last workspace on this device: its cached key goes too.
      await clearKeyIfLastWorkspace(lastPersonasUser());
      setOffOpen(false);
      toast(t("common.status.saved"));
    } catch {
      setOffFailed(true);
    }
    setTurningOff(false);
  };
  const openOff = () => { setOffFailed(false); setOffOpen(true); };

  const skip = async (id: string, on: boolean) => {
    setBusy("skip");
    try {
      await engine.skipFolder(id, on);
    } catch {
      toast(t("personas.error.somethingWentWrongTryAgain"), "error");
    }
    setBusy(null);
  };

  const nameOf = (id: string) => folders.find((f) => f.id === id)?.name
    ?? (tree.isSuccess || tree.isError ? t("file-requests.label.unknownFolder") : "…");
  const addFolder = (id: string) => {
    setPickerOpen(false);
    if (skipped.includes(id)) return;
    void skip(id, true);
  };

  return (
    <View className="flex-1" testID="personas-settings-body">
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {header}

        <Section title={t("common.label.personas")}>
          <SettingsRow
            testID="personas-row"
            label={t("personas.label.personasInThisWorkspace")}
            border={ready}
            right={
              <View className="flex-row items-center gap-2">
                {busy === "on" ? <ActivityIndicator size="small" /> : null}
                <Switch
                  testID="personas-switch"
                  accessibilityRole="switch"
                  accessibilityLabel={t("personas.label.personasInThisWorkspace")}
                  value={ready}
                  disabled={busy !== null}
                  onValueChange={(v) => (v ? void turnOn() : openOff())}
                />
              </View>
            }
          />

          {ready ? (
            <SettingsRow
              label={t("personas.label.readOnThisDevice")}
              border
              right={
                <Switch
                  testID="personas-read-here"
                  accessibilityRole="switch"
                  accessibilityLabel={t("personas.label.readOnThisDevice")}
                  value={!paused}
                  onValueChange={(v) => engine.setPaused(!v)}
                />
              }
            />
          ) : null}

          {ready ? (
            <View className="px-4 py-3">
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 text-base text-foreground">{t("personas.label.skippedFolders")}</Text>
                <Pressable
                  testID="personas-add-folder"
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.action.addFolder")}
                  accessibilityState={{ disabled: busy !== null }}
                  disabled={busy !== null}
                  onPress={() => setPickerOpen(true)}
                  hitSlop={6}
                  className={"min-h-[44px] flex-row items-center gap-1 rounded-md border border-border px-2.5 py-1.5" + (busy !== null ? " opacity-50" : "")}
                >
                  {busy === "skip" ? <ActivityIndicator size="small" /> : <Icon name="add" size={14} color={tokens.foreground} />}
                  <Text className="text-xs text-foreground" style={{ fontFamily: fonts.medium }}>{t("settings.action.addFolder")}</Text>
                </Pressable>
              </View>
              {skipped.length > 0 ? (
                <View className="mt-3 flex-row flex-wrap gap-1.5">
                  {skipped.map((id) => {
                    const name = nameOf(id);
                    return (
                      // The remove control is a 44 pt target of its own (no hit
                      // slop: wrapped chips sit 6 pt apart, so slops would
                      // overlap and a mis-hit drops the wrong folder at once).
                      <View key={id} testID={`personas-skipped-${id}`} className="flex-row items-center gap-1 rounded-md border border-border bg-secondary ps-2 pe-0">
                        <Icon name="folder-outline" size={12} color={tokens.mutedForeground} />
                        <Text className="max-w-48 text-xs text-foreground" numberOfLines={1}>{isolateInRtl(name)}</Text>
                        <Pressable
                          testID={`personas-remove-${id}`}
                          accessibilityRole="button"
                          accessibilityLabel={t("personas.action.stopSkippingFolder", { folder: name })}
                          accessibilityState={{ disabled: busy !== null }}
                          disabled={busy !== null}
                          onPress={() => void skip(id, false)}
                          className={"min-h-[44px] min-w-[44px] items-center justify-center rounded" + (busy !== null ? " opacity-50" : "")}
                        >
                          <Icon name="close" size={14} color={tokens.mutedForeground} />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
        </Section>

        {ready ? (
          <Section title={t("personas.heading.whenPersonasReads")}>
            <View accessibilityRole="radiogroup" accessibilityLabel={t("personas.heading.whenPersonasReads")} testID="personas-read-modes">
              {MODES.map((o) => {
                const selected = mode === o.mode;
                return (
                  <Pressable
                    key={o.mode}
                    testID={`personas-read-mode-${o.mode}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => pickMode(o.mode)}
                    className="min-h-[44px] flex-row items-center gap-3 border-b border-border px-4 py-3"
                  >
                    <Text className="flex-1 text-base text-foreground" style={{ fontFamily: selected ? fonts.medium : fonts.regular }}>{t(o.label)}</Text>
                    {selected ? <Icon name="checkmark" size={18} color={tokens.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>

            {inBackground ? (
              <BackgroundNotes mode={mode} blocks={blocks} last={last} />
            ) : null}

            <SettingsRow
              label={t("personas.label.useMobileData")}
              description={t("personas.description.offPhotosAreReadOnlyOnWiFi")}
              right={
                <Switch
                  testID="personas-mobile-data"
                  accessibilityRole="switch"
                  accessibilityLabel={t("personas.label.useMobileData")}
                  value={mobileData}
                  onValueChange={setMobileData}
                />
              }
            />
          </Section>
        ) : null}

        {ready ? (
          <View className="rounded-lg border border-destructive/40 bg-card px-4 py-4" testID="personas-delete-card">
            <Text className="text-xs text-muted-foreground">{t("personas.description.yourPeopleNamesAndCorrectionsAreDeleted")}</Text>
            <View className="mt-3 self-start">
              <DangerButton testID="personas-delete" label={t("personas.action.deleteMyPeopleInThisWorkspace")} onPress={openOff} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      <FolderPickerSheet
        visible={pickerOpen}
        loading={tree.isLoading}
        // A folder already skipped (and so its subtree) is not offered again.
        rows={flattenTree(folders).filter((r) => !skipped.includes(r.folder.id))}
        title={t("personas.label.skippedFolders")}
        onPick={addFolder}
        onClose={() => setPickerOpen(false)}
        testIDPrefix="personas"
      />

      <TurnOffDialog
        visible={offOpen}
        busy={turningOff}
        failed={offFailed}
        onCancel={() => { if (!turningOff) setOffOpen(false); }}
        onConfirm={() => void turnOff()}
      />
    </View>
  );
}

/**
 * Under "When Personas reads" while a background mode is chosen: the iPhone
 * lines, each phone setting that stops background reading with "Open
 * Settings", and when the phone last read in the background.
 */
function BackgroundNotes({ mode, blocks, last }: { mode: ReadMode; blocks: BackgroundBlock[]; last: { at: number; photos: number } | null }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const ios = Platform.OS === "ios";
  const continued = ios && mode === "anytime" && supportsContinued();
  if (!ios && blocks.length === 0 && !last) return null;
  return (
    <View className="gap-3 border-b border-border px-4 py-3" testID="personas-background-notes">
      {ios ? (
        <Text className="text-xs text-muted-foreground">{t("personas.description.iPhoneDecidesWhenDosyaCanReadInTheBackground")}</Text>
      ) : null}
      {continued ? (
        <Text className="text-xs text-muted-foreground">{t("personas.description.toKeepReadingAfterYouLeaveDosyaTapKeepReading")}</Text>
      ) : null}
      {blocks.map((b) => (
        <View key={b} className="gap-2" testID={`personas-block-${b}`}>
          <View className="flex-row gap-2">
            <Icon name="alert-circle-outline" size={16} color={tokens.mutedForeground} />
            <Text className="min-w-0 flex-1 text-sm text-foreground">{t(BLOCK_KEYS[b])}</Text>
          </View>
          <Pressable
            testID={`personas-open-settings-${b}`}
            accessibilityRole="button"
            onPress={() => void openAppSettings(b).catch(() => undefined)}
            className="min-h-[44px] justify-center self-start rounded-md border border-border px-3"
          >
            <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("personas.action.openSettings")}</Text>
          </Pressable>
        </View>
      ))}
      {last ? (
        <Text className="text-xs text-muted-foreground" testID="personas-last-background">
          {t("personas.label.lastBackgroundRead", { when: timeAgo(Math.floor(last.at / 1000)), count: last.photos })}
        </Text>
      ) : null}
    </View>
  );
}

function DangerButton({ testID, label, busy, onPress }: { testID: string; label: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!busy }}
      disabled={busy}
      onPress={onPress}
      className={"min-h-[44px] items-center justify-center rounded-lg bg-destructive px-5 py-3" + (busy ? " opacity-60" : "")}
    >
      {busy
        ? <ActivityIndicator color="#ffffff" />
        : <Text className="text-base text-destructive-foreground" style={{ fontFamily: fonts.medium }}>{label}</Text>}
    </Pressable>
  );
}

/**
 * "Are you sure?" with what is deleted; Turn off and delete is the
 * destructive confirm. A failure shows under the statement and the dialog
 * stays open; Cancel and the system back close it, not while it runs.
 */
function TurnOffDialog({ visible, busy, failed, onCancel, onConfirm }: {
  visible: boolean; busy: boolean; failed: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-8">
        <View className="w-full rounded-xl bg-card p-5" testID="personas-off-dialog" accessibilityViewIsModal>
          <Text className="text-lg text-foreground" style={{ fontFamily: fonts.medium }} accessibilityRole="header">{t("common.heading.areYouSure")}</Text>
          <Text className="mt-2 text-sm text-muted-foreground">{t("personas.description.yourPeopleNamesAndCorrectionsAreDeleted")}</Text>
          {failed ? (
            <Text className="mt-3 text-sm text-destructive" accessibilityRole="alert" testID="personas-off-error">{t("personas.error.somethingWentWrongTryAgain")}</Text>
          ) : null}
          <View className="mt-5 flex-row gap-3">
            <View className="flex-1"><Button title={t("common.cancel")} variant="ghost" onPress={onCancel} disabled={busy} testID="personas-off-cancel" /></View>
            <View className="flex-1">
              <DangerButton testID="personas-off-confirm" label={t("personas.action.turnOffAndDelete")} busy={busy} onPress={onConfirm} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
