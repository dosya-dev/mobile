import { FlatList } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces } from "@/files/hooks";
import { getFavourites } from "@/files/api";
import { FileRow } from "@/files/FileRow";
import { FolderRow } from "@/files/FolderRow";
import { useT } from "@/lib/i18n";

export default function FavouritesScreen() {
  const t = useT();
  const router = useRouter();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const q = useQuery({ queryKey: ["favourites", ws], enabled: !!ws, queryFn: () => getFavourites(ws as string) });
  const rows = [
    ...(q.data?.folders ?? []).map((f) => ({ type: "folder" as const, item: f })),
    ...(q.data?.files ?? []).map((f) => ({ type: "file" as const, item: f })),
  ];
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("favourites.heading.favourites") }} />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.type + ":" + r.item.id}
        renderItem={({ item }) => item.type === "folder"
          ? <FolderRow folder={item.item} onPress={() => router.push(`/folder/${item.item.id}`)} />
          : <FileRow file={item.item} onPress={() => router.push(`/file/${item.item.id}`)} />}
        ListEmptyComponent={<Text className="text-center text-muted-foreground mt-8">{t("favourites.empty.noFavouritesYet")}</Text>}
      />
    </SafeAreaView>
  );
}
