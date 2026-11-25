import { Modal, View } from "react-native";
import { Text } from "@/ui/Text";
import { Button } from "./Button";
import { useT } from "@/lib/i18n";

export function ConfirmDialog(props: {
  visible: boolean; title: string; message?: string; confirmLabel?: string; destructive?: boolean;
  /** For a question where "Cancel" would not say what declining means. */
  cancelLabel?: string;
  onConfirm: () => void; onCancel: () => void;
  /** iOS: the fade-out has finished (see afterDismiss.ts). */
  onDismiss?: () => void;
}) {
  const t = useT();
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel} onDismiss={props.onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 px-8">
        <View className="w-full rounded-xl bg-card p-5">
          <Text className="text-lg font-semibold text-foreground">{props.title}</Text>
          {props.message ? <Text className="mt-2 text-sm text-muted-foreground">{props.message}</Text> : null}
          <View className="mt-5 flex-row gap-3">
            <View className="flex-1"><Button title={props.cancelLabel ?? t("common.cancel")} variant="ghost" onPress={props.onCancel} /></View>
            <View className="flex-1">
              <Button title={props.confirmLabel ?? t("common.action.confirm")} onPress={props.onConfirm} testID="confirm" />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
