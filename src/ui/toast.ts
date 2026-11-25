import { Alert } from "react-native";
import { t } from "@/lib/i18n";

export function toast(message: string, kind: "success" | "error" = "success"): void {
  // Minimal, dependency-free. A nicer inline toast can replace this later.
  Alert.alert(kind === "error" ? t("report-problem.label.diagnosticError") : t("common.done"), message);
}
