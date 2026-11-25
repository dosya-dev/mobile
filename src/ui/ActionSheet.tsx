import { Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon, type IconName } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "./sheetInsets";
import { useAfterDismiss } from "./afterDismiss";

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

export function ActionSheet({ visible, onClose, actions }: { visible: boolean; onClose: () => void; actions: SheetAction[] }) {
  const { tokens } = useColorTheme();
  const sheetPad = useSheetBottomPad();
  // An item may open a native picker or another modal, which iOS will not
  // present over a sheet that is still sliding away. See afterDismiss.ts.
  const after = useAfterDismiss();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={after.onDismiss}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={onClose}>
        <View className="rounded-t-2xl bg-card p-2" style={{ paddingBottom: sheetPad }}>
          <ScrollView className="max-h-96" showsVerticalScrollIndicator={false}>
            {actions.map((a) => (
              <Pressable key={a.label} onPress={() => { onClose(); after.queue(a.onPress); }} className="flex-row items-center gap-3 px-4 py-4">
                {a.icon ? <Icon name={a.icon} size={22} color={a.destructive ? tokens.destructive : tokens.foreground} /> : null}
                <Text className={"text-base " + (a.destructive ? "text-destructive" : "text-foreground")}>{a.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}
