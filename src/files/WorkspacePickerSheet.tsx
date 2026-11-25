import { useState } from "react";
import { FlatList, Modal, Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/Avatar";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaces } from "./hooks";
import { useBackupRun } from "@/backup/runState";
import { useBackupSettings } from "@/backup/settings";
import { formatBytes } from "@/lib/format";
import { useWorkspaceStore } from "./workspaceStore";
import { createWorkspace } from "./api";
import { WorkspaceSwitchSplash } from "./WorkspaceSwitchSplash";
import { workspaceIconUrl } from "./workspace-format";
import type { Workspace } from "./types";
import { useT } from "@/lib/i18n";

const FALLBACK_COLOR = "#22c55e"; // the API's own default for icon_color

export function workspaceIconProps(w: Workspace) {
  return {
    imageUrl: w.icon_image_url ? workspaceIconUrl(w.id) : null,
    initials: w.icon_initials ?? "WS",
    color: w.icon_color ?? FALLBACK_COLOR,
  };
}

/**
 * The workspace list sheet: your workspaces (tap to switch, with the
 * switching splash), then Create workspace. Opened by the header switcher on
 * the Vault/Backup/Settings tabs and by the workspace card in the Files menu.
 */
export function WorkspacePickerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const backupWorkspaceId = useBackupRun((s) => (s.phase !== "idle" ? s.workspaceId : null));
  const destinationIds = useBackupSettings((s) => s.settings.destinationIds);
  const qc = useQueryClient();
  const sheetPad = useSheetBottomPad();
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState<Workspace | null>(null);
  const { data: workspaces } = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const active = workspaces?.find((w) => w.id === activeId) ?? workspaces?.[0];

  // Same shape as web: hold the splash for a flat 2s while the new workspace's queries
  // refetch underneath. Switching to the one you're already in is a no-op, so it shouldn't
  // flash a splash either.
  const switchTo = async (ws: Workspace) => {
    onClose();
    if (ws.id === activeId) return;
    setSwitching(ws);
    await setActive(ws.id);
    setTimeout(() => setSwitching(null), 2000);
  };

  // A one-line quick create: PromptDialog is a title, a single field and two
  // buttons, with no room for the location picker the onboarding step carries.
  // So this path names no location and the server creates the workspace in the
  // one nearest the request - the same answer its suggestion would have given.
  // Setup's WorkspaceStep is where the choice is actually offered.
  const create = async (name: string) => {
    setCreating(false);
    if (!name.trim()) return;
    try {
      const ws = await createWorkspace(name.trim());
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      await setActive(ws.id); // switch to it - creating one then staying put is never the intent
      toast(t("common.status.createdName", { name: ws.name }));
    } catch (e) {
      // e.g. the free plan's owned-workspace cap; the server's message is the useful one.
      toast(e instanceof Error ? e.message : t("common.error.couldnTCreateTheWorkspace"), "error");
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
          <View testID="ws-sheet" className="rounded-t-2xl bg-card p-2" style={{ paddingBottom: sheetPad }}>
            <Text className="px-4 pb-1 pt-3 text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.medium }}>
              {t("common.label.yourWorkspaces")}
            </Text>
            <FlatList
              data={workspaces ?? []}
              keyExtractor={(w) => w.id}
              className="max-h-96"
              renderItem={({ item }) => (
                <Pressable
                  testID={`ws-item-${item.id}`}
                  accessibilityRole="button"
                  className="flex-row items-center gap-3 rounded-lg px-4 py-3"
                  onPress={() => void switchTo(item)}
                >
                  {/* Unlike web (logo in the trigger, initials in the dropdown), the
                      image renders in both places. */}
                  <Avatar {...workspaceIconProps(item)} size={24} radius={5} />
                  <View className="flex-1">
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
                        {item.name}
                      </Text>
                      {destinationIds.includes(item.id) ? (
                        <Icon testID={`ws-dest-${item.id}`} name="shield-checkmark" size={12} color={tokens.primary} />
                      ) : null}
                    </View>
                    {item.id === backupWorkspaceId ? (
                      <Text testID={`ws-backing-${item.id}`} className="text-xs font-medium" style={{ color: tokens.primary }}>
                        {t("common.status.backingUpInFiles")}
                      </Text>
                    ) : item.storage && item.storage.total > 0 ? (
                      <Text testID={`ws-storage-${item.id}`} className="text-xs text-muted-foreground">
                        {t("common.label.freeFreeOfTotal", {
                          free: formatBytes(Math.max(0, item.storage.free ?? item.storage.total - item.storage.used)),
                          total: formatBytes(item.storage.total),
                        })}
                      </Text>
                    ) : null}
                  </View>
                  {item.id === active?.id ? <Icon name="checkmark" size={18} color={tokens.primary} /> : null}
                </Pressable>
              )}
            />

            <Pressable
              testID="ws-create"
              accessibilityRole="button"
              className="mt-1 flex-row items-center gap-3 border-t border-border px-4 py-3"
              onPress={() => { onClose(); setCreating(true); }}
            >
              <View className="h-6 w-6 items-center justify-center rounded-[5px] bg-muted">
                <Icon name="add" size={14} color={tokens.mutedForeground} />
              </View>
              <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                {t("common.action.createWorkspace")}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <PromptDialog
        visible={creating}
        title={t("common.heading.createWorkspace")}
        placeholder={t("common.placeholder.workspaceName")}
        confirmLabel={t("common.action.create")}
        onSubmit={create}
        onCancel={() => setCreating(false)}
      />

      <WorkspaceSwitchSplash workspace={switching} />
    </>
  );
}
