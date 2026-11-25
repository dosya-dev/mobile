import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { CreateShareSheet } from "@/share/CreateShareSheet";
import { useT } from "@/lib/i18n";

/**
 * Share a whole folder.
 *
 * This route existed, called the right endpoint, and nothing in the app ever
 * reached it: the folder actions sheet had no Share entry, so folder sharing
 * was dead code on mobile. FileBrowser now routes here, passing the name and
 * item count it already holds - there is no folder-detail endpoint to read
 * them back from, and inventing one for a label would be the wrong trade.
 */
export default function FolderShareScreen() {
  const { id, name, itemCount } = useLocalSearchParams<{ id: string; name?: string; itemCount?: string }>();
  const router = useRouter();
  const t = useT();
  const count = Number(itemCount);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: t("sharing.heading.shareFolder") }} />
      <CreateShareSheet
        visible
        target={{
          kind: "folder",
          id: id ?? "",
          name: name || t("sharing.label.thisFolder"),
          itemCount: Number.isFinite(count) && count > 0 ? count : null,
        }}
        onClose={() => router.back()}
      />
    </View>
  );
}
