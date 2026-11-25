import { Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";

/**
 * The one-time recovery codes view. Shown right after TOTP enrolment or a
 * regeneration - the server never returns these again, so copy/share matter.
 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  const asText = codes.join("\n");

  return (
    <View className="gap-3" testID="recovery-codes">
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
        {t("security.label.saveYourRecoveryCodes")}
      </Text>
      <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {t("security.description.eachCodeWorksOnceIfYouLoseYourAuthenticatorTheyWonTBeShown")}
      </Text>

      <View className="flex-row flex-wrap rounded-lg bg-muted p-3">
        {codes.map((c) => (
          <Text key={c} className="w-1/2 py-1 text-center text-sm text-foreground" style={{ fontFamily: fonts.mono }}>
            {c}
          </Text>
        ))}
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button
            title={t("profile.action.copyAll")}
            variant="ghost"
            testID="copy-codes"
            onPress={async () => {
              await Clipboard.setStringAsync(asText);
              toast(t("security.status.recoveryCodesCopied"));
            }}
          />
        </View>
        <View className="flex-1">
          <Button
            title={t("common.action.share")}
            variant="ghost"
            testID="share-codes"
            onPress={() => Share.share({ message: asText })}
          />
        </View>
      </View>
      <Button title={t("common.done")} testID="codes-done" onPress={onDone} />
    </View>
  );
}
