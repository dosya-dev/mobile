import { ActivityIndicator, FlatList, View } from "react-native";
import { Stack } from "expo-router";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { fonts } from "@/theme/fonts";
import { useWorkspaces } from "@/files/hooks";
import { roleLabel, workspaceIconUrl, timeAgo } from "@/files/workspace-format";
import { useT } from "@/lib/i18n";

const FALLBACK_COLOR = "#22c55e";

/** Read-only list of the workspaces you belong to - mirrors web's "My workspaces". */
export default function WorkspacesScreen() {
  const t = useT();
  const { data, isLoading, isError, refetch } = useWorkspaces();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("workspaces.heading.myWorkspaces") }} />
      <Screen underNativeHeader title={t("workspaces.heading.myWorkspaces")}>
        {isLoading ? (
          <View testID="ws-loading" className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>
              {t("workspaces.error.couldnTLoadWorkspaces")}
            </Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>
              {t("common.retry")}
            </Text>
          </View>
        ) : (data?.length ?? 0) === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("workspaces.label.noWorkspaces")}</Text>
          </View>
        ) : (
          <View className="overflow-hidden rounded-lg border border-border bg-card">
            <FlatList
              data={data ?? []}
              keyExtractor={(w) => w.id}
              renderItem={({ item, index }) => (
                <View
                  className={
                    "flex-row items-center gap-3 px-4 py-3" +
                    (index < (data?.length ?? 0) - 1 ? " border-b border-border" : "")
                  }
                >
                  <Avatar
                    imageUrl={item.icon_image_url ? workspaceIconUrl(item.id) : null}
                    initials={item.icon_initials ?? "WS"}
                    color={item.icon_color ?? FALLBACK_COLOR}
                    size={32}
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
                      {item.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                      {t("workspaces.label.joinedTimeAgo", { timeAgo: timeAgo(item.joined_at) })}
                    </Text>
                  </View>
                  <Badge label={roleLabel(item.role_id)} />
                </View>
              )}
            />
          </View>
        )}
      </Screen>
    </>
  );
}
