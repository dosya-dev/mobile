// /personas/[id]: one persona (src/personas/PersonaScreen) from this phone's
// engine. While Personas is not ready (off, locked, no Vault) the first run
// shows instead, as on /personas. "Personas settings" is in the header.
//
// A workspace switch while it is open goes back: the persona belonged to the
// workspace just left. The exit waits for focus: expo-router's back() acts on
// the FOCUSED navigator, and this screen can sit lower in the stack while the
// user switches workspace from a tab pushed over it ("Show in folder"). An
// unfocused screen therefore only remembers that it has to leave, renders
// nothing, and goes back once it is in front again.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useVault } from "@/vault/store";
import { RecoveryKeyStep } from "@/vault/ui/onboarding/RecoveryKeyStep";
import { usePersonasWorkspace } from "@/personas/hooks";
import { usePersonasEngine } from "@/personas/device/engine-host";
import { FirstRun } from "@/personas/FirstRun";
import { PersonaView } from "@/personas/PersonaScreen";
import { SettingsLink } from "@/personas/SettingsLink";

export default function PersonaScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { wsId } = usePersonasWorkspace();
  const [leaving, setLeaving] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);

  // The workspace this persona belongs to: the active one when the screen
  // first knew it. A later change is a switch, and the screen leaves.
  const [homeWs, setHomeWs] = useState<string | null>(wsId);
  useEffect(() => { if (!homeWs && wsId) setHomeWs(wsId); }, [homeWs, wsId]);
  const switched = !!homeWs && !!wsId && wsId !== homeWs;
  useEffect(() => { if (switched) setLeaving(true); }, [switched]);

  useFocusEffect(useCallback(() => {
    if (!leaving) return;
    if (router.canGoBack()) router.back();
    else router.replace("/personas");
  }, [leaving, router]));

  // A Vault set up from the first run here shows its one-time recovery key first.
  const recoveryKey = useVault((s) => s.recoveryKeyOnce);
  if (recoveryKey) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <RecoveryKeyStep onDone={() => undefined} />
      </>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: !fullScreen,
          title: t("common.label.personas"),
          headerRight: () => <SettingsLink onPress={() => router.push("/personas-settings")} color={tokens.foreground} />,
        }}
      />
      {leaving || switched || !homeWs || !id ? null : <PersonaBody wsId={homeWs} personaId={id} onFullScreen={setFullScreen} />}
    </SafeAreaView>
  );
}

function PersonaBody({ wsId, personaId, onFullScreen }: { wsId: string; personaId: string; onFullScreen: (on: boolean) => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { engine, status, error, refresh } = usePersonasEngine(wsId);
  if (!engine || (!status && !error)) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator accessibilityLabel={t("common.status.loading")} /></View>;
  }
  if (!status) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Icon name="people-outline" size={32} color={tokens.mutedForeground} />
        <Text className="mt-3 text-center text-sm text-muted-foreground">{t("personas.error.couldNotLoadPersonas")}</Text>
        <View className="mt-4">
          <Button title={t("common.action.tryAgain")} variant="ghost" testID="persona-retry" onPress={refresh} />
        </View>
      </View>
    );
  }
  if (status.state !== "ready") return <FirstRun wsId={wsId} state={status.state} engine={engine} onFullScreen={onFullScreen} />;
  return <PersonaView key={`${wsId}:${personaId}`} wsId={wsId} personaId={personaId} engine={engine} status={status} />;
}
