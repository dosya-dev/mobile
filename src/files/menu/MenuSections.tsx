import { useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/Avatar";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { getGroups } from "@/groups/api";
import { useWorkspaces } from "../hooks";
import { getFavourites } from "../api";
import { useWorkspaceStore } from "../workspaceStore";
import { roleLabel } from "../workspace-format";
import { FILES_VIEWS, useFilesView } from "../filesViewStore";
import { WorkspacePickerSheet, workspaceIconProps } from "../WorkspacePickerSheet";
import type { FileItem } from "../types";
import type { MessageKey } from "@/i18n/keys";
import { useFilesMenu } from "./menuStore";
import { MenuEnter, MenuRow, MenuSectionTitle } from "./MenuRow";

/** Favourites shown in the menu before "See all". */
export const MENU_FAVOURITES_MAX = 8;

/** Every pick closes the menu first, then does its thing (usually a push). */
function usePick() {
  const closeMenu = useFilesMenu((s) => s.closeMenu);
  return (then: () => void) => {
    closeMenu();
    then();
  };
}

/** The active workspace, with the same first-workspace fallback as the header. */
export function useMenuWorkspace() {
  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const active = workspaces.data?.find((w) => w.id === activeId) ?? null;
  return { activeId, active };
}

/** Workspace card: tap for the workspace list, gear for workspace settings. */
export function WorkspaceCard({ index }: { index: number }) {
  const t = useT();
  const router = useRouter();
  const pick = usePick();
  const { tokens } = useColorTheme();
  const { active } = useMenuWorkspace();
  const [picking, setPicking] = useState(false);
  return (
    <MenuEnter index={index}>
      <View className="mx-3 mb-2 flex-row items-center gap-2 rounded-xl bg-card p-2.5">
        <Pressable
          testID="files-menu-workspace"
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          className="min-w-0 flex-1 flex-row items-center gap-2.5"
        >
          {active ? (
            <Avatar {...workspaceIconProps(active)} size={36} radius={8} />
          ) : (
            <View className="h-9 w-9 rounded-lg bg-muted" />
          )}
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
              {active?.name ?? t("common.status.loading")}
            </Text>
            {active ? (
              <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
                {roleLabel(active.role_id)}
              </Text>
            ) : null}
          </View>
          <Icon name="chevron-down" size={16} color={tokens.mutedForeground} />
        </Pressable>
        <Pressable
          testID="files-menu-workspace-settings"
          accessibilityRole="button"
          accessibilityLabel={t("common.label.workspaceSettings")}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-lg"
          onPress={() => pick(() => router.push("/workspace-settings"))}
        >
          <Icon name="settings-outline" size={20} color={tokens.mutedForeground} />
        </Pressable>
      </View>
      {/* Switching keeps the current Files view and leaves the menu open on the new workspace. */}
      <WorkspacePickerSheet visible={picking} onClose={() => setPicking(false)} />
    </MenuEnter>
  );
}

/**
 * All, Documents, Videos, Images, Personas, Hidden. Personas is a destination,
 * not a view: it sits in the web sidebar's place (before Hidden), pushes its
 * screen and is never the highlighted row.
 */
export function ViewRows({ index, personas }: { index: number; personas: boolean }) {
  const t = useT();
  const router = useRouter();
  const pick = usePick();
  const view = useFilesView((s) => s.view);
  const setView = useFilesView((s) => s.setView);
  const rows: ReactElement[] = [];
  for (const v of FILES_VIEWS) {
    if (v.key === "hidden" && personas) {
      rows.push(
        <MenuRow
          key="personas"
          testID="files-menu-personas"
          index={index + rows.length}
          icon="people-outline"
          label={t("common.label.personas")}
          onPress={() => pick(() => router.push("/personas"))}
        />,
      );
    }
    rows.push(
      <MenuRow
        key={v.key}
        testID={`files-menu-view-${v.key}`}
        index={index + rows.length}
        icon={v.icon}
        label={t(v.label)}
        selected={view === v.key}
        onPress={() => pick(() => setView(v.key))}
      />,
    );
  }
  return <>{rows}</>;
}

const PLACES: readonly { id: string; route: "/shares" | "/trash" | "/file-requests" | "/map" | "/offline"; icon: IconName; label: MessageKey }[] = [
  { id: "shared", route: "/shares", icon: "share-social-outline", label: "files.label.shared" },
  { id: "deleted", route: "/trash", icon: "trash-outline", label: "files.label.deleted" },
  { id: "file-requests", route: "/file-requests", icon: "cloud-upload-outline", label: "file-requests.heading.fileRequests" },
  { id: "map", route: "/map", icon: "map-outline", label: "navigation.label.map" },
  // What is kept on this phone, across workspaces; it opens with no connection.
  { id: "offline", route: "/offline", icon: "arrow-down-circle", label: "offline.heading.offline" },
];

/** How many rows PlaceRows renders, for the stagger index of what follows it. */
export const PLACE_COUNT = PLACES.length;

/** Shared, Deleted, File requests, Map, Offline. */
export function PlaceRows({ index }: { index: number }) {
  const t = useT();
  const router = useRouter();
  const pick = usePick();
  return (
    <>
      {PLACES.map((p, n) => (
        <MenuRow
          key={p.id}
          testID={`files-menu-${p.id}`}
          index={index + n}
          icon={p.icon}
          label={t(p.label)}
          onPress={() => pick(() => router.push(p.route))}
        />
      ))}
    </>
  );
}

function fileIcon(f: FileItem): IconName {
  if (f.mime_type?.startsWith("image/")) return "image-outline";
  if (f.mime_type?.startsWith("video/")) return "videocam-outline";
  return "document-outline";
}

/** Up to 8 favourite folders then files, and See all. Hidden when there are none. */
export function FavouritesSection({ index }: { index: number }) {
  const t = useT();
  const router = useRouter();
  const pick = usePick();
  const { tokens } = useColorTheme();
  const { activeId: ws } = useMenuWorkspace();
  // Same key as /favourites, so the two share one cache.
  const q = useQuery({ queryKey: ["favourites", ws], enabled: !!ws, queryFn: () => getFavourites(ws as string) });
  const rows = [
    ...(q.data?.folders ?? []).map((f) => ({ type: "folder" as const, item: f })),
    ...(q.data?.files ?? []).map((f) => ({ type: "file" as const, item: f })),
  ];
  if (rows.length === 0) return null;
  return (
    <View testID="files-menu-favourites">
      <MenuSectionTitle
        index={index}
        label={t("common.label.favourites")}
        action={
          <Pressable testID="files-menu-favourites-all" accessibilityRole="button" hitSlop={8} onPress={() => pick(() => router.push("/favourites"))}>
            <Text className="text-xs" style={{ color: tokens.primary, fontFamily: fonts.medium }}>{t("files.action.seeAll")}</Text>
          </Pressable>
        }
      />
      {rows.slice(0, MENU_FAVOURITES_MAX).map((r, n) => (
        <MenuRow
          key={r.type + ":" + r.item.id}
          testID={`files-menu-favourite-${r.type}-${r.item.id}`}
          index={index + 1 + n}
          icon={r.type === "folder" ? "folder-outline" : fileIcon(r.item)}
          label={r.item.name}
          onPress={() =>
            pick(() =>
              r.type === "folder"
                ? router.push({ pathname: "/folder/[id]", params: { id: r.item.id, name: r.item.name } })
                : router.push(`/file/${r.item.id}`),
            )
          }
        />
      ))}
    </View>
  );
}

/** The workspace's groups, a + to /groups, and "No groups yet". Mobile has no per-group page: rows open /groups. */
export function GroupsSection({ index }: { index: number }) {
  const t = useT();
  const router = useRouter();
  const pick = usePick();
  const { tokens } = useColorTheme();
  // Same key and id as the Groups screen, so the cache is shared.
  const activeId = useWorkspaceStore((s) => s.activeId);
  const { data } = useQuery({ queryKey: ["groups", activeId], queryFn: () => getGroups(activeId as string), enabled: !!activeId });
  return (
    <View testID="files-menu-groups">
      <MenuSectionTitle
        index={index}
        label={t("settings.label.groups")}
        action={
          <Pressable
            testID="files-menu-groups-add"
            accessibilityRole="button"
            accessibilityLabel={t("groups.action.newGroup")}
            hitSlop={8}
            onPress={() => pick(() => router.push("/groups"))}
          >
            <Icon name="add" size={18} color={tokens.mutedForeground} />
          </Pressable>
        }
      />
      {data && data.length === 0 ? (
        <MenuEnter index={index + 1}>
          <Text testID="files-menu-groups-empty" className="px-5 py-2 text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("groups.description.noGroupsYet")}
          </Text>
        </MenuEnter>
      ) : null}
      {(data ?? []).map((g, n) => (
        <MenuRow
          key={g.id}
          testID={`files-menu-group-${g.id}`}
          index={index + 1 + n}
          lead={<View className="mx-[5px] h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />}
          label={g.name}
          onPress={() => pick(() => router.push("/groups"))}
        />
      ))}
    </View>
  );
}
