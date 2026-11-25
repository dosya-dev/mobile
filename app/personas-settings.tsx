// /personas-settings: this member's Personas settings for the active
// workspace, reached from the header of /personas and of a persona's screen.
// Personas is each member's own (it runs on their devices), so these are not
// workspace settings. The body (src/personas/PersonasSettings) is keyed by
// workspace, so a switch while it is open starts it over.
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { useT } from "@/lib/i18n";
import { usePersonasWorkspace } from "@/personas/hooks";
import { PersonasSettings } from "@/personas/PersonasSettings";

export default function PersonasSettingsScreen() {
  const t = useT();
  const { wsId } = usePersonasWorkspace();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("personas.action.personasSettings") }} />
      <View className="flex-1" testID="personas-settings">
        {wsId
          ? <PersonasSettings key={wsId} wsId={wsId} />
          : <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>}
      </View>
    </SafeAreaView>
  );
}
