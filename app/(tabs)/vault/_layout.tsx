import { Stack } from "expo-router";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";

/**
 * The Vault tab's own stack.
 *
 * The Vault used to live inside the Files tab, which made it a place you
 * reached THROUGH your files. It is its own destination now, so it gets its
 * own stack: opening a Space and then a file pushes here, and the tab bar
 * stays put underneath.
 *
 * `vault` is a real path segment rather than a route group, so every address
 * the app already uses survives the move unchanged - /vault, /vault/file and
 * /vault/space/[id]/[folderId].
 *
 * Native stack headers don't see nativewind's CSS vars, so the themed values
 * are passed explicitly here, the same as the Files stack does.
 */
export default function VaultLayout() {
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
