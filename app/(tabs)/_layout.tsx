import { Tabs } from "expo-router";
import { Icon } from "@/ui/Icon";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useColorTheme } from "@/theme/useColorTheme";
import { BackupTabIcon } from "@/backup/ui/BackupTabIcon";
import { VaultTabIcon } from "@/vault/ui/VaultTabIcon";
import { OrbitTabBar } from "@/orbit/OrbitTabBar";
import { shouldHideTabBar } from "@/viewer/tabBarVisibility";
import { useT } from "@/lib/i18n";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { layoutIsRtl } from "@/lib/direction";
import { FilesMenu } from "@/files/menu/FilesMenu";
import { FilesMenuProgressContext, SHIFT } from "@/files/menu/menuMotion";

export default function TabsLayout() {
  const { tokens } = useColorTheme();
  const t = useT();
  // The Files left menu sits above the whole navigator, tab bar included, and
  // the navigator moves 18 pt away from it as it opens (not with Reduce Motion).
  const menuProgress = useSharedValue(0);
  const reduced = useReducedMotion();
  const shift = layoutIsRtl() ? -SHIFT : SHIFT;
  const shiftStyle = useAnimatedStyle(() => ({
    // rtl-ok: mirrored (shift is negated in RTL above)
    transform: [{ translateX: reduced ? 0 : menuProgress.value * shift }],
  }));
  return (
    <FilesMenuProgressContext.Provider value={menuProgress}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[{ flex: 1 }, shiftStyle]}>
          <Tabs
            // The bar is a floating pill with the orbit button beside it, so the
            // stock bar is replaced outright rather than styled. `tabBarStyle` is
            // still the channel for hiding it - OrbitTabBar reads the focused
            // screen's `display` back off the descriptor.
            tabBar={(props) => <OrbitTabBar {...props} />}
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: tokens.primary,
              tabBarInactiveTintColor: tokens.mutedForeground,
            }}
          >
            {/* The Files tab is a GROUP, not a single screen: it owns a nested stack
                (see (files)/_layout.tsx) so folders and files render inside the tab
                and the bar below stays put while you browse.

                The one exception is the file viewer, which is full-bleed: its sheet
                anchors to the bottom edge and tapping the stage is meant to leave
                nothing but the file. The parent navigator owns the bar, so hiding it
                has to happen here, keyed off whichever child route is focused. */}
            <Tabs.Screen
              name="(files)"
              options={({ route }) => ({
                title: t("common.label.files"),
                tabBarIcon: ({ color, size }) => <Icon name="folder" color={color} size={size} />,
                tabBarStyle: shouldHideTabBar(getFocusedRouteNameFromRoute(route)) ? { display: "none" } : undefined,
              })}
            />
            {/* The Vault is a destination, not a folder you find inside Files, so it
                owns a tab and a stack of its own (vault/_layout.tsx). Its icon is a
                padlock that opens once the Vault is unlocked; it reads that from a
                plain flag, never the Vault store, which would put the e2ee bundle on
                the boot path. */}
            <Tabs.Screen
              name="vault"
              options={{ title: "Vault", tabBarIcon: ({ color, size }) => <VaultTabIcon color={color} size={size} /> }}
            />
            <Tabs.Screen
              name="backup"
              options={{ title: t("common.label.backup"), tabBarIcon: ({ color, size }) => <BackupTabIcon color={color} size={size} /> }}
            />
            <Tabs.Screen
              name="settings"
              options={{ title: t("common.label.settings"), tabBarIcon: ({ color, size }) => <Icon name="settings" color={color} size={size} /> }}
            />
          </Tabs>
        </Animated.View>
        <FilesMenu />
      </View>
    </FilesMenuProgressContext.Provider>
  );
}
