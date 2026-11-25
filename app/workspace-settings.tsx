import { useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { WorkspaceHeader } from "@/files/WorkspaceHeader";
import { roleLabel, workspaceIconUrl } from "@/files/workspace-format";
import { formatBytes } from "@/files/format";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import type { MessageKey } from "@/i18n/keys";
import { usePermissions } from "@/workspace/usePermissions";
import {
  getWorkspaceDetail, getRoles, getTeam, updateWorkspaceName, updateWorkspaceSettings,
  transferOwnership, leaveWorkspace, type WorkspaceDetail,
} from "@/workspace/api";
import { localDigits } from "@/lib/format-locale";
import { AiSearchSection } from "@/ai-search/AiSearchSection";

const FALLBACK_COLOR = "#22c55e";

/**
 * The numeric hard limits, each permission-gated server-side. `perm` mirrors
 * the field map in the settings endpoint, so a role lacking one sees the
 * value instead of a field whose Save can only 403.
 */
const LIMITS: { key: string; label: MessageKey; unit: string; perm: string }[] = [
  { key: "max_file_size_gb", label: "workspace-settings.label.maxFileSize", unit: "GB", perm: "change_max_file_size" },
  { key: "max_total_storage_gb", label: "workspace-settings.label.totalStorageCap", unit: "GB", perm: "change_total_storage_cap" },
  { key: "max_storage_per_member_gb", label: "workspace-settings.label.storagePerMember", unit: "GB", perm: "change_storage_per_member" },
  { key: "max_concurrent_uploads", label: "workspace-settings.label.concurrentUploads", unit: "", perm: "change_max_concurrent_uploads" },
];

/** Boolean security settings - all gated on manage_settings server-side. */
const SECURITY_TOGGLES: { key: string; label: MessageKey; desc: MessageKey }[] = [
  { key: "require_2fa", label: "workspace-settings.label.require2FA", desc: "workspace-settings.description.membersMustHaveTwoFactorAuthenticationEnabled" },
  { key: "disable_password_login", label: "workspace-settings.action.disablePasswordLogin", desc: "workspace-settings.description.membersMustSignInWithGoogleOrGitHub" },
  { key: "disable_share_links", label: "workspace-settings.action.disableShareLinks", desc: "workspace-settings.description.preventMembersCreatingPublicShareLinks" },
  { key: "force_share_password", label: "workspace-settings.label.forceSharePasswords", desc: "workspace-settings.description.everyShareLinkMustHaveAPassword" },
  { key: "download_tracking", label: "workspace-settings.action.downloadTracking", desc: "workspace-settings.description.recordWhoDownloadsSharedFiles" },
  { key: "notify_on_upload", label: "workspace-settings.label.notifyOnUpload", desc: "workspace-settings.description.alertTheWorkspaceWhenFilesAreUploaded" },
  { key: "record_upload_origin", label: "workspace-settings.label.recordUploadOrigin", desc: "workspace-settings.description.storeWhereAnUploadCameFrom" },
];

const SECURITY_NUMBERS: { key: string; label: MessageKey; unit: string; unitKey?: MessageKey }[] = [
  { key: "session_timeout_minutes", label: "workspace-settings.label.sessionTimeout", unit: "minutes", unitKey: "workspace-settings.label.minutes" },
  { key: "share_max_expiry_days", label: "workspace-settings.label.maxShareExpiry", unit: "days", unitKey: "workspace-settings.label.days" },
  { key: "download_rate_limit", label: "workspace-settings.action.downloadRateLimit", unit: "per hour", unitKey: "workspace-settings.label.perHour" },
];

function errMessage(e: unknown, t: T): string {
  return e instanceof Error ? e.message : t("common.error.couldnTSaveTryAgain");
}

export default function WorkspaceSettingsScreen() {
  const t = useT();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["workspace-detail", activeId],
    queryFn: () => getWorkspaceDetail(activeId!),
    enabled: !!activeId,
  });

  return (
    <>
      {/* No native header: the switcher *is* the title here - it names the workspace you're
          editing and lets you jump to another one's settings - and a native header would
          both stack a second title above it and re-pad the status bar. */}
      <Stack.Screen options={{ headerShown: false }} />
      <Screen header={<WorkspaceHeader back settings={false} search={false} notifications={false} />}>
        {!activeId || isLoading ? (
          <View testID="ws-settings-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !data ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("workspace-settings.error.couldnTLoadWorkspaceSettings")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <InfoSection data={data} />
            <LimitsSection data={data} />
            <SecuritySection data={data} />
            <AiSearchSection workspaceId={data.workspace.id} />
            <RolesSection workspaceId={data.workspace.id} myRoleId={data.role_id} />
            <DangerSection data={data} />
          </ScrollView>
        )}
      </Screen>
    </>
  );
}

