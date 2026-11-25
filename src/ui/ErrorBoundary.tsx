import { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/ui/Text";
import { reportError } from "@/telemetry/sentry";
import { useReportStore } from "@/support/reportStore";
import { useAuthStore } from "@/auth/authStore";
import { t } from "@/lib/i18n";

interface Props { children: ReactNode; onReset?: () => void }
interface State { error: Error | null; eventId: string | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, eventId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, eventId: null };
  }

  // Boundary of last resort. A render error that lands here has already
  // replaced the whole app with the fallback below, so it is exactly the kind
  // of failure that must reach Sentry - the SDK's global handler never sees
  // it, because React caught it first.
  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ eventId: reportError(error, { componentStack: info.componentStack ?? undefined }) });
  }

  private handleReset = (): void => {
    this.setState({ error: null, eventId: null });
    this.props.onReset?.();
  };

  private handleReport = (): void => {
    // Park it, then reset: the navigator is below this boundary, so the push
    // happens in PendingReportRedirect once the tree has remounted.
    useReportStore.getState().setPending({ from: null, errorRef: this.state.eventId, errorMessage: this.state.error?.message ?? null });
    this.handleReset();
  };

  render(): ReactNode {
    if (this.state.error) {
      // Signed-out only reachable before login/onboarding finish, where the
      // support ticket endpoint has no account to attach the report to (and
      // the screen below reads the active workspace). Read fresh at render
      // time rather than subscribed: a class component has no hooks, and the
      // boundary's own lifetime is short enough that this one check is fine.
      const signedIn = useAuthStore.getState().status === "signedIn";
      return (
        <View className="flex-1 items-center justify-center bg-background px-6">
          <Text className="mb-2 text-lg font-semibold text-foreground">{t("common.error.somethingWentWrong")}</Text>
          <Text className="mb-6 text-center text-sm text-muted-foreground">
            {t("common.error.theAppHitAnUnexpectedErrorTryAgainYourFilesAndBackupsAreSafe")}
          </Text>
          <Pressable
            testID="error-retry"
            accessibilityRole="button"
            accessibilityLabel={t("common.action.tryAgain")}
            onPress={this.handleReset}
            className="rounded-lg bg-primary px-6 py-3"
          >
            <Text className="font-semibold text-primary-foreground">{t("common.action.tryAgain")}</Text>
          </Pressable>
          {signedIn ? (
            <Pressable
              testID="error-report"
              accessibilityRole="button"
              accessibilityLabel={t("common.action.reportThisProblem")}
              onPress={this.handleReport}
              className="mt-3 rounded-lg border border-border px-6 py-3"
            >
              <Text className="font-semibold text-foreground">{t("common.action.reportThisProblem")}</Text>
            </Pressable>
          ) : null}
        </View>
      );
    }
    return this.props.children;
  }
}
