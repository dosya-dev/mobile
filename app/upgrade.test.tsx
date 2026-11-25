import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Linking, Platform } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PurchasesPackage } from "react-native-purchases";
import UpgradeScreen from "./upgrade";
import { TierPicker } from "@/billing/TierPicker";
import { getCatalogPlans, getEligibility, getStoreStatus, type Eligibility, type StoreStatus } from "@/billing/api";
import { fetchOfferings } from "@/billing/revenuecat";
import { runPurchase, runRestore } from "@/billing/purchaseFlow";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("@/billing/api", () => ({ getEligibility: jest.fn(), getCatalogPlans: jest.fn(), getStoreStatus: jest.fn() }));
jest.mock("@/billing/revenuecat", () => ({ fetchOfferings: jest.fn(), storeBillingAvailable: () => true }));
jest.mock("@/billing/purchaseFlow", () => ({ runPurchase: jest.fn(async () => {}), runRestore: jest.fn(async () => {}) }));
jest.mock("@/auth/authStore", () => ({ useAuthStore: (sel: (s: { user: { id: string } }) => unknown) => sel({ user: { id: "u1" } }) }));

const eligibility = getEligibility as jest.Mock;
const catalog = getCatalogPlans as jest.Mock;
const offerings = fetchOfferings as jest.Mock;
const storeStatus = getStoreStatus as jest.Mock;

const THIS_PROVIDER = Platform.OS === "android" ? "google" : "apple";
const OTHER_PROVIDER = Platform.OS === "android" ? "apple" : "google";
const subscription = (provider: "apple" | "google"): StoreStatus => ({
  provider,
  plan_id: "pro",
  product_id: "dosya_1tb_yearly",
  expires_at: null,
  grace_until: null,
  will_renew: true,
  period_type: "normal",
  environment: "production",
  conflict: false,
  manage_url: "https://apps.apple.com/account/subscriptions",
});

const pkg = (identifier: string, price: number, priceString: string) =>
  ({ identifier, product: { identifier, price, priceString, currencyCode: "USD" } }) as unknown as PurchasesPackage;
const M = pkg("dosya_1tb_monthly", 10, "$10.00");
const Y = pkg("dosya_1tb_yearly", 100, "$100.00");
const M100 = pkg("dosya_100gb_monthly", 3, "$3.00");
const PLANS = [
  { id: "starter", name: "Starter", storage_bytes: 1, storage_label: "100 GB", features: [], active: true },
  { id: "pro", name: "Pro", storage_bytes: 1, storage_label: "1 TB", features: [], active: true },
];
const STORE = Platform.OS === "android" ? "Google Play" : "App Store";
const OK: Eligibility = { can_purchase: true, reason: "ok", current_plan: { id: "free", name: "Free" } };

const continued = () => (runPurchase as jest.Mock).mock.calls.map(([pkg, planId, userId]) => [pkg, planId, userId]);

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <UpgradeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  eligibility.mockResolvedValue(OK);
  catalog.mockResolvedValue(PLANS);
  offerings.mockResolvedValue([M, Y, M100]);
  storeStatus.mockResolvedValue(null);
});

const hero = () => within(screen.getByTestId("plan-hero"));
const heroPrice = () => within(screen.getByTestId("plan-hero-price"));
const ready = () => screen.findByTestId("upgrade-continue");

it("opens on the first tier sold yearly, with the store's yearly price, and continues with that package", async () => {
  renderScreen();
  await ready();
  // Starter has no yearly package, so the paywall opens on Pro, yearly.
  expect(screen.getByText("Your space")).toBeTruthy();
  expect(hero().getByText("1 TB")).toBeTruthy();
  expect(heroPrice().getByText("$100.00")).toBeTruthy();
  expect(screen.getByText("Save 17% vs monthly")).toBeTruthy();
  expect(screen.getByTestId("upgrade-interval-year").props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByText(`Continue to ${STORE}`)).toBeTruthy();
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  expect(continued()).toEqual([[Y, "pro", "u1"]]);
});

