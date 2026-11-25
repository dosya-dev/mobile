import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { googleCast } from "./native";
import { useCastStore } from "./castStore";

/** How long to look before saying nothing was found. Discovery usually answers in 1-3 s. */
export const NO_DEVICES_AFTER_MS = 8000;

interface FoundDevice {
  deviceId: string;
  friendlyName: string;
  modelName?: string;
}

/**
 * "Cast to": the TVs on this Wi-Fi, picked from inside the app.
 *
 * Our own list rather than the SDK's Cast dialog, for two reasons. On iOS 14+
 * the SDK's dialog refuses to open from code until the user has tapped a real
 * Cast button once (the local-network prompt rides on that tap), and on
 * Android it needs a Cast button mounted somewhere on screen; the menu row the
 * viewer offers is neither. Discovery runs only while this sheet is open, so
 * iOS asks for local-network access the first time the user looks for a TV,
 * not at launch.
 *
 * On an iPhone the sheet also carries the AirPlay row for a video or audio
 * file: one "Cast" entry in the menu covers both ways onto a TV.
 */
export function CastSheet(props: {
  visible: boolean;
  /** False in a binary without the Cast SDK, or a phone without Play services. */
  chromecast: boolean;
  airPlay: boolean;
  onPickDevice: (deviceId: string) => void;
  onAirPlay: () => void;
  onStop: () => void;
  onControls: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const pad = useSheetBottomPad();
  const after = useAfterDismiss();
  const status = useCastStore((s) => s.status);
  const deviceName = useCastStore((s) => s.deviceName);
  const [devices, setDevices] = useState<FoundDevice[]>([]);
  const [waitedOut, setWaitedOut] = useState(false);

  useEffect(() => {
    const gc = googleCast();
    if (!props.visible || !props.chromecast || !gc) return;
    const discovery = gc.CastContext.discoveryManager;
    setWaitedOut(false);
    void discovery.getDevices().then(setDevices).catch(() => {});
    const sub = discovery.onDevicesUpdated(setDevices);
    void discovery.startDiscovery().catch(() => {});
    const timer = setTimeout(() => setWaitedOut(true), NO_DEVICES_AFTER_MS);
    return () => {
      clearTimeout(timer);
      sub.remove();
      void discovery.stopDiscovery().catch(() => {});
    };
  }, [props.visible, props.chromecast]);

  // Picking runs after the sheet is gone: AirPlay's picker and the TV
  // controls are native screens of their own (see afterDismiss.ts).
  const pick = (action: () => void) => {
    props.onClose();
    after.queue(action);
  };

  const connected = status === "connected";
  const others = connected ? devices.filter((d) => d.friendlyName !== deviceName) : devices;

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose} onDismiss={after.onDismiss}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/50" onPress={props.onClose} testID="cast-scrim" />
        <View className="rounded-t-[22px] bg-card px-2" style={{ paddingBottom: pad }}>
          <View className="items-center py-2.5">
            <View className="h-1 w-9 rounded-full bg-border" />
          </View>
          <Text className="px-3 pb-2 text-base font-bold text-foreground" accessibilityRole="header">
            {connected && deviceName ? t("cast.label.castingToDevice", { device: deviceName }) : t("cast.heading.castTo")}
          </Text>

          <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
            {connected ? (
              <>
                <Row testID="cast-controls" icon="tv-outline" label={t("cast.action.tvControls")} onPress={() => pick(props.onControls)} />
                <Row testID="cast-stop" icon="stop-circle-outline" label={t("cast.action.stopCasting")} destructive onPress={() => pick(props.onStop)} />
                {others.length > 0 || props.airPlay ? <View className="mx-3 my-1 h-px bg-border" /> : null}
              </>
            ) : null}

            {props.airPlay ? (
              <Row testID="cast-airplay" icon="airplay" label={t("cast.action.airPlay")} onPress={() => pick(props.onAirPlay)} />
            ) : null}

            {others.map((d) => (
              <Row
                key={d.deviceId}
                testID={`cast-device-${d.deviceId}`}
                icon="cast"
                label={d.friendlyName}
                detail={d.modelName}
                onPress={() => pick(() => props.onPickDevice(d.deviceId))}
              />
            ))}

            {status === "connecting" ? (
              <View className="flex-row items-center gap-3 px-3 py-3.5">
                <ActivityIndicator color={tokens.mutedForeground} />
                <Text className="text-[15px] text-muted-foreground">{t("cast.status.connecting")}</Text>
              </View>
            ) : props.chromecast && !connected && devices.length === 0 ? (
              waitedOut ? (
                <Text testID="cast-none" className="px-3 py-3.5 text-sm text-muted-foreground">
                  {t("cast.description.noTvsFound")}
                </Text>
              ) : (
                <View className="flex-row items-center gap-3 px-3 py-3.5">
                  <ActivityIndicator color={tokens.mutedForeground} />
                  <Text className="text-[15px] text-muted-foreground">{t("cast.status.lookingForTvs")}</Text>
                </View>
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row(props: { testID: string; icon: IconName; label: string; detail?: string; destructive?: boolean; onPress: () => void }) {
  const { tokens } = useColorTheme();
  return (
    <Pressable testID={props.testID} accessibilityRole="button" onPress={props.onPress} className="flex-row items-center gap-3.5 px-3 py-3.5">
      <Icon name={props.icon} size={20} color={props.destructive ? tokens.destructive : tokens.foreground} />
      <View className="flex-1">
        <Text className={"text-[15px] " + (props.destructive ? "text-destructive" : "text-foreground")} numberOfLines={1}>
          {props.label}
        </Text>
        {props.detail ? <Text className="text-xs text-muted-foreground" numberOfLines={1}>{props.detail}</Text> : null}
      </View>
    </Pressable>
  );
}
