import { render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeleteAccountScreen from "./delete-account";
import { useMe } from "@/profile/hooks";
import { fetchDeletePreview } from "@/account/deletion";
import { useStoreStatus } from "@/billing/hooks";
import { storeBillingAvailable } from "@/billing/revenuecat";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/profile/hooks", () => ({ useMe: jest.fn() }));
jest.mock("@/account/deletion", () => ({
  ...jest.requireActual("@/account/deletion"),
  fetchDeletePreview: jest.fn(),
}));
jest.mock("@/billing/hooks", () => ({ useStoreStatus: jest.fn() }));
jest.mock("@/billing/revenuecat", () => ({ storeBillingAvailable: jest.fn() }));

const PREVIEW = {
  workspaces: [{ id: "ws_1", name: "Solo" }],
  file_count: 1,
  total_bytes: 1,
  blockers: [],
  window_days: 30,
  deletion_scheduled_for: null,
};

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeleteAccountScreen />
    </QueryClientProvider>,
  );
}

const NOTE = /subscription first, or it keeps renewing/;

beforeEach(() => {
  jest.clearAllMocks();
  (useMe as jest.Mock).mockReturnValue({ data: { has_password: true } });
  (fetchDeletePreview as jest.Mock).mockResolvedValue(PREVIEW);
});

it("tells a store subscriber to cancel in the store first", async () => {
  (storeBillingAvailable as jest.Mock).mockReturnValue(true);
  (useStoreStatus as jest.Mock).mockReturnValue({ data: { provider: "apple" } });
  renderScreen();
  expect(await screen.findByText(/Cancel your App Store subscription first/)).toBeTruthy();
});

it("names Google Play for a Google subscription", async () => {
  (storeBillingAvailable as jest.Mock).mockReturnValue(true);
  (useStoreStatus as jest.Mock).mockReturnValue({ data: { provider: "google" } });
  renderScreen();
  expect(await screen.findByText(/Cancel your Google Play subscription first/)).toBeTruthy();
});

it("shows no note without a store subscription", async () => {
  (storeBillingAvailable as jest.Mock).mockReturnValue(true);
  (useStoreStatus as jest.Mock).mockReturnValue({ data: null });
  renderScreen();
  await screen.findByTestId("preview-state");
  expect(screen.queryByText(NOTE)).toBeNull();
});

it("shows no note, and never mounts the billing hook, when store billing is unavailable", async () => {
  (storeBillingAvailable as jest.Mock).mockReturnValue(false);
  (useStoreStatus as jest.Mock).mockReturnValue({ data: { provider: "apple" } });
  renderScreen();
  await screen.findByTestId("preview-state");
  expect(screen.queryByText(NOTE)).toBeNull();
  expect(useStoreStatus).not.toHaveBeenCalled();
});