it("the monthly/yearly switch changes the package shown and bought, and keeps the tier", async () => {
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("upgrade-interval-month"));
  expect(hero().getByText("1 TB")).toBeTruthy();
  expect(heroPrice().getByText("$10.00")).toBeTruthy();
  expect(heroPrice().getByText("/ month")).toBeTruthy();
  expect(screen.queryByText("$100.00")).toBeNull();
  expect(screen.queryByText("Save 17% vs monthly")).toBeNull();
  expect(screen.queryByTestId("plan-hero-per-month")).toBeNull();
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  expect(continued()).toEqual([[M, "pro", "u1"]]);
});

it("- and + change the tier; a tier sold only monthly shows monthly, and + returns to yearly", async () => {
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("tier-less"));
  expect(hero().getByText("100 GB")).toBeTruthy();
  expect(heroPrice().getByText("$3.00")).toBeTruthy();
  expect(heroPrice().getByText("/ month")).toBeTruthy();
  expect(screen.getByTestId("upgrade-interval-month").props.accessibilityState).toMatchObject({ selected: true });
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  expect(continued()).toEqual([[M100, "starter", "u1"]]);
  fireEvent.press(screen.getByTestId("tier-more"));
  expect(hero().getByText("1 TB")).toBeTruthy();
  expect(heroPrice().getByText("$100.00")).toBeTruthy();
  expect(heroPrice().getByText("/ year")).toBeTruthy();
});

it("tapping a tier's dot picks it", async () => {
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("tier-dot-starter"));
  expect(hero().getByText("100 GB")).toBeTruthy();
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  expect(continued()).toEqual([[M100, "starter", "u1"]]);
});

it("What you get follows the tier, with Smart Search from the catalog's limits", async () => {
  catalog.mockResolvedValue([
    PLANS[0],
    { ...PLANS[1], features: ["ai_search"], ai_images_max: 50000, ai_documents_max: 10000 },
  ]);
  renderScreen();
  await ready();
  const card = within(screen.getByTestId("what-you-get"));
  expect(card.getByText("1 TB of end-to-end encrypted storage")).toBeTruthy();
  expect(card.getByText(/^Smart Search across 50.000 photos and 10.000 documents$/)).toBeTruthy();
  fireEvent.press(screen.getByTestId("tier-less"));
  expect(card.getByText("100 GB of end-to-end encrypted storage")).toBeTruthy();
  expect(card.queryByText(/Smart Search/)).toBeNull();
});

it("shows the current plan, with its size when the catalog has it, under Continue", async () => {
  eligibility.mockResolvedValue({ can_purchase: true, reason: "ok", current_plan: { id: "starter", name: "Starter" } });
  renderScreen();
  await ready();
  expect(screen.getByTestId("upgrade-current-plan")).toHaveTextContent("Current plan: Starter · 100 GB");
});

it("current plan missing from the catalog: the name alone", async () => {
  renderScreen();
  await ready();
  expect(screen.getByTestId("upgrade-current-plan")).toHaveTextContent(/^Current plan: Free$/);
});

describe("store compliance", () => {
  it("the price and its billing period sit together on one line", async () => {
    renderScreen();
    await ready();
    expect(heroPrice().getByText("$100.00")).toBeTruthy();
    expect(heroPrice().getByText("/ year")).toBeTruthy();
  });

  it("yearly: the full yearly price is the main figure; the monthly equivalent is only a secondary approximation", async () => {
    renderScreen();
    await ready();
    expect(heroPrice().queryByText(/≈/)).toBeNull();
    expect(screen.getByTestId("plan-hero-per-month")).toHaveTextContent(/^≈ .*8\.33 \/ month$/);
  });

  it("the auto-renewal and cancel lines, Restore, Terms and Privacy are on the screen", async () => {
    renderScreen();
    await ready();
    expect(screen.getByTestId("upgrade-legal")).toHaveTextContent(
      `Subscriptions renew automatically until cancelled in your ${STORE} settings. Cancel anytime in your ${STORE} subscription settings.`,
    );
    expect(screen.getByTestId("upgrade-restore")).toBeTruthy();
    expect(screen.getByText("Terms of Service")).toBeTruthy();
    expect(screen.getByText("Privacy Policy")).toBeTruthy();
  });

  it("no saving pill when yearly is not cheaper than twelve months", async () => {
    offerings.mockResolvedValue([M, pkg("dosya_1tb_yearly", 120, "$120.00"), M100]);
    renderScreen();
    await ready();
    expect(heroPrice().getByText("$120.00")).toBeTruthy();
    expect(screen.queryByTestId("plan-hero-saving")).toBeNull();
  });

  it("no web pricing, cheaper-elsewhere, free-months, trial or urgency copy in the paywall or its strings", () => {
    const billing = join(__dirname, "../src/billing");
    const sources = [
      join(__dirname, "upgrade.tsx"),
      ...readdirSync(billing).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => join(billing, f)),
    ].map((f) => readFileSync(f, "utf8"));
    const en = JSON.parse(readFileSync(join(__dirname, "../src/i18n/messages/en.json"), "utf8")) as Record<string, string>;
    const strings = Object.entries(en).filter(([k]) => k.startsWith("upgrade.")).map(([, v]) => v);
    const banned = /dosya\.dev\/pricing|cheaper on the web|cheaper on our website|months? free|free trial|limited time|hurry|only today|ends soon/i;
    for (const text of [...sources, ...strings]) expect(text).not.toMatch(banned);
  });
});

