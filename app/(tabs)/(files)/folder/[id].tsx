import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { FileBrowser } from "@/files/FileBrowser";
import { useT } from "@/lib/i18n";

/**
 * No safe-area edges here on purpose. This screen lives inside the Files tab,
 * so the native stack header covers the top inset and @react-navigation's
 * BottomTabBar already pads itself by insets.bottom. Consuming either one here
 * applies it twice - and because the screen sits above the bar, its copy of the
 * bottom inset renders as an empty band between the file list and the tab bar.
 *
 * It was a SafeAreaView with edges={["bottom"]} while it lived on the ROOT
 * stack, where that was correct because nothing sat underneath it. See the
 * regression test beside this file.
 */
export default function FolderScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          title: name ?? t("files.heading.folder"),
          // Same search as the tabs: /api/search only takes a workspace and a query, so
          // this looks across the whole workspace rather than inside this folder.
          headerRight: () => (
            // A real 40pt square with the glyph centred in it, rather than a bare icon.
            // Ionicons renders as a Text glyph, so the view's bounds carry the font's
            // line-height padding and the glyph doesn't sit at their centre - Android's
            // borderless ripple is drawn from those bounds, so the circle landed off the
            // icon. hitSlop grows the touch area but not the view, so it couldn't fix it.
            <View className="flex-row items-center">
              <Pressable
                testID="folder-share"
                accessibilityRole="button"
                accessibilityLabel={t("common.action.share")}
                onPress={() => router.push({ pathname: "/folder/[id]/share", params: { id } })}
                android_ripple={{ borderless: true, radius: 20 }}
                className="h-10 w-10 items-center justify-center"
              >
                <Icon
                  name="share-outline"
                  size={22}
                  color={tokens.foreground}
                />
              </Pressable>
              <Pressable
                testID="folder-search"
                accessibilityRole="button"
                accessibilityLabel={t("common.tooltip.search")}
                onPress={() => router.push("/search")}
                android_ripple={{ borderless: true, radius: 20 }}
                className="h-10 w-10 items-center justify-center"
              >
                <Icon
                  name="search"
                  size={22}
                  color={tokens.foreground}
                />
              </Pressable>
            </View>
          ),
        }}
      />
      <View className="flex-1"><FileBrowser folderId={id} folderName={name ?? null} /></View>
    </View>
  );
}
