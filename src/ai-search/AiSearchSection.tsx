// The "AI search" section of workspace settings. Port of the desktop's
// components/settings/AiSearchSection.tsx plus its dashboard AiSearchCard:
// the phone has no per-workspace dashboard, so the indexing status sits under
// the controls here.
//
// GET  /api/workspaces/:id/ai-search  settings + status + can_edit, any member
// PUT  same path                      owner or change_ai_search
//
// `status.limits === null` means the owner's plan has no AI search: the switch
// is disabled with the "paid plans" line (but stays usable to switch OFF a
// workspace still on after a downgrade). No upgrade link: plans are bought on
// the web, and the stores do not allow an in-app path to it.
import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { formatNumber } from "@/lib/format-locale";
import { FolderPickerSheet } from "@/files/FolderPickerSheet";
import {
  aiSearchKey, fetchFolderTree, fetchWorkspaceAiSearch, flattenTree, forgetContentAvailability, pauseReason,
  updateErrorKind, updateWorkspaceAiSearch, type AiSearchSettings, type AiSearchSettingsResponse,
} from "./api";

export function AiSearchSection({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { tokens } = useColorTheme();
  const [saving, setSaving] = useState<keyof AiSearchSettings | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // A failed load hides the section: AI search is optional.
  const { data } = useQuery({
    queryKey: aiSearchKey(workspaceId),
    queryFn: () => fetchWorkspaceAiSearch(workspaceId),
  });
  const excluded = data?.settings.excluded_folders ?? [];
  const tree = useQuery({
    queryKey: ["folders-tree", workspaceId],
    queryFn: () => fetchFolderTree(workspaceId),
    enabled: !!data && (excluded.length > 0 || pickerOpen),
  });

  if (!data) return null;
  const { settings, status } = data;
  const canEdit = data.can_edit;
  const inPlan = status.limits !== null;

  const save = async (field: keyof AiSearchSettings, body: Partial<AiSearchSettings>) => {
    setSaving(field);
    try {
      const next = await updateWorkspaceAiSearch(workspaceId, body);
      if (next) qc.setQueryData<AiSearchSettingsResponse | null>(aiSearchKey(workspaceId), (d) => (d ? { ...d, settings: { ...next, excluded_folders: next.excluded_folders ?? [] } } : d));
      forgetContentAvailability(workspaceId);
      toast(t("common.status.saved"));
      void qc.invalidateQueries({ queryKey: aiSearchKey(workspaceId) });
    } catch (e) {
      const kind = updateErrorKind(e);
      toast(
        kind === "notInPlan" ? t("settings.description.aiSearchIsAvailableOnPaidPlans")
          : kind === "notForWorkspace" ? t("settings.error.aiSearchIsNotAvailableForThisWorkspace")
          : kind === "rateLimited" ? t("settings.error.tooManyChangesTryAgainInAMinute")
          : t("settings.error.failedToSave"),
        "error",
      );
    }
    setSaving(null);
  };

  // Switching ON needs the plan; switching OFF is always allowed.
  const switchDisabled = !canEdit || saving !== null || (!inPlan && !settings.enabled);
  const controlsDisabled = !canEdit || saving !== null;
  const switchDesc = !inPlan ? t("settings.description.aiSearchIsAvailableOnPaidPlans")
    : !canEdit ? t("settings.description.youDoNotHavePermissionToChangeAiSearch")
    : t("settings.description.findsFilesByWhatTheyAreAboutByTextInsideDocumentsAndImages");

  const folders = tree.data ?? [];
  const nameOf = (id: string) => folders.find((f) => f.id === id)?.name
    ?? (tree.isSuccess || tree.isError ? t("file-requests.label.unknownFolder") : "…");
  const removeFolder = (id: string) => save("excluded_folders", { excluded_folders: excluded.filter((f) => f !== id) });
  const addFolder = (id: string) => {
    setPickerOpen(false);
    if (!excluded.includes(id)) void save("excluded_folders", { excluded_folders: [...excluded, id] });
  };
  const spinner = (field: keyof AiSearchSettings) => (saving === field ? <ActivityIndicator size="small" /> : null);

  return (
    <View testID="ai-search-section">
      <Section title={t("settings.label.aiSearch")}>
        <SettingsRow
          label={t("settings.label.searchInsideFilesAndPhotos")}
          description={switchDesc}
          border={settings.enabled}
          right={
            <View className="flex-row items-center gap-2">
              {spinner("enabled")}
              <Switch testID="ai-search-enabled" value={settings.enabled} disabled={switchDisabled} onValueChange={(v) => save("enabled", { enabled: v })} />
            </View>
          }
        />
        {settings.enabled ? (
          <>
            <SettingsRow
              label={t("settings.label.alsoIndexExistingFiles")}
              border
              right={
                <View className="flex-row items-center gap-2">
                  {spinner("index_existing")}
                  <Switch testID="ai-search-index-existing" value={settings.index_existing} disabled={controlsDisabled} onValueChange={(v) => save("index_existing", { index_existing: v })} />
                </View>
              }
            />
            <View className="px-4 py-3">
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-base text-foreground" style={{ fontFamily: fonts.regular }}>{t("settings.label.excludeFolders")}</Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("settings.description.filesInTheseFoldersAreNotIndexed")}</Text>
                </View>
                <Pressable
                  testID="ai-search-add-folder"
                  accessibilityRole="button"
                  disabled={controlsDisabled}
                  onPress={() => setPickerOpen(true)}
                  className={"flex-row items-center gap-1 rounded-md border border-border px-2.5 py-1.5" + (controlsDisabled ? " opacity-50" : "")}
                >
                  {saving === "excluded_folders" ? <ActivityIndicator size="small" /> : <Icon name="add" size={14} color={tokens.foreground} />}
                  <Text className="text-xs text-foreground" style={{ fontFamily: fonts.medium }}>{t("settings.action.addFolder")}</Text>
                </Pressable>
              </View>
              {excluded.length > 0 ? (
                <View className="mt-3 flex-row flex-wrap gap-1.5">
                  {excluded.map((id) => (
                    <View key={id} testID={`ai-search-excluded-${id}`} className="flex-row items-center gap-1 rounded-md border border-border bg-secondary py-0.5 pe-1 ps-2">
                      <Icon name="folder-outline" size={12} color={tokens.mutedForeground} />
                      <Text className="max-w-48 text-xs text-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{nameOf(id)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("common.remove")}
                        hitSlop={8}
                        disabled={controlsDisabled}
                        onPress={() => removeFolder(id)}
                        className={"rounded p-0.5" + (controlsDisabled ? " opacity-50" : "")}
                      >
                        <Icon name="close" size={12} color={tokens.mutedForeground} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </Section>

      {settings.enabled && status.limits ? <IndexStatus data={data} /> : null}

      <FolderPickerSheet
        visible={pickerOpen}
        loading={tree.isLoading}
        rows={flattenTree(folders).filter((r) => !excluded.includes(r.folder.id))}
        title={t("settings.label.excludeFolders")}
        onPick={addFolder}
        onClose={() => setPickerOpen(false)}
        testIDPrefix="ai-search"
      />
    </View>
  );
}

/** Indexed / waiting counts, the plan's image and document budgets, and why indexing is paused. */
function IndexStatus({ data }: { data: AiSearchSettingsResponse }) {
  const t = useT();
  const { status } = data;
  const limits = status.limits!;
  const reason = pauseReason(status);
  return (
    <View testID="ai-search-status" className="-mt-3 mb-6 gap-4 rounded-lg border border-border bg-card p-4">
      {reason ? (
        <Text testID="ai-search-paused" className="rounded-md bg-secondary px-3 py-2 text-xs text-foreground" style={{ fontFamily: fonts.regular }}>
          {reason === "maintenance" ? t("dashboard.status.pausedByDosya") : t("settings.status.pausedLimitReached")}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("settings.label.indexed")}</Text>
          <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>{formatNumber(status.indexed)}</Text>
        </View>
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("settings.label.waiting")}</Text>
          <Text className="text-lg text-foreground" style={{ fontFamily: fonts.bold }}>{formatNumber(status.pending)}</Text>
        </View>
      </View>
      <Budget label={t("common.label.images")} used={status.images} max={limits.imagesMax} />
      <Budget label={t("common.label.documents")} used={status.documents} max={limits.documentsMax} />
    </View>
  );
}

function Budget({ label, used, max }: { label: string; used: number; max: number }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <View>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-xs text-foreground" style={{ fontFamily: fonts.regular }}>{label}</Text>
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("settings.label.countOfMax", { count: formatNumber(used), max: formatNumber(max) })}
        </Text>
      </View>
      <View
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max, now: Math.min(used, max) }}
      >
        <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? tokens.destructive : tokens.primary }} />
      </View>
    </View>
  );
}
