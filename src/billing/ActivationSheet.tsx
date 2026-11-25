import { useRef, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { useT } from "@/lib/i18n";
import { Button } from "@/ui/Button";
import { SheetHandle } from "@/ui/SheetHandle";
import { Text } from "@/ui/Text";
import { useAfterDismiss } from "@/ui/afterDismiss";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import type { FlowState } from "./purchaseFlow";

type ShownState = Exclude<FlowState, "idle" | "paying" | "cancelled">;
export type SupportRoute = "/support-chat" | "/report-problem";

const isShown = (s: FlowState): s is ShownState => s !== "idle" && s !== "paying" && s !== "cancelled";

/**
 * What happened after Continue or Restore. Presentation only: the screen owns
 * the flow. Support (live chat, report a problem) is offered whatever the
 * account's plan, so a paid-but-not-activated user always has a way to us.
 */
export function ActivationSheet(props: {
  state: FlowState;
  /** The store's message for "failed". */
  detail?: string;
  /** The plan name for "active". */
  planName?: string;
  /** A restore started from the "failed" state is running. */
  restoring?: boolean;
  onClose: () => void;
  onDone: () => void;
  onRestore: () => void;
  onOpen: (route: SupportRoute) => void;
}) {
  const t = useT();
  const pad = useSheetBottomPad();
  const after = useAfterDismiss();
  // Keep drawing the last state while the sheet slides away.
  const last = useRef<{ state: ShownState; detail?: string; planName?: string }>({ state: "confirming" });
  const visible = isShown(props.state);
  if (isShown(props.state)) last.current = { state: props.state, detail: props.detail, planName: props.planName };
  const { state, detail, planName } = last.current;
  const busy = state === "confirming";
  const close = busy ? () => {} : props.onClose;
  // The support screens are pushed onto the stack, which iOS will not show
  // over a sheet that is still on screen. See afterDismiss.ts.
  const open = (route: SupportRoute) => {
    props.onClose();
    after.queue(() => props.onOpen(route));
  };
  const contactUs = <Button testID="activation-contact" variant="ghost" title={t("upgrade.action.contactUs")} onPress={() => open("/support-chat")} />;
  const report = <Button testID="activation-report" variant="ghost" title={t("common.heading.reportAProblem")} onPress={() => open("/report-problem")} />;
  const closeButton = <Button testID="activation-close" variant="ghost" title={t("common.close")} onPress={props.onClose} />;

  let message: string;
  let actions: ReactNode;
  switch (state) {
    case "confirming":
      message = t("upgrade.status.activating");
      actions = null;
      break;
    case "active":
      message = t("upgrade.status.active", { plan: planName ?? "" });
      actions = <Button testID="activation-done" title={t("common.done")} onPress={props.onDone} />;
      break;
    case "pending":
      message = t("upgrade.status.pending");
      actions = closeButton;
      break;
    case "timeout":
      message = t("upgrade.status.timeout");
      actions = <>{contactUs}{report}{closeButton}</>;
      break;
    case "failed":
      message = detail || t("common.error.somethingWentWrongTryAgain");
      actions = (
        <>
          <Button testID="activation-restore" title={t("upgrade.action.restorePurchases")} loading={props.restoring} onPress={props.onRestore} />
          {report}
          {closeButton}
        </>
      );
      break;
    case "other_account":
      message = t("upgrade.status.otherAccount");
      actions = <>{contactUs}{closeButton}</>;
      break;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} onDismiss={after.onDismiss}>
      <View className="flex-1 justify-end bg-black/40">
        {/* A sibling behind the panel, not its parent, so screen readers still reach the buttons. */}
        <Pressable className="absolute inset-0" onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} disabled={busy} />
        <View testID="activation-sheet" className="rounded-t-2xl bg-card" style={{ paddingBottom: pad }}>
          <SheetHandle onDismiss={close} />
          <View className="px-5 pt-4">
            {busy ? <ActivityIndicator className="mb-3" /> : null}
            <Text className="mb-4 text-center text-base text-foreground">{message}</Text>
            <View className="gap-2">{actions}</View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
