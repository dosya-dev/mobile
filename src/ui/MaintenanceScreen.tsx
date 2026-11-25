import { useEffect, useRef } from "react";
import { View, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { DosyaLogo } from "@/ui/brand-icons";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { apiRequest } from "@/api";
import { useMaintenanceStore } from "@/ui/maintenanceStore";
import { useT } from "@/lib/i18n";

const STATUS_URL = "https://status.dosya.dev";
const RECHECK_INTERVAL_MS = 60_000;

/**
 * Full-screen gate shown when the mobile platform switch is off. Ports
 * apps/web/src/components/maintenance-screen.tsx and
 * apps/desktop/.../MaintenanceScreen.tsx: same amber tile + "from the team"
 * message + manual/automatic recheck shape, in NativeWind for this app's
 * screens.
 *
 * `onRetry` (a plain /api/me call) both drives the manual "Try again" button
 * and is polled every 60s automatically - a successful response means the
 * server is answering gated requests again, so this clears the store itself
 * (see maintenanceStore.ts) and the root layout swaps back to the real tree.
 * A failed retry (still paused, or offline) leaves the store untouched.
 */
export function MaintenanceScreen() {
  const t = useT();
  const { scheme } = useColorTheme();
  const message = useMaintenanceStore((s) => s.maintenance?.message ?? null);
  // Guards against an interval tick and a manual tap racing each other into
  // two concurrent /api/me calls.
  const checkingRef = useRef(false);

  const check = async (): Promise<void> => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      await apiRequest("/api/me");
      // The surface answered normally - the pause is over.
      useMaintenanceStore.getState().clear();
    } catch {
      // Still paused (or offline) - stay on this screen and let the next
      // interval tick (or another manual tap) try again.
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    const id = setInterval(() => void check(), RECHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const amberIconColor = scheme === "dark" ? "#fcd34d" : "#b45309";

  return (
    <SafeAreaView testID="maintenance-screen" className="flex-1 items-center justify-center bg-background px-6">
      <View className="flex-row items-center gap-2 mb-8" accessibilityLabel="dosya.dev">
        <DosyaLogo size={24} />
        <Text className="text-base text-foreground" style={{ fontFamily: fonts.mono, fontStyle: "italic" }}>
          dosya.dev
        </Text>
      </View>

      <View className="h-14 w-14 rounded-2xl items-center justify-center mb-5 border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
        <Icon name="construct-outline" size={28} color={amberIconColor} />
      </View>

      <Text className="text-2xl text-center text-foreground mb-2" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
        {t("common.heading.pausedForMaintenance")}
      </Text>
      <Text className="text-center text-sm leading-5 text-muted-foreground mb-5" style={{ fontFamily: fonts.regular }}>
        {t("common.description.yourFilesAreSafeBackupWillContinueOnItsOwnOnceWeReBack")}
      </Text>

      {message ? (
        <View className="w-full rounded-xl p-4 mb-6 border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <Text
            className="text-[11px] uppercase tracking-wider mb-1 text-amber-700 dark:text-amber-300"
            style={{ fontFamily: fonts.medium }}
          >
            {t("common.label.fromTheTeam")}
          </Text>
          <Text className="text-sm leading-5 text-foreground" style={{ fontFamily: fonts.regular }}>
            {message}
          </Text>
        </View>
      ) : null}

      <View className="w-full gap-3">
        <Button title={t("common.action.tryAgain")} testID="maintenance-retry" onPress={() => void check()} />
        <Button
          title={t("common.action.statusPage")}
          variant="ghost"
          testID="maintenance-status-page"
          onPress={() => void Linking.openURL(STATUS_URL)}
        />
      </View>

      <Text className="mt-6 text-center text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {t("common.label.checksAgainAutomaticallyEveryMinute")}
      </Text>
    </SafeAreaView>
  );
}
