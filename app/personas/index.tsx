// /personas for every signed-in member. Ported from the desktop's
// pages/PersonasPage.tsx (from apps/web/src/pages/personas/index.tsx) - keep
// the behaviour in step.
//
// Personas runs on this phone (src/personas/device/engine-host.ts): the
// engine's status picks the screen. off / needs_identity / needs_unlock: the
// first run (src/personas/FirstRun). ready: the progress card (this phone's
// reading) over the grid (src/personas/Grid). The screen re-renders whenever
// the engine reports a change (a read batch, another device's names).
// "Personas settings" is in the header for everyone: the settings are each
// member's own.
//
// A Vault set up from the first run shows its one-time recovery key here,
// before anything else, so it stays up after the engine opens.
//
// The body is keyed by workspace, so a switch while it is open starts it over.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useKeyboardLift } from "@/ui/useKeyboardLift";
import { useT } from "@/lib/i18n";
import { useVault } from "@/vault/store";
import { RecoveryKeyStep } from "@/vault/ui/onboarding/RecoveryKeyStep";
import { usePersonasWorkspace } from "@/personas/hooks";
import { usePersonasDevice, usePersonasEngine } from "@/personas/device/engine-host";
import type { ReadyStatus } from "@/personas/progress";
import { FirstRun } from "@/personas/FirstRun";
import { PersonasGrid } from "@/personas/Grid";
import { PersonasProgressCard } from "@/personas/ProgressCard";
import { progressView } from "@/personas/progress";
import { SettingsLink } from "@/personas/SettingsLink";

export default function PersonasScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const { wsId } = usePersonasWorkspace();
  const recoveryKey = useVault((s) => s.recoveryKeyOnce);
  const [fullScreen, setFullScreen] = useState(false);

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
          headerRight: wsId ? () => <SettingsLink onPress={() => router.push("/personas-settings")} color={tokens.foreground} /> : undefined,
        }}
      />
      {wsId
        ? <WorkspacePersonas key={wsId} wsId={wsId} onFullScreen={setFullScreen} />
        : <Centered><ActivityIndicator /></Centered>}
    </SafeAreaView>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View className="flex-1 items-center justify-center px-8">{children}</View>;
}

function WorkspacePersonas({ wsId, onFullScreen }: { wsId: string; onFullScreen: (on: boolean) => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { engine, status, error, refresh } = usePersonasEngine(wsId);

  if (!engine || (!status && !error)) {
    return <Centered><ActivityIndicator testID="personas-loading" accessibilityLabel={t("common.status.loading")} /></Centered>;
  }
  if (!status) {
    return (
      <Centered>
        <Icon name="people-outline" size={32} color={tokens.mutedForeground} />
        <Text className="mt-3 text-center text-sm text-muted-foreground">{t("personas.error.couldNotLoadPersonas")}</Text>
        <View className="mt-4">
          <Button title={t("common.action.tryAgain")} variant="ghost" testID="personas-retry" onPress={refresh} />
        </View>
      </Centered>
    );
  }
  if (status.state !== "ready") return <FirstRun wsId={wsId} state={status.state} engine={engine} onFullScreen={onFullScreen} />;
  return <PersonasOn engine={engine} status={status} />;
}

/**
 * Personas ready: the progress card over the grid, named first. `status` is
 * a new object after every engine change, so the list is read from the
 * engine again then. Pull down to look for changes from the user's other
 * devices now.
 */
function PersonasOn({ engine, status }: { engine: PersonasEngine; status: ReadyStatus }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { supported, heldReason } = usePersonasDevice();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- status is the engine's change signal
  const personas = useMemo(() => engine.listPersonas(), [engine, status]);
  const reading = supported && !status.paused && (status.total === null || status.read < status.total);
  const [refreshing, setRefreshing] = useState(false);
  const pull = useCallback(async () => {
    setRefreshing(true);
    try { await engine.sync(); } catch { /* the next read or visit tries again */ }
    setRefreshing(false);
  }, [engine]);
  // The unnamed cards' rename field sits low in the list: lift the content
  // above the keyboard so the field and its message stay in view.
  const keyboardLift = useKeyboardLift();

  return (
    <ScrollView
      className="flex-1"
      testID="personas-on"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingBottom: keyboardLift }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} tintColor={tokens.primary} />}
    >
      <View className="px-5 pb-5 pt-4">
        <Text className="text-2xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">{t("common.label.personas")}</Text>
      </View>
      {progressView(status, supported) !== "hidden" ? (
        <View className="px-5 pb-5">
          <PersonasProgressCard status={status} supported={supported} heldReason={heldReason} onPause={(p) => engine.setPaused(p)} />
        </View>
      ) : null}
      {personas.length === 0 && !reading ? (
        <View className="items-center gap-2 px-8 py-10" testID="personas-empty">
          <Icon name="people-outline" size={32} color={tokens.mutedForeground} />
          <Text className="text-center text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("personas.heading.noPeopleYet")}</Text>
        </View>
      ) : null}
      {personas.length > 0 || reading ? <PersonasGrid engine={engine} personas={personas} reading={reading} /> : null}
    </ScrollView>
  );
}