function InfoSection({ data }: { data: WorkspaceDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const ws = data.workspace;
  const [name, setName] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  // Renaming is its own permission; this screen used to offer the field to
  // every role. (There is no icon editor on mobile, so change_workspace_icon
  // has nothing here to gate.)
  const { can } = usePermissions();
  const canRename = can("change_workspace_name");

  const save = async () => {
    setSaving(true);
    try {
      await updateWorkspaceName(ws.id, name.trim());
      await qc.invalidateQueries({ queryKey: ["workspace-detail", ws.id] });
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast(t("workspace-settings.status.workspaceRenamed"));
    } catch (e) { toast(errMessage(e, t), "error"); }
    setSaving(false);
  };

  const pct = data.storage.total > 0 ? Math.min(100, Math.round((data.storage.used / data.storage.total) * 100)) : 0;

  return (
    <>
      <View className="mb-6 flex-row items-center gap-3">
        <Avatar
          imageUrl={ws.icon_image_url ? workspaceIconUrl(ws.id) : null}
          initials={ws.icon_initials ?? "WS"}
          color={ws.icon_color ?? FALLBACK_COLOR}
          size={48}
        />
        <View className="min-w-0 flex-1">
          <Text className="text-lg text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>{ws.name}</Text>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("workspace-settings.label.rolePlanPlan", { role: roleLabel(data.role_id), plan: data.plan })}
          </Text>
        </View>
      </View>

      <Section title={t("common.heading.workspace")}>
        {canRename ? (
          <View className="gap-2 px-4 py-4">
            <TextField label={t("common.label.name")} testID="ws-name" value={name} onChangeText={setName} />
            <Button title={t("common.save")} testID="ws-name-save" onPress={save} loading={saving} disabled={!name.trim() || name.trim() === ws.name} />
          </View>
        ) : (
          <SettingsRow testID="ws-name-readonly" label={t("common.label.name")} description={t("workspace-settings.description.yourRoleCanTChangeThis")} value={ws.name} border />
        )}
        {/* Read-only, and named "Location" rather than "Default region": there
            is no per-upload override for it to be the default of, and the
            value is permanent - the server refuses to move a workspace. */}
        <SettingsRow
          label={t("common.label.location")}
          description={t("workspace-settings.description.chosenWhenTheWorkspaceWasCreated")}
          right={<Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{ws.default_region}</Text>}
          border
        />
        <SettingsRow
          label={t("navigation.label.storage")}
          description={t("workspace-settings.label.usedOfTotalUsedPercent", {
            used: formatBytes(data.storage.used),
            total: formatBytes(data.storage.total),
            percent: localDigits(pct),
          })}
        />
      </Section>
    </>
  );
}

function LimitsSection({ data }: { data: WorkspaceDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const { can } = usePermissions();

  const current = (key: string): string => {
    const v = data.settings?.[key];
    return v === null || v === undefined ? "" : String(v);
  };

  const save = async (key: string) => {
    const raw = edits[key];
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) { toast(t("workspace-settings.error.enterANumber"), "error"); return; }
    setSavingKey(key);
    try {
      await updateWorkspaceSettings(data.workspace.id, { [key]: n });
      await qc.invalidateQueries({ queryKey: ["workspace-detail", data.workspace.id] });
      toast(t("workspace-settings.status.limitUpdated"));
      setEdits((e) => { const { [key]: _drop, ...rest } = e; return rest; });
    } catch (e) {
      // Each field is permission-gated server-side; a custom role may lack this one.
      toast(errMessage(e, t), "error");
    }
    setSavingKey(null);
  };

  return (
    <Section title={t("workspace-settings.heading.hardLimits")}>
      {LIMITS.map((l, i) => {
        if (!can(l.perm)) {
          const v = current(l.key);
          return (
            <SettingsRow
              key={l.key}
              testID={`limit-readonly-${l.key}`}
              label={t(l.label)}
              description={t("workspace-settings.description.yourRoleCanTChangeThis")}
              value={v === "" ? t("common.status.notSet") : `${v} ${l.unit}`.trim()}
              border={i < LIMITS.length - 1}
            />
          );
        }
        const value = edits[l.key] ?? current(l.key);
        const dirty = edits[l.key] !== undefined && edits[l.key] !== current(l.key);
        return (
          <View key={l.key} className={"gap-2 px-4 py-4" + (i < LIMITS.length - 1 ? " border-b border-border" : "")}>
            <TextField
              label={l.unit ? `${t(l.label)} (${l.unit})` : t(l.label)}
              testID={`limit-${l.key}`}
              value={value}
              onChangeText={(text) => setEdits((e) => ({ ...e, [l.key]: text }))}
              keyboardType="number-pad"
              placeholder={t("workspace-settings.placeholder.notSet")}
            />
            {dirty ? (
              <Button title={t("common.save")} testID={`limit-save-${l.key}`} onPress={() => save(l.key)} loading={savingKey === l.key} />
            ) : null}
          </View>
        );
      })}
    </Section>
  );
}

function SecuritySection({ data }: { data: WorkspaceDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const id = data.workspace.id;
  // Every field in this section is behind manage_settings server-side.
  const { can } = usePermissions();
  const canManage = can("manage_settings");

  const boolOf = (key: string) => pending[key] ?? data.settings?.[key] === true;
  const numOf = (key: string) => {
    const v = data.settings?.[key];
    return v === null || v === undefined ? "" : String(v);
  };

  const toggle = async (key: string, next: boolean) => {
    setPending((p) => ({ ...p, [key]: next }));
    try {
      await updateWorkspaceSettings(id, { [key]: next });
      await qc.invalidateQueries({ queryKey: ["workspace-detail", id] });
    } catch (e) {
      setPending((p) => { const { [key]: _drop, ...rest } = p; return rest; });
      toast(errMessage(e, t), "error");
    }
  };

  const saveNumber = async (key: string) => {
    const raw = edits[key];
    const n = Number(raw);
    if (raw === "" || Number.isNaN(n)) { toast(t("workspace-settings.error.enterANumber"), "error"); return; }
    setSavingKey(key);
    try {
      await updateWorkspaceSettings(id, { [key]: n });
      await qc.invalidateQueries({ queryKey: ["workspace-detail", id] });
      setEdits((e) => { const { [key]: _drop, ...rest } = e; return rest; });
      toast(t("common.status.saved"));
    } catch (e) { toast(errMessage(e, t), "error"); }
    setSavingKey(null);
  };

  return (
    <Section title={t("workspace-settings.heading.security")}>
      {!canManage ? (
        <SettingsRow label={t("workspace-settings.label.readOnly")} description={t("workspace-settings.description.yourRoleCanTChangeSecuritySettings")} border />
      ) : null}
      {SECURITY_TOGGLES.map((row) => (
        <SettingsRow
          key={row.key}
          label={t(row.label)}
          description={t(row.desc)}
          border
          right={<Switch testID={`sec-${row.key}`} value={boolOf(row.key)} disabled={!canManage} onValueChange={(v) => toggle(row.key, v)} />}
        />
      ))}
      {SECURITY_NUMBERS.map((n, i) => {
        if (!canManage) {
          const v = numOf(n.key);
          return (
            <SettingsRow
              key={n.key}
              testID={`sec-readonly-${n.key}`}
              label={t(n.label)}
              value={v === "" ? t("common.status.notSet") : `${v} ${n.unitKey ? t(n.unitKey) : n.unit}`}
              border={i < SECURITY_NUMBERS.length - 1}
            />
          );
        }
        const value = edits[n.key] ?? numOf(n.key);
        const dirty = edits[n.key] !== undefined && edits[n.key] !== numOf(n.key);
        return (
          <View key={n.key} className={"gap-2 px-4 py-4" + (i < SECURITY_NUMBERS.length - 1 ? " border-b border-border" : "")}>
            <TextField
              label={`${t(n.label)} (${n.unitKey ? t(n.unitKey) : n.unit})`}
              testID={`sec-${n.key}`}
              value={value}
              onChangeText={(text) => setEdits((e) => ({ ...e, [n.key]: text }))}
              keyboardType="number-pad"
              placeholder={t("workspace-settings.placeholder.notSet")}
            />
            {dirty ? (
              <Button title={t("common.save")} testID={`sec-save-${n.key}`} onPress={() => saveNumber(n.key)} loading={savingKey === n.key} />
            ) : null}
          </View>
        );
      })}
    </Section>
  );
}

function RolesSection({ workspaceId, myRoleId }: { workspaceId: string; myRoleId: string }) {
  const t = useT();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["roles", workspaceId],
    queryFn: () => getRoles(workspaceId),
  });

  return (
    <Section title={t("workspace-settings.heading.rolesPermissions")}>
      {(data?.roles ?? []).map((r, i, arr) => {
        const granted = Object.values(r.permissions ?? {}).filter(Boolean).length;
        const total = Object.keys(r.permissions ?? {}).length;
        return (
          <SettingsRow
            key={r.id}
            label={r.name}
            description={t("workspace-settings.label.grantedOfTotalPermissions", { granted: localDigits(granted), total: localDigits(total) })}
            border={i < arr.length - 1}
            right={r.id === myRoleId ? <Badge label={t("common.label.you")} /> : undefined}
          />
        );
      })}
      {(data?.roles ?? []).length === 0 ? (
        <SettingsRow label={t("workspace-settings.label.noRoles")} description={t("workspace-settings.error.rolesCouldnTBeLoadedForThisWorkspace")} />
      ) : null}
      {/* The list above was a dead end: roles could be read here but edited
          nowhere on the phone. The editor lives in the web app, so say so and
          open it, the way the Danger zone hands deletion off. */}
      <SettingsRow
        testID="roles-open-web"
        label={t("workspace-settings.action.editRolesOnTheWeb")}
        description={t("workspace-settings.description.rolesAndTheirPermissionsAreEditedInTheWebApp")}
        border
        onPress={() => {
          void Linking.openURL("https://app.dosya.dev/settings#roles").catch(() => {
            toast(t("workspace-settings.error.couldnTOpenTheBrowser"), "error");
          });
        }}
      />
      <SettingsRow
        icon="people"
        label={t("workspace-settings.action.teamsInvites")}
        description={t("workspace-settings.label.membersRolesAndInvitations")}
        border
        onPress={() => router.push("/teams")}
      />
    </Section>
  );
}

