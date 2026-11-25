import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useFile } from "@/files/hooks";
import { CreateShareSheet } from "@/share/CreateShareSheet";
import { useT } from "@/lib/i18n";

/**
 * Share one file.
 *
 * The screen itself is now only a route: everything it used to draw by hand -
 * a four-option expiry row, one password switch, one email field - lives in
 * CreateShareSheet, which the folder route renders too. Two hand-maintained
 * copies of the same form is how they drifted apart in the first place.
 */
export default function FileShareScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const file = useFile(id ?? "");

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: t("common.action.share") }} />
      <CreateShareSheet
        visible
        // The sheet opens immediately; the name and size fill in when the file
        // query lands. Waiting for it would put a spinner in front of a form
        // whose controls do not depend on any of it.
        target={{
          kind: "file",
          id: id ?? "",
          name: file.data?.name ?? t("common.label.thisFile"),
          sizeBytes: file.data?.size_bytes ?? null,
          extension: file.data?.extension ?? null,
        }}
        onClose={() => router.back()}
      />
    </View>
  );
}
