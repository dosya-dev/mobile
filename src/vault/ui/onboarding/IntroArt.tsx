import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";

/**
 * The pictures above the three intro slides, drawn from views and icons so
 * they follow the theme, the scheme and the layout direction like the rest of
 * the app. They are decoration: the slide's heading and text carry the
 * meaning, so the whole panel is hidden from screen readers.
 */
function Panel(props: { height: number; children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="mx-5 overflow-hidden rounded-[28px] border border-border bg-card"
      style={{ height: props.height }}
    >
      {props.children}
    </View>
  );
}

function FileChip(props: { icon: IconName; rotate: string; style: object }) {
  const { tokens } = useColorTheme();
  return (
    <View
      className="absolute w-[124px] gap-2.5 rounded-2xl border border-border bg-background p-3"
      style={[props.style, { transform: [{ rotate: props.rotate }] }]}
    >
      <View className="h-9 w-9 items-center justify-center rounded-[10px] bg-card">
        <Icon name={props.icon} size={20} color={tokens.mutedForeground} />
      </View>
      <View className="gap-1.5">
        <View className="h-1.5 w-full rounded-full bg-border" />
        <View className="h-1.5 w-3/5 rounded-full bg-border" />
      </View>
    </View>
  );
}

/** Slide 1: the files that belong in a Vault, tucked behind its lock. */
export function PrivateRoomArt(props: { height: number }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <Panel height={props.height}>
      <FileChip icon="images-outline" rotate="-9deg" style={{ start: 30, top: props.height * 0.2 }} />
      <FileChip icon="document-text-outline" rotate="8deg" style={{ end: 26, top: props.height * 0.16 }} />
      <View className="absolute inset-0 items-center justify-center" style={{ paddingTop: props.height * 0.1 }}>
        <View
          className="h-[148px] w-[148px] items-center justify-center rounded-[36px] bg-primary"
          style={{ shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 12 }, elevation: 8 }}
        >
          <View className="absolute inset-2 rounded-[29px] border border-primary-foreground/20" />
          <Icon name="lock-closed-outline" size={56} color={tokens.primaryForeground} />
        </View>
      </View>
      <View className="absolute inset-x-0 bottom-5 items-center">
        <View className="h-8 flex-row items-center gap-1.5 rounded-full border border-border bg-background px-3">
          <Icon name="shield-checkmark-outline" size={14} color={tokens.brandText} />
          <Text className="text-xs" style={{ color: tokens.brandText, fontFamily: fonts.medium }}>{t("vault.label.endToEndEncrypted")}</Text>
        </View>
      </View>
    </Panel>
  );
}

/** Slide 2: a readable file on the phone, scrambled bytes on the server. */
export function EncryptedOnPhoneArt(props: { height: number }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const card = Math.min(196, props.height - 80);
  return (
    <Panel height={props.height}>
      <View className="flex-1 flex-row items-center justify-between px-[18px]">
        <View className="items-center gap-3">
          <View className="w-[108px] gap-2.5 rounded-3xl border border-border bg-background px-3 py-4" style={{ height: card }}>
            <View className="h-1 w-8 self-center rounded-full bg-border" />
            <View className="mt-3 h-10 w-10 items-center justify-center self-center rounded-[10px] bg-card">
              <Icon name="document-text-outline" size={22} color={tokens.mutedForeground} />
            </View>
            <View className="mt-1 gap-1.5">
              <View className="h-1.5 w-full rounded-full bg-border" />
              <View className="h-1.5 w-4/5 rounded-full bg-border" />
              <View className="h-1.5 w-3/5 rounded-full bg-border" />
            </View>
          </View>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.yourPhone")}</Text>
        </View>

        <View className="items-center gap-2 pb-7">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-primary">
            <Icon name="lock-closed" size={18} color={tokens.primaryForeground} />
          </View>
          <Icon name="arrow-forward-outline" size={20} color={tokens.mutedForeground} />
        </View>

        <View className="items-center gap-3">
          <View className="w-[124px] gap-3 rounded-3xl bg-primary px-3.5 py-4" style={{ height: card }}>
            <Icon name="server-outline" size={18} color={tokens.primaryForeground} />
            <Text
              className="text-xs leading-5 text-primary-foreground/70"
              style={{ fontFamily: fonts.mono }}
              // Hex is the same in every language and every direction.
              numberOfLines={5}
            >
              {"8f3a c91e 7b20 d4e6 0a5f 92bc e17d 3b84 c6a0 5e29 f1d7 48ab"}
            </Text>
            <View className="mt-auto flex-row items-center gap-1">
              <Icon name="lock-closed" size={12} color={tokens.brand} />
              <Text className="text-xs text-primary-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.noKeyHere")}</Text>
            </View>
          </View>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.whatDosyaStores")}</Text>
        </View>
      </View>
    </Panel>
  );
}

/** Slide 3: the passphrase stays here, the recovery key is the spare, nobody resets it. */
export function OnlyYouArt(props: { height: number }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <Panel height={props.height}>
      <View className="flex-1 justify-center gap-3.5 px-6">
        <View className="gap-2.5 rounded-[18px] border border-border bg-background px-4 py-3.5">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.yourPassphrase")}</Text>
            <View className="flex-row items-center gap-1">
              <Icon name="phone-portrait-outline" size={12} color={tokens.brandText} />
              <Text className="text-xs" style={{ color: tokens.brandText, fontFamily: fonts.medium }}>{t("vault.label.staysOnThisPhone")}</Text>
            </View>
          </View>
          <View className="h-11 flex-row items-center gap-2.5 rounded-xl bg-card px-3.5">
            <Icon name="key-outline" size={18} color={tokens.foreground} />
            <Text className="text-lg tracking-[3px] text-foreground">{"••••••••••••"}</Text>
          </View>
        </View>

        <View className="flex-row items-center gap-3 rounded-[18px] border border-dashed border-muted-foreground/50 px-4 py-3.5">
          <View className="h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-background">
            <Icon name="key-outline" size={18} color={tokens.foreground} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.recoveryKey")}</Text>
            <Text className="text-xs text-muted-foreground">{t("vault.label.yourSpareKeptByYou")}</Text>
          </View>
        </View>

        <View className="h-8 flex-row items-center gap-1.5 self-center rounded-full bg-background px-3">
          <Icon name="ban-outline" size={14} color={tokens.mutedForeground} />
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{t("vault.label.noResetsNotEvenByDosya")}</Text>
        </View>
      </View>
    </Panel>
  );
}
