import { FlatList, View } from "react-native";
import { Text } from "@/ui/Text";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getVersions } from "@/files/api";
import { useFileMutations } from "@/files/mutationHooks";
import { Button } from "@/ui/Button";
import { formatBytes, formatDate } from "@/files/format";
import { toast } from "@/ui/toast";
import { rtlLine, useT } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export default function VersionsScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["versions", id], queryFn: () => getVersions(id) });
  const mut = useFileMutations();
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: t("files.heading.versionHistory") }} />
      <FlatList
        data={q.data?.versions ?? []}
        keyExtractor={(v) => v.id}
        renderItem={({ item }) => {
          const isCurrent = item.version_number === q.data?.current;
          // The Restore box is w-32, not w-28: the shared Button now carries
          // px-5, and "Restore" plus that padding no longer fits 112px once
          // the OS text size is turned up.
          return (
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-border">
              <View className="flex-1">
                <Text className="text-base text-foreground">{t("files.label.versionVersionNumberIsCurrentSelectTrueCurrentOther", { versionNumber: localDigits(item.version_number), isCurrent: isCurrent ? "true" : "false" })}</Text>
                <Text className="text-xs text-muted-foreground">{rtlLine(`${formatBytes(item.size_bytes)} · ${formatDate(item.created_at)}${item.uploader_name ? ` · ${item.uploader_name}` : ""}`)}</Text>
              </View>
              {!isCurrent ? (
                <View className="w-32">
                  <Button title={t("files.action.restore")} variant="ghost" testID={`restore-v${item.version_number}`}
                    onPress={() => mut.restoreVersion.mutate({ id, versionNumber: item.version_number }, { onSuccess: () => { toast(t("common.status.restored")); q.refetch(); } })} />
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
