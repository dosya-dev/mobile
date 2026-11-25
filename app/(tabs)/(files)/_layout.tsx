import { Stack } from "expo-router";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";

/**
 * The Files tab's own stack.
 *
 * Browsing into a folder or a file used to push onto the ROOT stack, which
 * covers the tab bar - you lost the bottom navigation the moment you opened
 * anything. Nesting these routes inside the tab keeps the bar mounted while you
 * move around.
 *
 * `(files)` is a route GROUP, so it contributes nothing to the URL: /folder/[id]
 * and /file/[id] are unchanged, and every existing link and deep link still
 * resolves. The immersive reader (/file/[id]/read) deliberately stays on the
 * root stack - it is full-screen by design and a tab bar under it would be a
 * regression.
 *
 * Native stack headers don't see nativewind's CSS vars, so the themed values
 * are passed explicitly here, the same as the root layout does.
 */
export default function FilesLayout() {
  const { tokens } = useColorTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: tokens.card },
        headerTintColor: tokens.primary,
        headerTitleStyle: { color: tokens.foreground, fontFamily: fonts.medium },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: tokens.background },
      }}
    />
  );
}