it("two rapid Continue taps start one purchase", async () => {
  let finish: () => void = () => {};
  (runPurchase as jest.Mock).mockImplementation(() => new Promise<void>((res) => { finish = res; }));
  renderScreen();
  await ready();
  // One act: both taps land before React re-renders, as two fast taps do on a device.
  act(() => {
    fireEvent.press(screen.getByTestId("upgrade-continue"));
    fireEvent.press(screen.getByTestId("upgrade-continue"));
  });
  expect(runPurchase).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  expect(runPurchase).toHaveBeenCalledTimes(2);
});

it("while a purchase runs the tier picker and the period switch ignore taps", async () => {
  let finish: () => void = () => {};
  // Like the real flow: "paying" is set before the first await.
  (runPurchase as jest.Mock).mockImplementation((_pkg, _planId, _userId, setState: (s: string) => void) => {
    setState("paying");
    return new Promise<void>((res) => { finish = () => { setState("idle"); res(); }; });
  });
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  fireEvent.press(screen.getByTestId("tier-less"));
  fireEvent.press(screen.getByTestId("tier-dot-starter"));
  fireEvent.press(screen.getByTestId("upgrade-interval-month"));
  expect(hero().getByText("1 TB")).toBeTruthy();
  expect(heroPrice().getByText("$100.00")).toBeTruthy();
  await act(async () => finish());
  fireEvent.press(screen.getByTestId("tier-less"));
  expect(hero().getByText("100 GB")).toBeTruthy();
});

it("the success sheet names the plan Continue bought, even if the selection moves before activation", async () => {
  let activate: () => void = () => {};
  (runPurchase as jest.Mock).mockImplementation(
    (_pkg, _planId, _userId, setState: (s: string, d?: string) => void) =>
      new Promise<void>((res) => {
        activate = () => {
          setState("active");
          res();
        };
      }),
  );
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("upgrade-continue"));
  // Past the UI gate on purpose: the name must not come from the live selection.
  act(() => screen.UNSAFE_getByType(TierPicker).props.onChange(0));
  expect(hero().getByText("100 GB")).toBeTruthy();
  await act(async () => activate());
  expect(await screen.findByText("You're on Pro.")).toBeTruthy();
  expect(screen.queryByText("You're on Starter.")).toBeNull();
});

it("two rapid Restore taps start one restore, and Continue waits for it", async () => {
  let finish: () => void = () => {};
  (runRestore as jest.Mock).mockImplementation(() => new Promise<void>((res) => { finish = res; }));
  renderScreen();
  await ready();
  act(() => {
    fireEvent.press(screen.getByTestId("upgrade-restore"));
    fireEvent.press(screen.getByTestId("upgrade-restore"));
    fireEvent.press(screen.getByTestId("upgrade-continue"));
  });
  expect(runRestore).toHaveBeenCalledTimes(1);
  expect(runPurchase).not.toHaveBeenCalled();
  await act(async () => finish());
});