/**
 * Pick a member to hand the workspace to. Sends their user_id - the field the transfer
 * endpoint actually wants.
 */
function TransferSheet({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { tokens } = useColorTheme();
  const { data } = useQuery({ queryKey: ["team", workspaceId], queryFn: () => getTeam(workspaceId) });
  const sheetPad = useSheetBottomPad();
  const [busy, setBusy] = useState(false);

  const others = (data?.members ?? []).filter((m) => m.role_id !== "role_owner");

  const pick = async (userId: string, name: string) => {
    setBusy(true);
    try {
      await transferOwnership(workspaceId, userId);
      await qc.invalidateQueries({ queryKey: ["workspace-detail", workspaceId] });
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast(t("workspace-settings.status.nameNowOwnsThisWorkspace", { name }));
      onClose();
      router.replace("/");
    } catch (e) { toast(errMessage(e, t), "error"); }
    setBusy(false);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <View testID="transfer-sheet" className="rounded-t-2xl bg-card p-2" style={{ paddingBottom: sheetPad }}>
          <Text className="px-4 pb-1 pt-3 text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.medium }}>
            {t("workspace-settings.label.transferOwnershipTo")}
          </Text>
          {others.length === 0 ? (
            <Text className="px-4 py-6 text-center text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("workspace-settings.action.inviteSomeoneFirstThereSNoOneToTransferTo")}
            </Text>
          ) : (
            others.map((m) => (
              <Pressable
                key={m.membership_id}
                testID={`transfer-${m.user_id}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => pick(m.user_id, m.name || m.email)}
                className="flex-row items-center gap-3 rounded-lg px-4 py-3"
              >
                <Avatar initials={m.name || m.email} color={tokens.muted} textColor={tokens.mutedForeground} size={28} radius={14} />
                <View className="min-w-0 flex-1">
                  <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{m.name || m.email}</Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{m.email}</Text>
                </View>
                <Badge label={roleLabel(m.role_id)} />
              </Pressable>
            ))
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

function DangerSection({ data }: { data: WorkspaceDetail }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  // Leave is the only in-app confirmation left; deletion hands off to the web.
  const [confirm, setConfirm] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ws = data.workspace;

  const run = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      await leaveWorkspace(ws.id);
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast(t("workspace-settings.status.leftWorkspace"));
      router.replace("/");
    } catch (e) { toast(errMessage(e, t), "error"); }
    setBusy(false);
  };

  /**
   * Deletion moved to the web app when the server started requiring a 6-digit
   * code mailed to the owner plus the workspace name retyped. That ceremony has
   * no home here, and calling DELETE without it now just fails - so the row
   * hands off to the browser instead of offering a button that cannot work.
   */
  const deleteOnWeb = () => {
    void Linking.openURL("https://app.dosya.dev/settings#section-danger").catch(() => {
      toast(t("workspace-settings.error.couldnTOpenTheBrowser"), "error");
    });
  };

  return (
    <>
      <Section title={t("profile.heading.dangerZone")}>
        {/* The owner can't leave their own workspace - they'd orphan it; transfer first. */}
        {data.is_owner ? (
          <>
            <SettingsRow
              icon="swap-horizontal"
              label={t("workspace-settings.action.transferOwnership")}
              description={t("workspace-settings.description.handThisWorkspaceToAnotherMemberYouLlBecomeAnAdmin")}
              border
              onPress={() => setTransferOpen(true)}
            />
            <SettingsRow
              label={t("workspace-settings.action.deleteWorkspace")}
              description={t("workspace-settings.description.permanentlyDeletesNameAndEverythingInItOnlyAvailableInTheWebAppIt", { name: ws.name })}
              right={<Button title={t("workspace-settings.action.openWeb")} variant="ghost" testID="ws-delete" onPress={deleteOnWeb} disabled={busy} />}
            />
          </>
        ) : (
          <SettingsRow
            label={t("workspace-settings.action.leaveWorkspace")}
            description={t("workspace-settings.description.youLlLoseAccessUntilYouReInvitedBack")}
            right={<Button title={t("common.action.leave")} variant="ghost" testID="ws-leave" onPress={() => setConfirm(true)} disabled={busy} />}
          />
        )}
      </Section>

      {transferOpen ? <TransferSheet workspaceId={ws.id} onClose={() => setTransferOpen(false)} /> : null}

      <ConfirmDialog
        visible={confirm}
        title={t("workspace-settings.heading.leaveWorkspace")}
        message={t("workspace-settings.description.youLlLoseAccessToNameUntilSomeoneInvitesYouBack", { name: ws.name })}
        confirmLabel={t("common.action.leave")}
        destructive
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
