import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";

function MenuRow(props: {
  testID: string;
  icon: IconName;
  label: string;
  color: string;
  onPress: () => void;
  right?: ReactNode;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3"
    >
      <Icon name={props.icon} size={18} color={props.color} />
      <Text className="flex-1 text-[15px] text-foreground">{props.label}</Text>
      {props.right}
    </Pressable>
  );
}

function CircleButton(props: {
  testID: string;
  icon: IconName;
  label: string;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      onPress={props.onPress}
      className={"h-11 w-11 items-center justify-center rounded-full " + (props.active ? "bg-primary" : "bg-muted")}
    >
      <Icon name={props.icon} size={19} color={props.active ? props.activeColor : props.inactiveColor} />
    </Pressable>
  );
}

/**
 * The four-row card opened from ReaderChrome's menu button: Contents (with
 * reading progress), Search, Themes & Settings, then a row of circular
 * share/bookmark buttons. Search and Themes are independent capability
 * flags - each format hides the rows it can't support rather than showing
 * them disabled. Anchored bottom right above the menu button, over a
 * pressable backdrop that closes it.
 */
export function ReaderMenu(props: {
  visible: boolean;
  percent: number;
  canSearch: boolean;
  canTheme: boolean;
  bookmarked: boolean;
  onClose: () => void;
  onContents: () => void;
  onSearch: () => void;
  onThemes: () => void;
  onShare: () => void;
  onToggleBookmark: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const insets = useSafeAreaInsets();

  if (!props.visible) return null;

  return (
    <>
      <Pressable
        testID="reader-menu-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t("reader.action.closeMenu")}
        onPress={props.onClose}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        className="absolute overflow-hidden rounded-2xl bg-card shadow-lg"
        style={{ end: 16, bottom: insets.bottom + 96, width: 258 }}
      >
        <MenuRow
          testID="menu-contents"
          icon="list-outline"
          label={t("common.tooltip.contents")}
          color={tokens.foreground}
          onPress={props.onContents}
          right={<Text className="ms-auto text-xs text-muted-foreground">{props.percent}%</Text>}
        />
        {props.canSearch ? (
          <MenuRow testID="menu-search" icon="search-outline" label={t("reader.label.search")} color={tokens.foreground} onPress={props.onSearch} />
        ) : null}
        {props.canTheme ? (
          <MenuRow
            testID="menu-themes"
            icon="color-palette-outline"
            label={t("reader.label.themesSettings")}
            color={tokens.foreground}
            onPress={props.onThemes}
          />
        ) : null}
        <View className="flex-row justify-around gap-2 px-4 py-3">
          <CircleButton
            testID="menu-share"
            icon="share-outline"
            label={t("common.action.share")}
            active={false}
            activeColor={tokens.primaryForeground}
            inactiveColor={tokens.foreground}
            onPress={props.onShare}
          />
          <CircleButton
            testID="menu-bookmark"
            icon={props.bookmarked ? "bookmark" : "bookmark-outline"}
            label={t("reader.label.bookmark")}
            active={props.bookmarked}
            activeColor={tokens.primaryForeground}
            inactiveColor={tokens.foreground}
            onPress={props.onToggleBookmark}
          />
        </View>
      </View>
    </>
  );
}
