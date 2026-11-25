import { View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { formatNumber } from "@/lib/format-locale";
import { PhotoTile } from "./PhotoTile";

/**
 * The value deck's hero visuals.
 *
 * Each slide leads with product surface rather than an illustration of an idea:
 * a backup actually in progress, the clients and protocols that reach the same
 * files, and where the encryption boundary sits. The figures shown are
 * illustrative - the deck runs before sign-in, so there is no account to read
 * real numbers from.
 */

function Chip({ label, mono = false }: { label: string; mono?: boolean }) {
  return (
    <View className="rounded-full bg-secondary px-3 py-1.5">
      <Text
        className="text-xs text-secondary-foreground"
        style={{ fontFamily: mono ? fonts.mono : fonts.medium }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Slide 1 - a backup mid-flight over the camera roll it is copying. */
export function BackupArt() {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View className="rounded-2xl border border-border bg-card p-3">
      <View className="mb-3 flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
          <Icon name="cloud-upload" size={17} color={tokens.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
            {t("common.status.backingUp")}
          </Text>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.mono }}>
            {t("common.label.sentOfTotal", { sent: formatNumber(1204), total: formatNumber(12885) })}
          </Text>
        </View>
        <Text className="text-xs text-primary" style={{ fontFamily: fonts.mono }}>
          9%
        </Text>
      </View>
      <View className="mb-3 h-1.5 overflow-hidden rounded-full bg-input">
        <View className="h-full rounded-full bg-primary" style={{ width: "9%" }} />
      </View>
      <View className="gap-1">
        {[0, 1].map((row) => (
          <View key={row} className="flex-row gap-1">
            {[0, 1, 2, 3].map((col) => {
              const i = row * 4 + col;
              return <PhotoTile key={i} scene={i} done={i < 5} dimmed={i >= 5} />;
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Slide 2 - the same files, reached from everything. */
export function ReachArt() {
  const t = useT();
  return (
    <View className="rounded-2xl border border-border bg-card p-4">
      <View className="mb-3.5 flex-row gap-1">
        {[2, 6, 1, 4].map((s) => (
          <PhotoTile key={s} scene={s} />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-1.5">
        {[t("common.label.web"), "macOS", "Windows", "Linux", "iOS", "Android"].map((c) => (
          <Chip key={c} label={c} />
        ))}
      </View>
      <View className="my-3.5 h-px bg-border" />
      <View className="flex-row flex-wrap gap-1.5">
        {["S3", "WebDAV", "SFTP", "rclone", "CLI"].map((p) => (
          <Chip key={p} label={p} mono />
        ))}
      </View>
    </View>
  );
}

/** Slide 3 - where the encryption boundary actually sits. */
export function VaultArt() {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View className="rounded-2xl border border-border bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <Icon name="phone-portrait-outline" size={19} color={tokens.primary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
            {t("welcome.label.onYourPhone")}
          </Text>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
            {t("welcome.label.readableThenEncrypted")}
          </Text>
        </View>
      </View>

      <View className="my-3 flex-row items-center gap-2.5 ps-[18px]">
        <View className="h-6 w-0.5 rounded-full bg-border" />
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.mono }}>
          XChaCha20-Poly1305
        </Text>
      </View>

      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-secondary">
          <Icon name="server-outline" size={19} color={tokens.foreground} />
        </View>
        <View className="flex-1">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
            {t("welcome.label.onTheServer")}
          </Text>
          <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.mono }}>
            {t("welcome.label.ciphertextPublicKeys")}
          </Text>
        </View>
      </View>
    </View>
  );
}
