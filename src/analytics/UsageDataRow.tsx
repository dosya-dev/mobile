import { Switch } from "react-native";
import { SettingsRow } from "@/ui/SettingsRow";
import { useT } from "@/lib/i18n";
import { setAnalyticsConsent, useAnalyticsConsent } from "./analytics";

/** The Settings switch behind the one-time question: on shares usage data, off stops and forgets this install's id. */
export function UsageDataRow() {
  const t = useT();
  const consent = useAnalyticsConsent((s) => s.consent);
  return (
    <SettingsRow
      icon="stats-chart-outline"
      label={t("settings.action.shareUsageData")}
      description={t("settings.description.tellsUsWhichScreensAndFeaturesAreUsed")}
      right={
        <Switch
          testID="usage-data-toggle"
          value={consent === "granted"}
          onValueChange={(on) => { void setAnalyticsConsent(on); }}
        />
      }
    />
  );
}
