import { Alert, Platform } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchasesPackage } from "react-native-purchases";
import UpgradeScreen from "./upgrade";
import { getCatalogPlans, getEligibility, getStoreStatus, refreshStore } from "@/billing/api";
import { awaitPlanActivation } from "@/billing/hooks";
import { fetchOfferings, identifyBilling, presentCodeRedemption, purchase, restore } from "@/billing/revenuecat";
import { redeem } from "@/billing/redeem";
import { finishSheetDismissal } from "@/ui/sheetTesting";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/auth/authStore", () => {
  const state = { user: { id: "u1" } };
  return { useAuthStore: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});
jest.mock("@/billing/api", () => ({ getEligibility: jest.fn(), getCatalogPlans: jest.fn(), getStoreStatus: jest.fn(), refreshStore: jest.fn() }));
jest.mock("@/billing/revenuecat", () => ({
  fetchOfferings: jest.fn(),
  storeBillingAvailable: () => true,
  identifyBilling: jest.fn(async () => {}),
  purchase: jest.fn(),
  restore: jest.fn(),
  presentCodeRedemption: jest.fn(async () => {}),
}));
jest.mock("@/billing/redeem", () => ({ redeem: jest.fn() }));
jest.mock("@/billing/hooks", () => ({ ...jest.requireActual("@/billing/hooks"), awaitPlanActivation: jest.fn() }));

const Y = { identifier: "dosya_1tb_yearly", product: { identifier: "dosya_1tb_yearly", price: 100, priceString: "$100.00" } } as unknown as PurchasesPackage;
const M = { identifier: "dosya_1tb_monthly", product: { identifier: "dosya_1tb_monthly", price: 10, priceString: "$10.00" } } as unknown as PurchasesPackage;
const TIMEOUT_TEXT = "Your purchase went through. We're still activating it; check again in a moment or contact us.";

async function renderReady() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <UpgradeScreen />
    </QueryClientProvider>,
  );
  await screen.findByTestId("upgrade-continue");
}

async function pressAndSettle(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  (getEligibility as jest.Mock).mockResolvedValue({ can_purchase: true, reason: "ok", current_plan: { id: "free", name: "Free" } });
  (getCatalogPlans as jest.Mock).mockResolvedValue([{ id: "pro", name: "Pro", storage_bytes: 1, storage_label: "1 TB", features: [] }]);
  (fetchOfferings as jest.Mock).mockResolvedValue([M, Y]);
  (getStoreStatus as jest.Mock).mockResolvedValue(null);
  (purchase as jest.Mock).mockResolvedValue({ ok: true });
  (awaitPlanActivation as jest.Mock).mockResolvedValue("active");
});

it("Continue identifies the user, buys the selected package and waits for its plan", async () => {
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(identifyBilling).toHaveBeenCalledWith("u1");
  expect(purchase).toHaveBeenCalledWith(Y);
  expect(awaitPlanActivation).toHaveBeenCalledWith("pro");
});

