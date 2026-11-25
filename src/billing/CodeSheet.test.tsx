import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { CodeSheet } from "./CodeSheet";
import { redeem } from "./redeem";
import { presentCodeRedemption } from "./revenuecat";
import { checkForPlanChange } from "./purchaseFlow";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// The real hook waits for the Modal slide-out, which never fires under test.
jest.mock("@/ui/afterDismiss", () => ({ useAfterDismiss: () => ({ queue: (a: () => void) => a(), onDismiss: () => {} }) }));
jest.mock("./redeem", () => ({ redeem: jest.fn() }));
jest.mock("./revenuecat", () => ({ presentCodeRedemption: jest.fn(async () => {}) }));
jest.mock("./purchaseFlow", () => ({ checkForPlanChange: jest.fn() }));

const mockRedeem = redeem as jest.Mock;
const onRestore = jest.fn();
const onPurchase = jest.fn();
const onClose = jest.fn();
const onPlanChanged = jest.fn();
const mockCheck = checkForPlanChange as jest.Mock;

/** Capture AppState listeners so a test can bring the app back to the foreground. */
function captureAppState() {
  const listeners: ((s: string) => void)[] = [];
  const AppState = jest.requireActual("react-native").AppState;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => {
    listeners.push(cb);
    return { remove: () => listeners.splice(listeners.indexOf(cb), 1) };
  }) as never);
  return (state: string) => listeners.forEach((l) => l(state));
}

function open(result: unknown) {
  mockRedeem.mockResolvedValue(result);
  render(
    <CodeSheet visible storeName="App Store" currentPlanId="free" onClose={onClose} onRestore={onRestore} onPurchase={onPurchase} onPlanChanged={onPlanChanged} />,
  );
  fireEvent.changeText(screen.getByTestId("code-input"), "HELLO");
  fireEvent.press(screen.getByTestId("code-submit"));
}

beforeEach(() => jest.clearAllMocks());

it("shows the terms sentence and the copied note for an iOS code", async () => {
  open({ kind: "ios_sheet", terms: "1 TB for 3 months" });
  expect(await screen.findByText("On App Store this code gives: 1 TB for 3 months")).toBeTruthy();
  expect(screen.getByText("We copied the code. Paste it on the next screen.")).toBeTruthy();
  expect(mockRedeem).toHaveBeenCalledWith("HELLO");
});

it("iOS Continue presents the redeem sheet and never restores while it is open", async () => {
  captureAppState();
  open({ kind: "ios_sheet", terms: null });
  fireEvent.press(await screen.findByTestId("code-continue"));
  await waitFor(() => expect(presentCodeRedemption).toHaveBeenCalledTimes(1));
  expect(onRestore).not.toHaveBeenCalled();
  expect(mockCheck).not.toHaveBeenCalled();
});

it("iOS redemption cancelled: back in the app the plan is unchanged, so nothing is shown and nothing restored", async () => {
  const foreground = captureAppState();
  mockCheck.mockResolvedValue({ outcome: "unchanged" });
  open({ kind: "ios_sheet", terms: null });
  fireEvent.press(await screen.findByTestId("code-continue"));
  await waitFor(() => expect(presentCodeRedemption).toHaveBeenCalled());
  await act(async () => foreground("active"));
  expect(mockCheck).toHaveBeenCalledWith("free");
  expect(onPlanChanged).not.toHaveBeenCalled();
  expect(onRestore).not.toHaveBeenCalled();
});

it("iOS code redeemed: back in the app the new plan is reported once", async () => {
  const foreground = captureAppState();
  mockCheck.mockResolvedValue({ outcome: "changed", planName: "Pro" });
  open({ kind: "ios_sheet", terms: null });
  fireEvent.press(await screen.findByTestId("code-continue"));
  await waitFor(() => expect(presentCodeRedemption).toHaveBeenCalled());
  await act(async () => foreground("active"));
  await act(async () => foreground("active"));
  expect(mockCheck).toHaveBeenCalledTimes(1);
  expect(onPlanChanged).toHaveBeenCalledTimes(1);
  expect(onPlanChanged).toHaveBeenCalledWith("Pro");
  expect(onRestore).not.toHaveBeenCalled();
});

it("iOS redeem sheet fails to open: coming back checks nothing", async () => {
  const foreground = captureAppState();
  (presentCodeRedemption as jest.Mock).mockRejectedValueOnce(new Error("no sheet"));
  open({ kind: "ios_sheet", terms: null });
  fireEvent.press(await screen.findByTestId("code-continue"));
  await waitFor(() => expect(presentCodeRedemption).toHaveBeenCalled());
  await act(async () => foreground("active"));
  expect(mockCheck).not.toHaveBeenCalled();
  expect(onRestore).not.toHaveBeenCalled();
});

it("web_only says the code cannot be used in the app: no link, no continue", async () => {
  open({ kind: "web_only" });
  expect(await screen.findByText("This code can't be used in the app.")).toBeTruthy();
  expect(screen.queryByTestId("code-continue")).toBeNull();
  expect(screen.queryByTestId("code-open")).toBeNull();
});

it("web_ios_only shows its sentence and no Play link", async () => {
  open({ kind: "web_ios_only" });
  expect(await screen.findByText("This code works on the web and iOS.")).toBeTruthy();
  expect(screen.queryByTestId("code-open")).toBeNull();
});

it("invalid shows the inline error", async () => {
  open({ kind: "invalid", message: "We don't recognise that code." });
  expect(await screen.findByText("We don't recognise that code.")).toBeTruthy();
});

it("Android link opens the URL, then restores once on foreground", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const foreground = captureAppState();
  open({ kind: "android_link", url: "https://play.google.com/redeem?code=S", terms: null });
  fireEvent.press(await screen.findByTestId("code-open"));
  await waitFor(() => expect(openURL).toHaveBeenCalledWith("https://play.google.com/redeem?code=S"));
  expect(onRestore).not.toHaveBeenCalled();
  act(() => foreground("active"));
  act(() => foreground("active"));
  expect(onRestore).toHaveBeenCalledTimes(1);
  expect(mockCheck).not.toHaveBeenCalled();
});

it("Android play_sheet (empty url) starts the normal purchase", async () => {
  open({ kind: "android_link", url: "", terms: null });
  fireEvent.press(await screen.findByTestId("code-open"));
  expect(onPurchase).toHaveBeenCalledTimes(1);
});
