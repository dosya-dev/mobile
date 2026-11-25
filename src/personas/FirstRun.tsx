// The Personas first run. Ported from the desktop's
// components/personas/FirstRun.tsx (from apps/web/src/pages/personas/first-run.tsx)
// - keep the behaviour and copy in step.
//
// One screen for each engine state that is not ready yet:
//
// - off: what Personas does on this device, that the desktop app reads
//   faster, and "Start reading on this device" (engine.turnOn). Free on every
//   plan; nobody else has to agree.
// - needs_identity: the same text, the Vault line and "Set up Vault", which
//   opens the Vault's own passphrase step. The new Vault identity seals the
//   user's personas key.
// - needs_unlock: the unlock line and the Vault's unlock card (passphrase or
//   recovery key). When the Vault is already unlocked there is nothing to
//   type and Personas opens at once.
//
// After a Vault setup or unlock, unlockPersonas(wsId) hands the identity to
// the engine, which opens (or creates) the personas key and keeps it on this
// phone; the screen then moves on through the engine's status. The recovery
// key a setup shows is the Personas screen's (app/personas/index.tsx), so it
// stays up after the engine is ready.
import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ExpoImage } from "expo-image";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/auth/authStore";
import { useVault } from "@/vault/store";
import { UnlockCard } from "@/vault/ui/UnlockCard";
import { PassphraseStep } from "@/vault/ui/onboarding/PassphraseStep";
import { openPersonasPrivacy } from "./api";
import { unlockPersonas } from "./device/engine-host";

// Five sample people, the same Open Peeps drawings (CC0) as dosya.dev/personas/: decoration only.
const FACES = [
  { src: require("../../assets/personas/sam.svg"), size: 40, bg: "#e0f2fe" },
  { src: require("../../assets/personas/taylor.svg"), size: 48, bg: "#ffe4e6" },
  { src: require("../../assets/personas/alex.svg"), size: 60, bg: "#d1fae5" },
  { src: require("../../assets/personas/jordan.svg"), size: 48, bg: "#fef3c7" },
  { src: require("../../assets/personas/morgan.svg"), size: 40, bg: "#ede9fe" },
];

export type FirstRunState = "off" | "needs_identity" | "needs_unlock";

export interface FirstRunProps {
  wsId: string;
  state: FirstRunState;
  engine: Pick<PersonasEngine, "turnOn">;
  /** The Vault's passphrase step is a full screen of its own: the route hides its header meanwhile. */
  onFullScreen?: (on: boolean) => void;
}

export function FirstRun({ wsId, state, engine, onFullScreen }: FirstRunProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [settingUp, setSettingUp] = useState(false);
  const fullScreen = state === "needs_identity" && settingUp;
  useEffect(() => {
    onFullScreen?.(fullScreen);
    return () => onFullScreen?.(false);
  }, [fullScreen, onFullScreen]);
  if (fullScreen) {
    return (
      <>
        <PassphraseStep onBack={() => setSettingUp(false)} />
        <VaultHandOver wsId={wsId} quiet />
      </>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 20 }} keyboardShouldPersistTaps="handled" testID="personas-first-run">
      <View className="items-center gap-4">
        <View className="flex-row items-center ps-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {FACES.map((f, i) => (
            <View
              key={i}
              className="-ms-3 overflow-hidden rounded-full"
              style={{ width: f.size, height: f.size, backgroundColor: f.bg, borderWidth: 3, borderColor: tokens.background }}
            >
              <ExpoImage source={f.src} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            </View>
          ))}
        </View>
        <Text className="text-center text-2xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
          {t("personas.heading.findPeopleInYourPhotos")}
        </Text>
        {state !== "needs_unlock" ? (
          <>
            <Text className="text-center text-base text-muted-foreground">{t("personas.description.personasReadsFacesOnThisDevice")}</Text>
            <Text className="text-center text-sm text-muted-foreground">{t("personas.description.readingIsFasterOnTheDesktopApp")}</Text>
          </>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => void openPersonasPrivacy()}
          className="min-h-[44px] justify-center"
          testID="personas-privacy-link"
        >
          <Text className="text-sm text-primary" style={{ fontFamily: fonts.medium }}>{t("personas.action.howPersonasProtectsYourPrivacy")}</Text>
        </Pressable>
      </View>

      {state === "off" ? <StartReading engine={engine} /> : null}
      {state === "needs_identity" ? (
        <View className="gap-4">
          <Text className="text-center text-sm text-muted-foreground">{t("personas.description.personasUsesYourVaultPassphrase")}</Text>
          <Button title={t("vault.action.setUpVault")} testID="personas-setup-vault" onPress={() => setSettingUp(true)} />
          <VaultHandOver wsId={wsId} />
        </View>
      ) : null}
      {state === "needs_unlock" ? (
        <View className="gap-4">
          <Text className="text-center text-sm text-muted-foreground">{t("personas.description.unlockWithYourVaultPassphrase")}</Text>
          <VaultHandOver wsId={wsId} unlockCard />
        </View>
      ) : null}
    </ScrollView>
  );
}

function StartReading({ engine }: { engine: Pick<PersonasEngine, "turnOn"> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await engine.turnOn();
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  return (
    <View className="gap-3">
      <Button title={t("personas.action.startReadingOnThisDevice")} testID="personas-start" loading={busy} onPress={() => void start()} />
      {failed ? (
        <Text className="text-center text-sm text-destructive" accessibilityLiveRegion="polite" testID="personas-start-failed">{t("personas.error.somethingWentWrongTryAgain")}</Text>
      ) : null}
    </View>
  );
}

/**
 * The hand-over to Personas: as soon as the Vault is unlocked on this phone
 * (just now, or already), unlockPersonas runs once. A failure says so with
 * Try again; the Vault stays unlocked. `unlockCard` shows the Vault's unlock
 * card while it is locked; `quiet` renders nothing (under the setup step).
 */
function VaultHandOver({ wsId, unlockCard = false, quiet = false }: { wsId: string; unlockCard?: boolean; quiet?: boolean }) {
  const t = useT();
  const accountId = useAuthStore((s) => s.user?.id) ?? null;
  const vaultStatus = useVault((s) => s.status);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  // As the Vault screen does: read this account's saved Spaces list first.
  useEffect(() => {
    if (accountId) void useVault.getState().hydrate(accountId);
  }, [accountId]);

  const open = useCallback(async () => {
    setOpening(true);
    setFailed(false);
    try {
      await unlockPersonas(wsId);
    } catch {
      setFailed(true);
    }
    setOpening(false);
  }, [wsId]);

  useEffect(() => {
    if (vaultStatus !== "unlocked" || started.current) return;
    started.current = true;
    void open();
  }, [vaultStatus, open]);

  if (quiet) return null;
  const unlocked = vaultStatus === "unlocked";
  return (
    <View className="gap-3">
      {!unlocked && unlockCard ? <UnlockCard /> : null}
      {unlocked && opening ? (
        <View className="items-center py-4"><ActivityIndicator accessibilityLabel={t("common.status.loading")} /></View>
      ) : null}
      {unlocked && failed ? (
        <View className="items-center gap-2">
          <Text className="text-center text-sm text-destructive" accessibilityLiveRegion="polite">{t("personas.error.somethingWentWrongTryAgain")}</Text>
          <Button title={t("common.action.tryAgain")} variant="ghost" testID="personas-open-retry" onPress={() => void open()} />
        </View>
      ) : null}
    </View>
  );
}
