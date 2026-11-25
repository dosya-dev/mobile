import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

/**
 * Page wrapper with an optional big title.
 *
 * `header` renders above the title - used for the workspace context bar, which brings its
 * own padding, so the title tightens up to avoid a double gap when one is present.
 *
 * `underNativeHeader` drops the top safe-area inset. A native stack header already sits in
 * the safe area, but SafeAreaProvider still reports the raw device insets to whatever is
 * inside the screen, so without this the status-bar height gets padded in a second time and
 * leaves a visible gap under the header.
 *
 * `aboveTabBar` is the same fix for the bottom edge: tab screens end at the tab bar, which
 * already absorbs the system nav-bar inset below it, so padding the inset here a second
 * time leaves a band of bare background between the content and the bar.
 */
export function Screen({
  title,
  header,
  underNativeHeader,
  aboveTabBar,
  children,
}: {
  title?: string;
  header?: ReactNode;
  underNativeHeader?: boolean;
  aboveTabBar?: boolean;
  children?: ReactNode;
}) {
  const edges: Edge[] = ["left", "right"];
  if (!underNativeHeader) edges.push("top");
  if (!aboveTabBar) edges.push("bottom");
  return (
    <SafeAreaView className="flex-1 bg-background" edges={edges}>
      {header}
      {title ? (
        <View className={"px-5 pb-2 " + (header ? "pt-1" : "pt-4")}>
          <Text className="text-2xl font-bold text-foreground" accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      {/* Title and header both bring their own bottom spacing; content only pads itself when
          it's alone up there. */}
      <View className={"flex-1 px-5" + (title || header ? "" : " pt-4")}>{children}</View>
    </SafeAreaView>
  );
}