it("links the footer to the in-app Terms and Privacy screens", async () => {
  renderScreen();
  await ready();
  fireEvent.press(screen.getByTestId("upgrade-terms"));
  fireEvent.press(screen.getByTestId("upgrade-privacy"));
  expect(mockPush.mock.calls).toEqual([["/terms"], ["/privacy"]]);
});

it("not eligible: shows the current plan and why, never the purchase button", async () => {
  eligibility.mockResolvedValue({ can_purchase: false, reason: "web_subscription", current_plan: { id: "pro", name: "Pro" } });
  renderScreen();
  expect(await screen.findByText("Current plan: Pro")).toBeTruthy();
  expect(screen.getByText("Your plan is managed on the web.")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
});

it("not eligible through the other store names that store", async () => {
  eligibility.mockResolvedValue({ can_purchase: false, reason: "store_other_platform", current_plan: { id: "pro", name: "Pro" } });
  renderScreen();
  const other = Platform.OS === "android" ? "App Store" : "Google Play";
  expect(await screen.findByText(`Your plan is managed through ${other}.`)).toBeTruthy();
});

it("eligibility fails: error with Try again, never the purchase button; retry recovers", async () => {
  eligibility.mockRejectedValueOnce(new Error("offline"));
  renderScreen();
  expect(await screen.findByText("We couldn't load plans. Check your connection and try again.")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
  fireEvent.press(screen.getByTestId("upgrade-retry"));
  expect(await screen.findByTestId("upgrade-continue")).toBeTruthy();
  expect(eligibility).toHaveBeenCalledTimes(2);
});

it("catalog fails: error state, no purchase button", async () => {
  catalog.mockRejectedValue(new Error("500"));
  renderScreen();
  expect(await screen.findByTestId("upgrade-retry")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
});

it("store returns no offerings: error state, no purchase button", async () => {
  offerings.mockResolvedValue([]);
  renderScreen();
  expect(await screen.findByText("We couldn't load plans. Check your connection and try again.")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
  await waitFor(() => expect(offerings).toHaveBeenCalled());
});

it("subscribed through this platform's store: managed-in-store state, never Continue or Have a code", async () => {
  // The server may still say can_purchase; a second store purchase must not be offered.
  eligibility.mockResolvedValue({ can_purchase: true, reason: "ok", current_plan: { id: "pro", name: "Pro" } });
  storeStatus.mockResolvedValue(subscription(THIS_PROVIDER));
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  renderScreen();
  const store = Platform.OS === "android" ? "Google Play" : "App Store";
  expect(await screen.findByText("Current plan: Pro")).toBeTruthy();
  expect(screen.getByText(`Your plan is managed through ${store}. Change or cancel it in your ${store} subscription settings.`)).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
  expect(screen.queryByTestId("upgrade-have-code")).toBeNull();
  expect(screen.queryByTestId("tier-picker")).toBeNull();
  expect(screen.queryByTestId("plan-hero")).toBeNull();
  expect(screen.getByTestId("upgrade-restore")).toBeTruthy();
  fireEvent.press(screen.getByTestId("upgrade-manage"));
  expect(openURL).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions");
});

it("subscribed through the other platform's store: the existing not-eligible line, no manage button", async () => {
  eligibility.mockResolvedValue({ can_purchase: false, reason: "store_other_platform", current_plan: { id: "pro", name: "Pro" } });
  storeStatus.mockResolvedValue(subscription(OTHER_PROVIDER));
  renderScreen();
  const other = Platform.OS === "android" ? "App Store" : "Google Play";
  expect(await screen.findByText(`Your plan is managed through ${other}.`)).toBeTruthy();
  expect(screen.getByText("Current plan: Pro")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-manage")).toBeNull();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
});

it("store status fails: error with Try again, never the purchase button", async () => {
  storeStatus.mockRejectedValueOnce(new Error("offline"));
  renderScreen();
  expect(await screen.findByTestId("upgrade-retry")).toBeTruthy();
  expect(screen.queryByTestId("upgrade-continue")).toBeNull();
  fireEvent.press(screen.getByTestId("upgrade-retry"));
  expect(await screen.findByTestId("upgrade-continue")).toBeTruthy();
});
