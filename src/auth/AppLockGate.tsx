import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View, Pressable, type AppStateStatus } from "react-native";
import { Text } from "@/ui/Text";
import { GateScreen } from "@/ui/GateScreen";
import { useT } from "@/lib/i18n";
import { authenticateBiometric, biometricKind, getBiometricEnabled, isBiometricAvailable } from "./biometric";
import { clearAppLock, getLockAfter, hasPin, onAppLockChange, resetFailedTries, DEFAULT_LOCK_AFTER } from "./appLock";
import { PinCheck, PinSetup } from "./PinScreens";

/**
 * - checking: reading the config at launch
 * - open: app visible
 * - locked: PIN pad (with the Face ID / fingerprint key when that is on)
 * - legacy: biometrics on from before PINs existed, and the scan failed
 * - setPin: that legacy user passed the scan and now sets a PIN
 */
type Phase = "checking" | "open" | "locked" | "legacy" | "setPin";

interface Config {
  pin: boolean;
  bio: "face" | "fingerprint" | null;
  lockAfterMs: number;
}

async function readConfig(): Promise<Config & { bioPref: boolean }> {
  const [pin, bioPref, after] = await Promise.all([hasPin(), getBiometricEnabled(), getLockAfter()]);
  const bio = bioPref && (await isBiometricAvailable()) ? await biometricKind() : null;
  return { pin, bio, bioPref, lockAfterMs: after * 1000 };
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [phase, setPhaseState] = useState<Phase>("checking");
  const [bio, setBio] = useState<Config["bio"]>(null);
  const phaseRef = useRef<Phase>("checking");
  const configRef = useRef<Config>({ pin: false, bio: null, lockAfterMs: DEFAULT_LOCK_AFTER * 1000 });
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  const promptOnReturn = useRef(false);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const promptBiometric = useCallback(async () => {
    if (await authenticateBiometric({ pinFallback: true })) {
      await resetFailedTries();
      setPhase("open");
    }
    // Failed or "Use PIN": stay on the pad.
  }, [setPhase]);

  const lock = useCallback(() => {
    setPhase("locked");
    if (configRef.current.bio) void promptBiometric();
  }, [setPhase, promptBiometric]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const cfg = await readConfig();
      if (!alive) return;
      configRef.current = cfg;
      setBio(cfg.bio);
      if (cfg.pin) {
        // Cold start always locks, whatever the timer says.
        lock();
      } else if (cfg.bio) {
        // Turned on before PINs existed: unlock the old way (the phone's own
        // passcode is still the fallback, there is no PIN yet), then ask for one.
        setPhase((await authenticateBiometric()) ? "setPin" : "legacy");
      } else {
        // No PIN and no usable biometrics (pref off, or on but unenrolled):
        // open. Staying locked would strand the user behind a gate they can
        // never pass.
        setPhase("open");
      }
    })();

    // Settings turns the lock on, off or changes the timer while open.
    const offChange = onAppLockChange(() => {
      void readConfig().then((cfg) => {
        configRef.current = cfg;
        setBio(cfg.bio);
      });
    });

    const sub = AppState.addEventListener("change", (state) => {
      const previous = appStateRef.current;
      appStateRef.current = state;
      if (state === "background") {
        if (phaseRef.current !== "open") return;
        if (configRef.current.pin && configRef.current.lockAfterMs === 0) {
          // Immediately: lock now, so the app switcher's snapshot and the
          // first frame back show the PIN pad, not the files. The scan waits
          // for the return; it cannot run in the background.
          setPhase("locked");
          promptOnReturn.current = true;
        } else {
          backgroundedAt.current = Date.now();
        }
        return;
      }
      // Only a real backgrounding counts. The system Face ID sheet makes the
      // app resign active, so every prompt reports active → inactive → active
      // as it opens and closes; locking on that would re-prompt the instant a
      // scan succeeds, a loop with no way out.
      if (state === "active" && previous === "background") {
        if (promptOnReturn.current) {
          promptOnReturn.current = false;
          if (phaseRef.current === "locked" && configRef.current.bio) void promptBiometric();
          return;
        }
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        const { pin, lockAfterMs } = configRef.current;
        if (!pin || phaseRef.current !== "open" || since === null) return;
        const away = Date.now() - since;
        // Negative = the clock was set back while away; never let that skip the lock.
        if (away < 0 || away >= lockAfterMs) lock();
      }
    });
    return () => {
      alive = false;
      offChange();
      sub.remove();
    };
  }, [lock, setPhase, promptBiometric]);

  // No onRetry: the check is local, and the lock screens below have their own way forward.
  if (phase === "checking") return <GateScreen testID="biometric-gate-checking" />;
  if (phase === "locked") {
    return (
      <PinCheck
        onSuccess={() => setPhase("open")}
        biometric={
          bio
            ? { icon: bio === "face" ? "scan-face" : "finger-print", label: t("security.label.unlockWithBiometrics"), onPress: () => void promptBiometric() }
            : undefined
        }
      />
    );
  }
  if (phase === "setPin") {
    return (
      <PinSetup
        title={t("security.heading.setAPinForAppLock")}
        description={t("security.description.appLockNowUsesAPin")}
        onDone={() => setPhase("open")}
        secondary={{
          label: t("security.action.turnOffAppLock"),
          onPress: () => void clearAppLock().then(() => setPhase("open")),
        }}
      />
    );
  }
  if (phase === "legacy") {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="mb-4 text-lg font-semibold text-foreground">{t("sign-in.heading.locked")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void authenticateBiometric().then((ok) => ok && setPhase("setPin"))}
          className="rounded-lg bg-primary px-6 py-3"
        >
          <Text className="text-primary-foreground font-semibold">{t("common.action.unlock")}</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children}</>;
}