it("active: shows the plan, Done closes the paywall", async () => {
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(screen.getByText("You're on Pro.")).toBeTruthy();
  fireEvent.press(screen.getByTestId("activation-done"));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it("cancelled: the sheet stays closed, no error text and no toast", async () => {
  (purchase as jest.Mock).mockResolvedValue({ ok: false, cancelled: true, message: "Purchase was cancelled.", code: "1" });
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(purchase).toHaveBeenCalledWith(Y);
  expect(screen.queryByTestId("activation-sheet")).toBeNull();
  expect(screen.queryByText("Purchase was cancelled.")).toBeNull();
  expect(alertSpy).not.toHaveBeenCalled();
  expect(awaitPlanActivation).not.toHaveBeenCalled();
});

it("failed: shows the store's message with Restore purchases and Report a problem", async () => {
  (purchase as jest.Mock).mockResolvedValue({ ok: false, cancelled: false, message: "The App Store is unavailable.", code: "2" });
  (restore as jest.Mock).mockResolvedValue({ ok: false, message: "Still unavailable." });
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(screen.getByText("The App Store is unavailable.")).toBeTruthy();
  expect(screen.getByTestId("activation-report")).toBeTruthy();
  (identifyBilling as jest.Mock).mockClear();
  await pressAndSettle("activation-restore");
  expect(identifyBilling).toHaveBeenCalledWith("u1");
  expect(restore).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Still unavailable.")).toBeTruthy();
});

it("pending: tells the user the purchase waits for approval", async () => {
  (purchase as jest.Mock).mockResolvedValue({ ok: false, cancelled: false, message: "pending", code: "20" });
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(screen.getByText("Your purchase is waiting for approval.")).toBeTruthy();
});

it("timeout: Contact us opens live chat and Report a problem opens the report form", async () => {
  (awaitPlanActivation as jest.Mock).mockResolvedValue("timeout");
  await renderReady();
  await pressAndSettle("upgrade-continue");
  expect(screen.getByText(TIMEOUT_TEXT)).toBeTruthy();
  fireEvent.press(screen.getByText("Contact us"));
  finishSheetDismissal();
  expect(mockPush).toHaveBeenLastCalledWith("/support-chat");
  await pressAndSettle("upgrade-continue");
  fireEvent.press(screen.getByTestId("activation-report"));
  finishSheetDismissal();
  expect(mockPush).toHaveBeenLastCalledWith("/report-problem");
});

it("Restore purchases on the paywall: another account's purchase says so, with Contact us", async () => {
  (restore as jest.Mock).mockResolvedValue({ ok: false, message: "in use", code: "7" });
  await renderReady();
  await pressAndSettle("upgrade-restore");
  expect(screen.getByText("This purchase belongs to another dosya account. Sign in to that account to use it.")).toBeTruthy();
  expect(screen.getByText("Contact us")).toBeTruthy();
  expect(awaitPlanActivation).not.toHaveBeenCalled();
});

it("Restore purchases on the paywall: restored plan becomes active", async () => {
  (restore as jest.Mock).mockResolvedValue({ ok: true });
  (refreshStore as jest.Mock).mockResolvedValue({ store: { provider: "apple", plan_id: "pro" }, plan: { id: "pro", name: "Pro" } });
  await renderReady();
  await pressAndSettle("upgrade-restore");
  expect(identifyBilling).toHaveBeenCalledWith("u1");
  expect(awaitPlanActivation).toHaveBeenCalledWith("pro");
  expect(screen.getByText("You're on Pro.")).toBeTruthy();
});

describe("iOS code redemption through the App Store sheet", () => {
  function captureAppState() {
    const listeners: ((s: string) => void)[] = [];
    const AppState = jest.requireActual("react-native").AppState;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => {
      listeners.push(cb);
      return { remove: () => listeners.splice(listeners.indexOf(cb), 1) };
    }) as never);
    return (state: string) => listeners.forEach((l) => l(state));
  }

  async function redeemThroughAppStore() {
    (redeem as jest.Mock).mockResolvedValue({ kind: "ios_sheet", terms: null });
    const foreground = captureAppState();
    await renderReady();
    fireEvent.press(screen.getByTestId("upgrade-have-code"));
    fireEvent.changeText(screen.getByTestId("code-input"), "HELLO");
    await pressAndSettle("code-submit");
    await pressAndSettle("code-continue");
    finishSheetDismissal();
    expect(presentCodeRedemption).toHaveBeenCalledTimes(1);
    await act(async () => foreground("active"));
  }

  const onIos = Platform.OS === "ios" ? it : it.skip;

  onIos("cancelled (plan unchanged): no restore and no activation sheet", async () => {
    (refreshStore as jest.Mock).mockResolvedValue({ store: null, plan: { id: "free", name: "Free" } });
    await redeemThroughAppStore();
    expect(refreshStore).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    expect(screen.queryByTestId("activation-sheet")).toBeNull();
  });

  onIos("redeemed (plan changed): the activation sheet shows the new plan, no restore", async () => {
    (refreshStore as jest.Mock).mockResolvedValue({ store: { provider: "apple", plan_id: "pro" }, plan: { id: "pro", name: "Pro" } });
    await redeemThroughAppStore();
    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByText("You're on Pro.")).toBeTruthy();
  });
});
