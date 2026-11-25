import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { PromptDialog } from "@/ui/PromptDialog";
import { toast } from "@/ui/toast";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { getGroups, createGroup, addFolderToGroup, addFileToGroup } from "./api";

/**
 * Pick a group to drop a folder or file into. Creating one is offered inline: groups are
 * per-user and start empty, so without it a first-time user hits a dead end here.
 */
export function AddToGroupSheet({
  target,
  workspaceId,
  visible,
  onClose,
}: {
  target: { kind: "folder" | "file"; id: string; name: string } | null;
  workspaceId: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const sheetPad = useSheetBottomPad();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups", workspaceId],
    queryFn: () => getGroups(workspaceId as string),
    enabled: !!workspaceId && visible,
  });

  const add = async (groupId: string, groupName: string) => {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === "folder") await addFolderToGroup(groupId, target.id);
      else await addFileToGroup(groupId, target.id);
      await qc.invalidateQueries({ queryKey: ["groups", workspaceId] });
      toast(t("common.status.addedToGroupName", { groupName }));
      onClose();
    } catch (e) {
      // e.g. already in the group - the server's message is the useful one.
      toast(e instanceof Error ? e.message : t("common.error.couldnTAddToTheGroup"), "error");
    }
    setBusy(false);
  };

  const create = async (name: string) => {
    setCreating(false);
    if (!name.trim() || !workspaceId) return;
    try {
      await createGroup(workspaceId, name.trim());
      await qc.invalidateQueries({ queryKey: ["groups", workspaceId] });
      toast(t("common.status.createdName", { name: name.trim() }));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.couldnTCreateTheGroup"), "error");
    }
  };

  return (
    <>
      <Modal visible={visible && !creating} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable className="flex-1 bg-black/40" onPress={onClose} testID="add-to-group-backdrop" />
        <View testID="add-to-group-sheet" className="max-h-[60%] rounded-t-2xl bg-card pt-2" style={{ paddingBottom: sheetPad }}>
          <View className="mb-1 items-center">
            <View className="h-1 w-10 rounded-full bg-border" />
          </View>
          <Text className="px-5 py-2 text-base text-foreground" style={{ fontFamily: fonts.bold }} numberOfLines={1}>
            {t("common.label.addNameToGroup", { name: target?.name ?? "" })}
          </Text>

          {isLoading || busy ? (
            <View className="py-8"><ActivityIndicator /></View>
          ) : (
            <ScrollView>
              {(groups ?? []).map((g) => (
                <Pressable
                  key={g.id}
                  testID={`add-to-group-${g.id}`}
                  accessibilityRole="button"
                  onPress={() => void add(g.id, g.name)}
                  className="flex-row items-center gap-3 px-5 py-3"
                >
                  <View className="h-4 w-4 rounded-full" style={{ backgroundColor: g.color }} />
                  <Text className="flex-1 text-base text-foreground" numberOfLines={1}>{g.name}</Text>
                  <Text className="text-xs text-muted-foreground">
                    {t("common.label.item", { count: g.folders.length + g.files.length })}
                  </Text>
                </Pressable>
              ))}
              {(groups ?? []).length === 0 ? (
                <Text className="px-5 py-6 text-center text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                  {t("common.description.youDonTHaveAnyGroupsYet")}
                </Text>
              ) : null}
              <Pressable
                testID="add-to-group-new"
                accessibilityRole="button"
                onPress={() => setCreating(true)}
                className="mt-1 flex-row items-center gap-3 border-t border-border px-5 py-3"
              >
                <Text className="text-base text-primary" style={{ fontFamily: fonts.medium }}>{t("common.action.newGroup")}</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </Modal>

      {creating ? (
        <PromptDialog
          visible
          title={t("common.heading.newGroup")}
          placeholder={t("common.placeholder.groupName")}
          confirmLabel={t("common.action.create")}
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}
