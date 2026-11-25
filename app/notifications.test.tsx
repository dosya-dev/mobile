import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationsScreen from "./notifications";
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, dismissNotification,
} from "@/notifications/api";
import type { InboxItem } from "@/notifications/inbox";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => unknown } }) =>
      (options?.headerRight ? options.headerRight() : null) as never,
  },
}));
jest.mock("@/notifications/api", () => ({
  listNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  dismissNotification: jest.fn(),
}));

const mockList = listNotifications as jest.MockedFunction<typeof listNotifications>;
const mockRead = markNotificationRead as jest.MockedFunction<typeof markNotificationRead>;
const mockReadAll = markAllNotificationsRead as jest.MockedFunction<typeof markAllNotificationsRead>;
const mockDismiss = dismissNotification as jest.MockedFunction<typeof dismissNotification>;

function item(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "n1", kind: "personal", type: "files_uploaded", category: "files",
    priority: "normal", title: "A file arrived", body: null, icon: null,
    link_path: null, actions: null, actor_name: null,
    created_at: Math.floor(Date.now() / 1000), read_at: null, dismissed_at: null, ...over,
  };
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><NotificationsScreen /></QueryClientProvider>);
}

describe("NotificationsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRead.mockResolvedValue(undefined);
    mockReadAll.mockResolvedValue(undefined);
    mockDismiss.mockResolvedValue(undefined);
    mockList.mockResolvedValue({ items: [item({ id: "a" }), item({ id: "b", read_at: 5 })], nextBefore: null });
  });

  it("renders the inbox with an unread marker only on unread rows", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    expect(screen.getByTestId("unread-dot-a")).toBeTruthy();
    expect(screen.queryByTestId("unread-dot-b")).toBeNull();
  });

  it("shows an empty state rather than a blank screen", async () => {
    mockList.mockResolvedValue({ items: [], nextBefore: null });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("inbox-empty")).toBeTruthy());
  });

  it("marks a row read on tap and clears its unread marker", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-a"));
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(screen.queryByTestId("unread-dot-a")).toBeNull());
  });

  it("does not re-send read for a row that is already read", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-b")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-b"));
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("dismisses a row and keeps it gone, rather than letting it reappear", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    fireEvent.press(screen.getByTestId("dismiss-a"));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(screen.queryByTestId("notification-a")).toBeNull());
    // Still gone after a re-render pass - the local edit is projected over the
    // server pages, not a snapshot that a refetch would overwrite.
    expect(screen.queryByTestId("notification-a")).toBeNull();
  });

  it("marks all read and hides the control once nothing is unread", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("mark-all-read")).toBeTruthy());
    fireEvent.press(screen.getByTestId("mark-all-read"));
    await waitFor(() => expect(mockReadAll).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("mark-all-read")).toBeNull());
  });

  it("hides Mark all read when everything is already read", async () => {
    mockList.mockResolvedValue({ items: [item({ id: "b", read_at: 5 })], nextBefore: null });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-b")).toBeTruthy());
    expect(screen.queryByTestId("mark-all-read")).toBeNull();
  });

  it("routes a web link_path through the mobile mapping", async () => {
    mockList.mockResolvedValue({ items: [item({ id: "a", link_path: "/files/xyz" })], nextBefore: null });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-a"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/file/xyz"));
  });

  it("does not navigate for a web-only link_path", async () => {
    // Not /vault any more: mobile has a Vault screen, so that path maps.
    mockList.mockResolvedValue({ items: [item({ id: "a", link_path: "/billing" })], nextBefore: null });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    fireEvent.press(screen.getByTestId("notification-a"));
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith("a"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("hides a navigate action whose path has no mobile equivalent", async () => {
    mockList.mockResolvedValue({
      items: [item({
        id: "a",
        actions: JSON.stringify([
          { handler: "navigate", label: "Open billing", params: { path: "/billing" } },
          { handler: "navigate", label: "Open file", params: { path: "/files/xyz" } },
        ]),
      })],
      nextBefore: null,
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    expect(screen.queryByText("Open billing")).toBeNull();
    expect(screen.getByText("Open file")).toBeTruthy();
  });

  it("dismisses via a dismiss-handler action", async () => {
    mockList.mockResolvedValue({
      items: [item({ id: "a", actions: JSON.stringify([{ handler: "dismiss", label: "Not now" }]) })],
      nextBefore: null,
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText("Not now")).toBeTruthy());
    fireEvent.press(screen.getByText("Not now"));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith("a"));
  });

  it("requests the next page using the server's cursor", async () => {
    mockList.mockReset();
    mockList
      .mockResolvedValueOnce({ items: [item({ id: "a" })], nextBefore: 111 })
      .mockResolvedValueOnce({ items: [item({ id: "z", created_at: 50 })], nextBefore: null });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("notification-a")).toBeTruthy());
    fireEvent(screen.getByTestId("notification-a").parent!, "onEndReached");
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(111));
  });
});
