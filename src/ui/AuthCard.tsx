import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Full-screen auth layout: vertically-centered, keyboard-aware card over the background. */
export function AuthCard(props: { children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-6 py-8">
            <View className="rounded-lg border border-border bg-card p-6">{props.children}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
