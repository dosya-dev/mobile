// The Personas progress card above the grid. Ported from the desktop's
// components/personas/ProgressCard.tsx (from apps/web/src/components/personas/progress-card.tsx)
// - keep the behaviour and copy in step.
//
// Photos are read on this phone, so the card speaks for this phone: "Read
// {read} of {total} photos on this device" with a bar and Pause / Resume,
// gone once every photo is read. A phone whose WebView cannot run the reader
// says so (the grid still works from the user's other devices), and while
// reading waits (for Wi-Fi, a charger, battery, Low Power Mode or a cooler
// phone) the card says why the count does not move. Otherwise, in "While
// charging" and "Any time", it says reading goes on in the background, and on
// iOS 26+ in "Any time" it offers "Keep reading in background" (the
// continued task, spec 5.3) until that task is starting or running. The rules live in ./progress.ts; this file
// only renders. Everything wraps, so a large font scale grows the card
// instead of clipping.
import { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { supportsContinued } from "../../modules/dosya-personas-background";
import { personasContinuedActive, startPersonasContinued, subscribePersonasContinued } from "./device/background";
import { personasBackgroundStrings } from "./device/background-strings";
import type { HeldReason } from "./device/gate";
import { useReadSettings } from "./device/settings";
import { progressPercent, progressView, type ReadyStatus } from "./progress";

const HELD_KEYS: Record<HeldReason, MessageKey> = {
  wifi: "personas.description.waitingForWiFi",
  charger: "personas.description.waitingForACharger",
  battery: "personas.description.waitingBatteryBelow20",
  lowPower: "personas.description.waitingLowPowerModeIsOn",
  thermal: "personas.description.waitingForThePhoneToCoolDown",
};

export interface ProgressCardProps {
  status: ReadyStatus;
  /** Whether this phone can read photos (engine-host usePersonasDevice); true when not given. */
  supported?: boolean;
  /** What reading on this phone waits for (engine-host usePersonasDevice), null when nothing. */
  heldReason?: HeldReason | null;
  /** Pause (true) or resume (false) reading on this phone. */
  onPause: (paused: boolean) => void;
}

export function PersonasProgressCard({ status, supported = true, heldReason = null, onPause }: ProgressCardProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { mode } = useReadSettings();
  // The continued task is starting or running: no second one.
  const continued = useSyncExternalStore(subscribePersonasContinued, personasContinuedActive, personasContinuedActive);
  const view = progressView(status, supported);
  if (view === "hidden") return null;

  const icon = (
    <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
      <Icon name="people-outline" size={20} color={tokens.primary} />
    </View>
  );

  if (view === "unsupported") {
    return (
      <View className="flex-row items-center gap-3.5 rounded-2xl border border-border bg-card px-5 py-4" testID="personas-progress-unsupported">
        {icon}
        <Text className="min-w-0 flex-1 text-sm text-muted-foreground">{t("personas.description.thisDeviceCantReadPhotos")}</Text>
      </View>
    );
  }

  if (view === "finding") {
    return (
      <View className="flex-row items-center gap-3.5 rounded-2xl border border-border bg-card px-5 py-4" testID="personas-progress-finding">
        {icon}
        <Text className="min-w-0 flex-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("personas.label.findingYourPhotos")}</Text>
        <ActivityIndicator color={tokens.mutedForeground} />
      </View>
    );
  }

  const total = status.total ?? 0;
  const percent = progressPercent(status);
  const line = t("personas.label.readOfTotalPhotosOnThisDevice", { read: status.read, total });
  const background = !status.paused && !heldReason && mode !== "open";
  const canContinue = background && mode === "anytime" && !continued && supportsContinued();
  const keepReading = async () => {
    const s = personasBackgroundStrings({ read: status.read, total });
    const ok = await startPersonasContinued({ title: s.continuedTitle, subtitle: s.continuedSubtitle });
    if (!ok && !personasContinuedActive()) toast(t("personas.error.somethingWentWrongTryAgain"), "error");
  };
  return (
    <View className="gap-3 rounded-2xl border border-border bg-card px-5 py-4" testID="personas-progress-reading">
      <View className="flex-row flex-wrap items-center gap-3.5">
        {icon}
        <Text className="min-w-0 flex-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{line}</Text>
        <Pressable
          testID="personas-pause"
          accessibilityRole="button"
          onPress={() => onPause(!status.paused)}
          className="min-h-[44px] justify-center rounded-lg border border-border px-3"
        >
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
            {status.paused ? t("personas.action.resume") : t("personas.action.pause")}
          </Text>
        </Pressable>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t("personas.label.photosRead")}
        accessibilityValue={{ min: 0, max: total, now: status.read, text: line }}
        className="h-2 w-full overflow-hidden rounded-full bg-border"
        testID="personas-progress-bar"
      >
        <View className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </View>
      {heldReason ? (
        <Text className="text-xs text-muted-foreground" testID="personas-progress-held">{t(HELD_KEYS[heldReason])}</Text>
      ) : null}
      {background ? (
        <Text className="text-xs text-muted-foreground" testID="personas-progress-background">
          {mode === "charging" ? t("personas.description.keepsReadingInTheBackgroundWhileCharging") : t("personas.description.keepsReadingInTheBackground")}
        </Text>
      ) : null}
      {canContinue ? (
        <Pressable
          testID="personas-keep-reading"
          accessibilityRole="button"
          onPress={() => void keepReading()}
          className="min-h-[44px] flex-row items-center justify-center gap-2 self-start rounded-lg border border-border px-3"
        >
          <Icon name="play-circle-outline" size={14} color={tokens.foreground} />
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("personas.action.keepReadingInBackground")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
