import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { fonts } from "@/theme/fonts";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { roleLabel, workspaceIconUrl } from "@/files/workspace-format";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaceDashboard } from "@/workspace-dashboard/api";
import {
  storageColor, stackedSegments, SOURCE_DOT, WS_SEGMENT_COLORS,
  type WorkspaceDashboardData,
} from "@/workspace-dashboard/helpers";

const FALLBACK_COLOR = "#22c55e";
/** Stands in for the size while the message is split around it. */
const USED_SIZE = "\u0000";
const USED_SIZE_SPLIT = /(\u0000)/;

export default function WorkspaceDashboardScreen() {
  const t = useT();
  const { data, isLoading, isError, refetch } = useWorkspaceDashboard();
  const router = useRouter();
  const setActive = useWorkspaceStore((s) => s.setActive);

  const openWorkspace = async (id: string) => {
    await setActive(id);
    router.replace("/");
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("workspaces.heading.workspaceDashboard") }} />
      <Screen underNativeHeader title={t("workspaces.heading.workspaceDashboard")}>
        {isLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !data ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("dashboard.error.couldnTLoadYourDashboard")}</Text>
            <Text className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <DashboardBody data={data} onOpen={openWorkspace} />
        )}
      </Screen>
    </>
  );
}

function DashboardBody({ data, onOpen }: { data: WorkspaceDashboardData; onOpen: (id: string) => void }) {
  const t = useT();
  const { total, sources, owned, shared } = data;
  const pct = total.limit_bytes > 0 ? Math.min(100, Math.round((total.used_bytes / total.limit_bytes) * 100)) : 0;
  const segments = stackedSegments(owned, total.used_bytes);
  // "{usedSize} used" is one message: the size keeps its big type and the rest
  // of the sentence (in whatever order the language puts it) the small muted one.
  const usedParts = t("dashboard.heading.usedsizeUsed", { usedSize: USED_SIZE }).split(USED_SIZE_SPLIT).filter(Boolean);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
      {/* Your storage */}
      <Section title={t("dashboard.heading.yourStorage")}>
        <View className="p-4">
          <View className="flex-row items-end justify-between">
            <Text className="text-xl text-foreground" style={{ fontFamily: fonts.bold }}>
              {usedParts.map((part, i) =>
                part === USED_SIZE ? (
                  <Text key={i}>{formatBytes(total.used_bytes)}</Text>
                ) : (
                  <Text key={i} className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{part}</Text>
                ),
              )}
            </Text>
            <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("common.label.freeFreeOfTotal", { free: formatBytes(total.free_bytes), total: formatBytes(total.limit_bytes) })}
            </Text>
          </View>
          {/* Stacked-by-workspace usage bar */}
          <View className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <View className="h-full flex-row" style={{ width: `${pct}%` }}>
              {segments.length === 0 ? (
                <View className="h-full flex-1" style={{ backgroundColor: storageColor(pct) }} />
              ) : segments.map((seg) => {
                const ownedIdx = owned.findIndex((w) => w.id === seg.id);
                return (
                  <View key={seg.id} className="h-full" style={{ width: `${seg.widthPct}%`, backgroundColor: WS_SEGMENT_COLORS[ownedIdx % WS_SEGMENT_COLORS.length] }} />
                );
              })}
            </View>
          </View>
          <Text className="mt-1.5 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("dashboard.label.pctOfYourTotalSpaceUsed", { pct })}</Text>
        </View>
      </Section>

      {/* Where your space comes from */}
      <Section title={t("dashboard.heading.whereYourSpaceComesFrom")}>
        <View className="p-4">
          {sources.map((src, i) => (
            <View key={`${src.kind}-${i}`} className="flex-row items-center gap-2 py-1">
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: SOURCE_DOT[src.kind] ?? "#6b7280" }} />
              <Text className="flex-1 text-xs text-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{src.label}</Text>
              <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{formatBytes(src.bytes)}</Text>
            </View>
          ))}
          <View className="mt-2 flex-row justify-between border-t border-border pt-2">
            <Text className="text-xs text-foreground" style={{ fontFamily: fonts.bold }}>{t("common.label.total")}</Text>
            <Text className="text-xs text-foreground" style={{ fontFamily: fonts.bold }}>{formatBytes(total.limit_bytes)}</Text>
          </View>
        </View>
      </Section>

      {/* Workspaces you own */}
      <Section title={t("dashboard.heading.workspacesYouOwn")}>
        {owned.length === 0 ? (
          <Text className="p-4 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("dashboard.description.youDonTOwnAnyWorkspacesYet")}</Text>
        ) : owned.map((ws, i) => {
          const color = WS_SEGMENT_COLORS[i % WS_SEGMENT_COLORS.length];
          return (
            <Pressable
              key={ws.id}
              onPress={() => onOpen(ws.id)}
              accessibilityRole="button"
              className={"flex-row items-center gap-3 px-4 py-3" + (i < owned.length - 1 ? " border-b border-border" : "")}
            >
              <Avatar imageUrl={ws.icon_image_url ? workspaceIconUrl(ws.id) : null} initials={ws.icon_initials ?? "WS"} color={ws.icon_color ?? FALLBACK_COLOR} size={32} />
              <View className="min-w-0 flex-1">
                <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>{ws.name}</Text>
                <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("common.label.usedlabelUsed", { usedLabel: formatBytes(ws.used_bytes) })}</Text>
                <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <View className="h-full rounded-full" style={{ width: `${Math.max(Math.min(ws.share_pct, 100), 2)}%`, backgroundColor: color }} />
                </View>
              </View>
              <Text className="text-xs text-foreground" style={{ fontFamily: fonts.bold }}>{ws.share_pct}%</Text>
            </Pressable>
          );
        })}
      </Section>

      {/* Shared with you */}
      {shared.length > 0 && (
        <Section title={t("dashboard.heading.sharedWithYou")}>
          <Text className="px-4 pt-3 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("workspaces.description.theseUseTheOwnerSStorageNotYours")}</Text>
          {shared.map((ws, i) => (
            <Pressable
              key={ws.id}
              onPress={() => onOpen(ws.id)}
              accessibilityRole="button"
              className={"flex-row items-center gap-3 px-4 py-3" + (i < shared.length - 1 ? " border-b border-border" : "")}
            >
              <Avatar imageUrl={ws.icon_image_url ? workspaceIconUrl(ws.id) : null} initials={ws.icon_initials ?? "WS"} color={ws.icon_color ?? FALLBACK_COLOR} size={32} />
              <View className="min-w-0 flex-1">
                <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>{ws.name}</Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>{ws.owner_name}</Text>
              </View>
              <Badge label={roleLabel(ws.role_id)} variant="outline" />
            </Pressable>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}
