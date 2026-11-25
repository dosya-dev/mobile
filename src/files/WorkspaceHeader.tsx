import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationBell } from "@/notifications/NotificationBell";
import { DeletionBanner } from "@/account/DeletionBanner";
import { useT } from "@/lib/i18n";

/**
 * The workspace context bar. Shown on every tab (Files, Backup, Settings) so it's always
 * clear which workspace you're acting in - the switcher used to live only on Files, so
 * you could be uploading a backup to a workspace you couldn't see.
 *
 * The gear, search and notification bell sit beside the switcher on every tab, so all three
 * are in the same place everywhere; `right` is for anything page-specific on top of those.
 * The bell lives here rather than being passed in per screen because a notification can
 * arrive at any time - it is not page-specific.
 *
 * The workspace-settings screen reuses this row with `back` and without the gear, which is
 * why it hides the native header: the switcher wants a real flex row to size against, and
 * a native headerTitle gives it neither the width nor the height for two lines of text.
 */
export function WorkspaceHeader({
  right,
  back = false,
  settings = true,
  search = true,
  notifications = true,
}: {
  right?: ReactNode;
  back?: boolean;
  settings?: boolean;
  search?: boolean;
  notifications?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  return (
    <>
    <View className="flex-row items-center gap-3 px-5 pt-4 pb-2">
      {back ? (
        <Pressable
          testID="header-back"
          accessibilityRole="button"
          accessibilityLabel={t("common.action.goBack")}
          hitSlop={8}
          className="shrink-0"
          onPress={() => router.back()}
        >
          <Icon name="chevron-back" size={24} color={tokens.foreground} />
        </Pressable>
      ) : null}
      <WorkspaceSwitcher />
      {settings ? (
        <Pressable
          testID="open-workspace-settings"
          accessibilityRole="button"
          accessibilityLabel={t("common.label.workspaceSettings")}
          hitSlop={8}
          className="shrink-0"
          onPress={() => router.push("/workspace-settings")}
        >
          <Icon name="settings-outline" size={22} color={tokens.mutedForeground} />
        </Pressable>
      ) : null}
      {search ? (
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
      ) : null}
      {notifications ? <NotificationBell /> : null}
      {right ? <View className="shrink-0">{right}</View> : null}
    </View>
    {/* Under the header rather than inside the row: a pending deletion is a
        statement about the account, not another header control. */}
    <DeletionBanner />
    </>
  );
}
