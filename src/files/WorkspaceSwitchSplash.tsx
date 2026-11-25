import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Modal, View } from "react-native";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/Avatar";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { workspaceIconUrl } from "./workspace-format";
import type { Workspace } from "./types";
import { useT } from "@/lib/i18n";

/**
 * The switching-workspace splash, matching web's: the workspace's own icon over the app
 * background while the new workspace's data loads underneath, so the swap doesn't read as
 * an abrupt jump. Web holds it for a flat 2s and so does the caller here.
 *
 * Built on RN's Animated rather than reanimated - reanimated is a dependency but is not
 * imported anywhere, and its babel plugin isn't in babel.config.js, so its worklets
 * wouldn't run.
 */
export function WorkspaceSwitchSplash({ workspace }: { workspace: Workspace | null }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    if (!workspace) return;
    fade.setValue(0);
    zoom.setValue(0.75);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(zoom, { toValue: 1, duration: 300, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
    ]).start();
  }, [workspace, fade, zoom]);

  if (!workspace) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent testID="ws-switch-splash">
      <Animated.View className="flex-1 items-center justify-center gap-4 bg-background" style={{ opacity: fade }}>
        <Animated.View style={{ transform: [{ scale: zoom }] }}>
          <Avatar
            testID="ws-switch-avatar"
            imageUrl={workspace.icon_image_url ? workspaceIconUrl(workspace.id) : null}
            initials={workspace.icon_initials ?? "WS"}
            color={workspace.icon_color ?? "#22c55e"}
            size={64}
            radius={16}
          />
        </Animated.View>
        <View className="items-center gap-1.5">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.bold }}>{workspace.name}</Text>
          <View className="flex-row items-center gap-1.5">
            <ActivityIndicator size="small" color={tokens.mutedForeground} />
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("common.status.switchingWorkspace")}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}
