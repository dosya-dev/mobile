import { useState, useEffect } from "react";
import { Modal, View } from "react-native";
import { Text } from "@/ui/Text";
import { TextField } from "./TextField";
import { Button } from "./Button";
import { useT } from "@/lib/i18n";

export function PromptDialog(props: {
  visible: boolean; title: string; initialValue?: string; placeholder?: string; confirmLabel?: string; secure?: boolean;
  /** Optional note under the field, for input the placeholder can't explain on its own. */
  hint?: string;
  onSubmit: (text: string) => void; onCancel: () => void;
  /** iOS: the fade-out has finished (see afterDismiss.ts). */
  onDismiss?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(props.initialValue ?? "");
  useEffect(() => { if (props.visible) setText(props.initialValue ?? ""); }, [props.visible, props.initialValue]);
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel} onDismiss={props.onDismiss}>
      <View className="flex-1 items-center justify-center bg-black/40 px-8">
        <View className="w-full rounded-xl bg-card p-5">
          <Text className="mb-3 text-lg font-semibold text-foreground">{props.title}</Text>
          <TextField value={text} onChangeText={setText} placeholder={props.placeholder} autoCapitalize="sentences" secureTextEntry={props.secure} testID="prompt-input" />
          {props.hint ? (
            <Text className="mt-2 text-xs text-muted-foreground" testID="prompt-hint">{props.hint}</Text>
          ) : null}
          <View className="mt-2 flex-row gap-3">
            <View className="flex-1"><Button title={t("common.cancel")} variant="ghost" onPress={props.onCancel} /></View>
            <View className="flex-1"><Button title={props.confirmLabel ?? t("common.save")} onPress={() => props.onSubmit(text.trim())} testID="submit" /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
