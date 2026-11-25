import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBell, badgeLabel } from "./NotificationBell";
import { getInboxSummary } from "./api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("./api", () => ({ getInboxSummary: jest.fn() }));

const mockSummary = getInboxSummary as jest.MockedFunction<typeof getInboxSummary>;

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><NotificationBell /></QueryClientProvider>);
}

describe("badgeLabel", () => {
  it("caps at 99+ so the badge cannot outgrow the dot", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
    expect(badgeLabel(4213)).toBe("99+");
  });
});

describe("NotificationBell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSummary.mockResolvedValue({ unread: 0, latest: null });
  });

  it("renders no badge when nothing is unread", async () => {
    renderBell();
    await waitFor(() => expect(screen.getByTestId("open-notifications")).toBeTruthy());
    expect(screen.queryByTestId("notification-badge")).toBeNull();
  });

  it("shows the unread count when there is one", async () => {
    mockSummary.mockResolvedValue({ unread: 3, latest: null });
    renderBell();
    await waitFor(() => expect(screen.getByTestId("notification-badge")).toBeTruthy());
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("puts the count in the accessible label, not only in the badge", async () => {
    mockSummary.mockResolvedValue({ unread: 2, latest: null });
    renderBell();
    await waitFor(() =>
      expect(screen.getByLabelText("Notifications, 2 unread")).toBeTruthy(),
    );
  });

  it("opens the inbox", async () => {
    renderBell();
    await waitFor(() => expect(screen.getByTestId("open-notifications")).toBeTruthy());
    fireEvent.press(screen.getByTestId("open-notifications"));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
  });

  it("still renders and stays tappable when the summary request fails", async () => {
    mockSummary.mockRejectedValue(new Error("offline"));
    renderBell();
    await waitFor(() => expect(screen.getByTestId("open-notifications")).toBeTruthy());
    expect(screen.queryByTestId("notification-badge")).toBeNull();
    fireEvent.press(screen.getByTestId("open-notifications"));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
  });
});
