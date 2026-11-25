import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/Avatar";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaces } from "./hooks";
import { useWorkspaceStore } from "./workspaceStore";
import { WorkspacePickerSheet, workspaceIconProps } from "./WorkspacePickerSheet";
import { roleLabel } from "./workspace-format";
import { usePermissions } from "@/workspace/usePermissions";
import { rtlLine, useT } from "@/lib/i18n";

export function WorkspaceSwitcher() {
  const t = useT();
  const { tokens } = useColorTheme();
  const { rootFolderId, rootFolderName } = usePermissions();
  const [open, setOpen] = useState(false);
  const { data: workspaces, isLoading } = useWorkspaces();
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);

  const active = workspaces?.find((w) => w.id === activeId) ?? workspaces?.[0];

  // The `?? workspaces[0]` fallback above is display-only; without this the resolved
  // default is never persisted, so activeId stays null until the user taps.
  useEffect(() => {
    // Same hydration fence as WorkspaceGate: null during the SecureStore read
    // is "unknown", not "none".
    if (!useWorkspaceStore.getState().hydrated) return;
    if (!activeId && workspaces?.[0]) void setActive(workspaces[0].id);
  }, [activeId, workspaces, setActive]);

  if (!active) {
    return (
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <View className="h-8 w-8 rounded-lg bg-muted" />
        <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {isLoading ? t("common.status.loading") : t("common.label.noWorkspace")}
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* flex-1 + min-w-0 on the trigger itself: the name column inside is flex-1, so
          without a width constraint here the trigger grows to fit the full name and
          pushes whatever sits beside it (the search button) off the row. */}
      <Pressable
        testID="ws-trigger"
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="min-w-0 flex-1 flex-row items-center gap-2.5"
      >
        <Avatar {...workspaceIconProps(active)} size={32} testID="ws-trigger-avatar" />
        <View className="min-w-0 flex-1">
          <Text className="text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
            {active.name}
          </Text>
          {/* A folder-confined member's listings, search and dashboard are all
              scoped to one folder. Naming it here is the difference between
              "limited to Invoices" and "my files are missing". */}
          <Text className="text-xs text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.regular }}>
            {rootFolderId
              ? rtlLine(`${roleLabel(active.role_id)} · ${rootFolderName ?? t("common.label.oneFolder")}`)
              : roleLabel(active.role_id)}
          </Text>
        </View>
        <Icon name="chevron-down" size={18} color={tokens.mutedForeground} />
      </Pressable>

      <WorkspacePickerSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
