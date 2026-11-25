import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { PromptDialog } from "@/ui/PromptDialog";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { getGroups, createGroup, deleteGroup, type Group } from "@/groups/api";

function errMessage(t: T, e: unknown): string {
  return e instanceof Error ? e.message : t("common.error.somethingWentWrongTryAgain");
}

/** "2 folders · 3 files". */
function countsLine(t: T, folders: number, files: number): string {
  return t("groups.description.foldersPluralOneFolderOtherFoldersFilesPluralOneFileOtherFileS", { folders, files });
}

export default function GroupsScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Group | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["groups", activeId],
    queryFn: () => getGroups(activeId as string),
    enabled: !!activeId,
  });

  const create = async (name: string) => {
    setCreating(false);
    if (!name.trim() || !activeId) return;
    try {
      await createGroup(activeId, name.trim());
      await qc.invalidateQueries({ queryKey: ["groups", activeId] });
      toast(t("common.status.createdName", { name: name.trim() }));
    } catch (e) {
      toast(errMessage(t, e), "error");
    }
  };

  const confirmRemove = async () => {
    const g = removing;
    setRemoving(null);
    if (!g) return;
    try {
      await deleteGroup(g.id);
      await qc.invalidateQueries({ queryKey: ["groups", activeId] });
      toast(t("groups.status.deletedName", { name: g.name }));
    } catch (e) {
      toast(errMessage(t, e), "error");
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("groups.heading.myGroups") }} />
      <Screen underNativeHeader title={t("groups.heading.myGroups")}>
        {!activeId || isLoading ? (
          <View testID="groups-loading" className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("groups.error.couldnTLoadYourGroups")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <>
            <Text className="mb-3 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("groups.description.groupsAreYourOwnTheyCollectFoldersAndFilesAcrossThisWorkspaceAndNobody")}
            </Text>
            <View className="mb-4">
              <Button title={t("groups.action.newGroup")} testID="groups-new" onPress={() => setCreating(true)} />
            </View>
            <FlatList
              data={data ?? []}
              keyExtractor={(g) => g.id}
              ListEmptyComponent={
                <View className="items-center py-10">
                  <Text className="text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("groups.description.noGroupsYet")}</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View
                  testID={`group-${item.id}`}
                  className="mb-2 flex-row items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <View className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                      {item.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                      {countsLine(t, item.folders.length, item.files.length)}
                    </Text>
                  </View>
                  <Pressable
                    testID={`group-delete-${item.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.action.deleteCount", { count: item.name })}
                    hitSlop={8}
                    onPress={() => setRemoving(item)}
                  >
                    <Icon name="trash-outline" size={18} color={tokens.destructive} />
                  </Pressable>
                </View>
              )}
            />
          </>
        )}

        <PromptDialog
          visible={creating}
          title={t("common.heading.newGroup")}
          placeholder={t("common.placeholder.groupName")}
          confirmLabel={t("common.action.create")}
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
        <ConfirmDialog
          visible={removing !== null}
          title={t("groups.heading.deleteGroup")}
          message={removing ? t("groups.description.nameGoesAwayTheFoldersAndFilesInItAreUntouched", { name: removing.name }) : undefined}
          confirmLabel={t("common.delete")}
          destructive
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      </Screen>
    </>
  );
}
