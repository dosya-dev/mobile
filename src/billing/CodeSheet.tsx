import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Pressable, View } from "react-native";
import { useT } from "@/lib/i18n";
import { Button } from "@/ui/Button";
import { SheetHandle } from "@/ui/SheetHandle";
import { TextField } from "@/ui/TextField";
import { Text } from "@/ui/Text";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { checkForPlanChange } from "./purchaseFlow";
import { redeem, type RedeemResult } from "./redeem";
import { presentCodeRedemption } from "./revenuecat";

/** What to do when the user comes back from a store hand-off. */
type OnReturn = "restore" | "check_plan" | null;

/**
 * "Have a code?". Presentation plus the two hand-offs to a store: the App
 * Store's redeem sheet (iOS) and the Play redeem link (Android). Coming back
 * from Play runs the screen's restore flow (onRestore). Coming back from the
 * App Store sheet only asks the server whether the plan moved: restoring while
 * Apple's sheet is still up would stack a second store prompt on it, and the
 * sheet resolves the same way whether a code was redeemed or cancelled.
 */
export function CodeSheet(props: {
  visible: boolean;
  storeName: string;
  /** The account's plan before the hand-off, to tell whether a redemption changed it. */
  currentPlanId: string;
  onClose: () => void;
  /** Restore purchases and show the activation sheet. */
  onRestore: () => void;
  /** Start the normal purchase of the selected package (Android play_sheet mode). */
  onPurchase: () => void;
  /** An App Store redemption changed the plan; show it as active. */
  onPlanChanged: (planName: string) => void;
}) {
  const t = useT();
  const pad = useSheetBottomPad();
  const after = useAfterDismiss();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const onReturn = useRef<OnReturn>(null);
  const latest = useRef(props);
  latest.current = props;

  // One-shot, on the next return to the foreground after a store hand-off.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || !onReturn.current) return;
      const action = onReturn.current;
      onReturn.current = null;
      if (action === "restore") {
        latest.current.onRestore();
        return;
      }
      void checkForPlanChange(latest.current.currentPlanId)
        .then((change) => {
          if (change.outcome === "changed") latest.current.onPlanChanged(change.planName);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!props.visible) {
      setCode("");
      setResult(null);
    }
  }, [props.visible]);

  const submit = async () => {
    if (!code.trim() || checking) return;
    setChecking(true);
    setResult(null);
    try {
      setResult(await redeem(code));
    } finally {
      setChecking(false);
    }
  };

  const continueIos = () => {
    props.onClose();
    // The App Store sheet cannot be presented over this one while it slides away.
    after.queue(() => {
      // Armed before presenting: Apple's sheet takes the app out of "active"
      // and closing it brings it back, whatever the user did there.
      onReturn.current = "check_plan";
      void presentCodeRedemption().catch(() => {
        onReturn.current = null;
      });
    });
  };

  const openPlay = (url: string) => {
    props.onClose();
    if (!url) {
      after.queue(props.onPurchase);
      return;
    }
    onReturn.current = "restore";
    void Linking.openURL(url).catch(() => {
      onReturn.current = null;
    });
  };

  const terms = (r: RedeemResult) =>
    (r.kind === "ios_sheet" || r.kind === "android_link") && r.terms ? (
      <Text testID="code-terms" className="mb-2 text-center text-sm text-foreground">
        {t("upgrade.label.storeTerms", { store: props.storeName, terms: r.terms })}
      </Text>
    ) : null;

  let outcome = null;
  if (result?.kind === "invalid") {
    outcome = <Text testID="code-error" className="mb-3 text-center text-sm text-destructive">{result.message}</Text>;
  } else if (result?.kind === "web_only") {
    outcome = <Text className="mb-3 text-center text-sm text-foreground">{t("upgrade.label.webOnly")}</Text>;
  } else if (result?.kind === "web_ios_only") {
    outcome = <Text className="mb-3 text-center text-sm text-foreground">{t("upgrade.label.webIosOnly")}</Text>;
  } else if (result?.kind === "ios_sheet") {
    outcome = (
      <>
        {terms(result)}
        <Text className="mb-3 text-center text-sm text-muted-foreground">{t("upgrade.label.copiedPaste")}</Text>
        <Button testID="code-continue" title={t("upgrade.action.continue")} onPress={continueIos} />
      </>
    );
  } else if (result?.kind === "android_link") {
    const { url } = result;
    outcome = (
      <>
        {terms(result)}
        <Button testID="code-open" title={t("upgrade.action.continue")} onPress={() => openPlay(url)} />
      </>
    );
  }

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose} onDismiss={after.onDismiss}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="absolute inset-0" onPress={props.onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View testID="code-sheet" className="rounded-t-2xl bg-card" style={{ paddingBottom: pad }}>
          <SheetHandle onDismiss={props.onClose} />
          <View className="px-5 pt-4">
            <Text className="mb-3 text-center text-lg text-foreground">{t("upgrade.heading.haveACode")}</Text>
            <TextField
              testID="code-input"
              value={code}
              onChangeText={setCode}
              placeholder={t("upgrade.placeholder.code")}
              autoCapitalize="characters"
              mono
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
            {outcome}
            <View className="gap-2">
              <Button testID="code-submit" title={t("common.continue")} loading={checking} disabled={!code.trim()} onPress={() => void submit()} />
              <Button testID="code-close" variant="ghost" title={t("common.close")} onPress={props.onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
