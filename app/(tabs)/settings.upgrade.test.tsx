import { render, screen, fireEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import SettingsScreen from "./settings";
import { useAuthStore } from "@/auth/authStore";
import { storeBillingAvailable } from "@/billing/revenuecat";
import { useEligibility, useStoreStatus } from "@/billing/hooks";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/profile/hooks", () => ({ useMe: () => ({ data: { plan: { id: "pro", name: "Pro" } } }) }));
jest.mock("@/workspace-dashboard/api", () => ({ useWorkspaceDashboard: () => ({ data: undefined }) }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.0.0" } } }));
jest.mock("expo-application", () => ({ __esModule: true, nativeApplicationVersion: "1.0.1", nativeBuildVersion: "36" }));
jest.mock("@/files/cacheControl", () => ({ getCacheSizeBytes: jest.fn(async () => 0), clearCaches: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/billing/revenuecat", () => ({ storeBillingAvailable: jest.fn() }));
jest.mock("@/billing/hooks", () => ({ useEligibility: jest.fn(), useStoreStatus: jest.fn() }));

const available = storeBillingAvailable as jest.Mock;
const eligibility = useEligibility as jest.Mock;
const storeStatus = useStoreStatus as jest.Mock;

describe("Settings upgrade entry points", () => {
  beforeEach(() => {
    mockPush.mockClear();
    available.mockReturnValue(true);
    eligibility.mockReturnValue({ data: { can_purchase: true } });
    storeStatus.mockReturnValue({ data: null });
    useAuthStore.setState({ status: "signedIn", user: { id: "u", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null });
  });

  it("shows Get more space with the plan name and opens the paywall", () => {
    render(<SettingsScreen />);
    expect(screen.getByText("Get more space")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
    fireEvent.press(screen.getByTestId("settings-upgrade"));
    expect(mockPush).toHaveBeenCalledWith("/upgrade");
  });

  it("still shows the row while eligibility is unknown", () => {
    eligibility.mockReturnValue({ data: undefined });
    render(<SettingsScreen />);
    expect(screen.getByTestId("settings-upgrade")).toBeTruthy();
  });

  it("hides the row when the account cannot purchase", () => {
    eligibility.mockReturnValue({ data: { can_purchase: false } });
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-upgrade")).toBeNull();
  });

  it("hides the row when store billing is unavailable", () => {
    available.mockReturnValue(false);
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-upgrade")).toBeNull();
  });

  it("shows Manage subscription for a store subscriber and opens manage_url", () => {
    storeStatus.mockReturnValue({ data: { provider: "apple", manage_url: "https://apps.apple.com/account/subscriptions" } });
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    render(<SettingsScreen />);
    fireEvent.press(screen.getByTestId("settings-manage-subscription"));
    expect(open).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions");
  });

  it("has no Manage subscription row without a store subscription", () => {
    render(<SettingsScreen />);
    expect(screen.queryByTestId("settings-manage-subscription")).toBeNull();
  });
});
