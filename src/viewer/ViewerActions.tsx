import { ActivityIndicator, Pressable, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { DownloadRing } from "@/files/DownloadRing";
import { ringLabel, ringState, type DownloadEntry } from "@/files/downloadModel";
import type { ActionAvailability } from "./viewerModel";

export interface ViewerActionHandlers {
  onDownload: () => void;
  onLink: () => void;
  onStar: () => void;
  onVersions: () => void;
  onMore: () => void;
}

/**
 * The five actions, ranked and always in the same order.
 *
 * Ranked, because the screen this replaces stacked Read, Download & Share,
 * View contacts and Restore contacts as four identical full-width green
 * buttons, which gave a destructive bulk write the same visual weight as a
 * download. Here one contextual action sits above in filled form and
 * everything else is a quiet icon.
 *
 * Unavailable actions are DIMMED, never removed. Unlocking a file must not
 * reflow the row under the thumb that is reaching for it.
 */
export function ViewerActions(props: {
  availability: ActionAvailability;
  starred: boolean;
  starBusy?: boolean;
  /** The live transfer for this file, if there is one. Drives the Download ring. */
  download?: DownloadEntry;
  versionCount?: number;
  handlers: ViewerActionHandlers;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const a = props.availability;
  const dl = ringState(props.download);

  const items: {
    key: keyof ActionAvailability;
    label: string;
    icon: IconName;
    onPress: () => void;
    active?: boolean;
    busy?: boolean;
    badge?: number;
    /** Renders the progress ring in place of the icon, and never disables. */
    ring?: boolean;
  }[] = [
    // Deliberately has no `busy`. A running transfer must not disable this
    // button: it is the only control that can reach a half-gigabyte cellular
    // download, and the old row made it inert for exactly as long as that
    // mattered. The ring reports; the press still works.
    {
      key: "save",
      label: ringLabel(dl),
      icon: "download-outline",
      onPress: props.handlers.onDownload,
      ring: dl !== "idle",
    },
    { key: "link", label: t("files.label.link"), icon: "link-outline", onPress: props.handlers.onLink },
    {
      key: "star",
      label: props.starred ? t("files.label.starred") : t("files.label.star"),
      icon: props.starred ? "star" : "star-outline",
      onPress: props.handlers.onStar,
      active: props.starred,
      busy: props.starBusy,
    },
    {
      key: "versions",
      label: t("common.label.versions"),
      icon: "time-outline",
      onPress: props.handlers.onVersions,
      badge: props.versionCount && props.versionCount > 1 ? props.versionCount : undefined,
    },
    { key: "more", label: t("files.tooltip.more"), icon: "ellipsis-horizontal", onPress: props.handlers.onMore },
  ];

  return (
    <View className="mt-3.5 flex-row" testID="viewer-actions">
      {items.map((item) => {
        const enabled = a[item.key];
        const active = !!item.active && enabled;
        return (
          <Pressable
            key={item.key}
            testID={`viewer-action-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !enabled, selected: active }}
            disabled={!enabled || item.busy}
            onPress={item.onPress}
            className="flex-1 items-center gap-1.5"
          >
            <View
              className={
                "h-[46px] w-[46px] items-center justify-center rounded-full " +
                (active ? "bg-primary" : "bg-secondary") +
                (enabled ? "" : " opacity-40")
              }
            >
              {item.ring ? (
                <DownloadRing entry={props.download} />
              ) : item.busy ? (
                <ActivityIndicator size="small" color={active ? tokens.primaryForeground : tokens.mutedForeground} />
              ) : (
                <Icon
                  name={item.icon}
                  size={20}
                  color={active ? tokens.primaryForeground : enabled ? tokens.foreground : tokens.mutedForeground}
                />
              )}
              {item.badge ? (
                <View
                  testID="viewer-action-versions-badge"
                  className="absolute -end-0.5 -top-0.5 h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-card bg-primary px-1"
                >
                  <Text
                    className="text-[9px] text-primary-foreground"
                    style={{ fontFamily: fonts.mono }}
                  >
                    {item.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              className={
                "text-[10.5px] font-medium " +
                (active || item.ring ? "text-primary" : "text-muted-foreground") +
                (enabled ? "" : " opacity-60")
              }
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
