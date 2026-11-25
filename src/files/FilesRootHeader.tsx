import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { NotificationBell } from "@/notifications/NotificationBell";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorkspaces } from "./hooks";
import { FILES_VIEWS, useFilesView } from "./filesViewStore";
import { useFilesMenu } from "./menu/menuStore";
import { workspaceIconProps } from "./WorkspacePickerSheet";
import { Avatar } from "@/ui/Avatar";

/**
 * The header of the Files root: menu button, the workspace logo, the current view as the title with
 * the workspace under it, then search, the browser's view tools (sort, list/grid)
 * and notifications. The workspace switcher
 * and settings gear are not here; they live in the left menu. Inside a folder the
 * screen has its own header. The deletion banner is not here either: the screen
 * hands it to FileBrowser's `banner` slot, outside the selection header swap.
 */
export function FilesRootHeader({ tools }: { tools?: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const view = useFilesView((s) => s.view);
  const openMenu = useFilesMenu((s) => s.openMenu);
  const workspaces = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const workspace = workspaces.data?.find((w) => w.id === activeId) ?? null;
  const workspaceName = workspace?.name ?? "";
  const viewDef = FILES_VIEWS.find((v) => v.key === view) ?? FILES_VIEWS[0];

  return (
    <View className="flex-row items-center gap-3 px-5 pt-4 pb-2">
      <Pressable
        testID="files-menu-open"
        accessibilityRole="button"
        accessibilityLabel={t("navigation.accessibility.menu")}
        hitSlop={8}
        className="shrink-0"
        onPress={openMenu}
      >
        <Icon name="menu" size={24} color={tokens.foreground} />
      </Pressable>
      {workspace ? (
        <View testID="files-workspace-logo" className="shrink-0" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Avatar {...workspaceIconProps(workspace)} size={32} radius={8} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1">
        <Text testID="files-view-title" className="text-lg text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
          {t(viewDef.label)}
        </Text>
        <Text testID="files-workspace-name" className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
          {workspaceName}
        </Text>
      </View>
      <Pressable
        testID="open-search"
        accessibilityRole="button"
        accessibilityLabel={t("common.tooltip.search")}
        hitSlop={8}
        className="shrink-0"
        onPress={() => router.push("/search")}
      >
        <Icon name="search" size={22} color={tokens.foreground} />
      </Pressable>
      {tools ? <View className="shrink-0 flex-row items-center gap-3" testID="files-header-tools">{tools}</View> : null}
      <NotificationBell />
    </View>
  );
}
