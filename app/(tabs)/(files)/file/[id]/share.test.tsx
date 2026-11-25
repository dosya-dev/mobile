import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ShareScreen from "./share";
import * as hooks from "@/share/hooks";
import * as filesHooks from "@/files/hooks";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "f1" }),
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn() }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
// Native SVG renderer; the screen's contract is that it points one at the URL.
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));
jest.mock("@/files/workspaceStore", () => ({ useWorkspaceStore: (sel: (s: unknown) => unknown) => sel({ activeId: "w1" }) }));

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>;

function mockMutations(over: Record<string, unknown> = {}) {
  const createLink = { mutateAsync: jest.fn().mockResolvedValue({ id: "l1", token: "tok", url: "https://dosya.dev/s/tok" }), isPending: false };
  const email = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
  jest.spyOn(hooks, "useShareMutations").mockReturnValue({
    createLink, email, revoke: {}, createFolderLink: {}, folderEmail: {}, update: {}, ...over,
  } as never);
  jest.spyOn(hooks, "useIsFreePlan").mockReturnValue(false);
  return { createLink, email };
}

function mockContext(defaultDays: number | null = null) {
  jest.spyOn(hooks, "useWorkspaceShareDefault").mockReturnValue({ data: defaultDays } as never);
  jest.spyOn(hooks, "useFolderShareExclusions").mockReturnValue({ data: 0 } as never);
  jest.spyOn(filesHooks, "useFile").mockReturnValue({
    data: { name: "Q3.pdf", size_bytes: 2048, extension: "pdf" },
  } as never);
}

describe("File share sheet", () => {
  beforeEach(() => { jest.clearAllMocks(); mockContext(); });

  it("creates a link and shows the URL", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(screen.getByText("dosya.dev/s/tok")).toBeTruthy());
    // A phone can hand the link over in person; both apps already ship a QR
    // renderer for 2FA and neither had aimed one at a share URL.
    expect(screen.getByTestId("share-qr")).toBeTruthy();
    expect(createLink.mutateAsync).toHaveBeenCalledWith({
      fileId: "f1",
      opts: { expiresAt: undefined, expiresInDays: 7, password: undefined, lockMode: undefined, maxDownloads: null },
    });
  });

  it("blocks creation when password protection is on but the field is empty", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent(screen.getByTestId("toggle-password"), "valueChange", true);
    fireEvent.press(screen.getByTestId("create-link"));
    await Promise.resolve();
    expect(createLink.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-error")).toBeTruthy();
  });

  // The old picker listed Never first and opened on it, so every link it made
  // defaulted to outliving the conversation.
  it("opens on the product default rather than on Never", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.expiresInDays).toBe(7);
  });

  it("opens on the workspace's own default when it sets one", async () => {
    mockContext(30);
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.expiresInDays).toBe(30);
  });

  it("offers the hour and 90-day options mobile never had", () => {
    mockMutations();
    render(wrap(<ShareScreen />));
    expect(screen.getByTestId("expiry-1h")).toBeTruthy();
    expect(screen.getByTestId("expiry-90d")).toBeTruthy();
  });

  it("sends 0 for Never, so the workspace default cannot override it", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("expiry-never"));
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.expiresInDays).toBe(0);
  });

  // The API accepts lock_mode and only the CLI ever sent it.
  it("sends the view-only lock when the toggle is on", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.lockMode).toBe("view_only");
  });

  it("takes more than one recipient, which the single field could never do", async () => {
    const { email } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent.changeText(screen.getByTestId("email-input"), "dana@northfield.co");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    fireEvent.changeText(screen.getByTestId("email-input"), "m.okafor@northfield.co");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    fireEvent.press(screen.getByTestId("send-email"));
    await waitFor(() => expect(email.mutateAsync).toHaveBeenCalled());
    expect(email.mutateAsync.mock.calls[0][0].opts.emails).toEqual([
      "dana@northfield.co", "m.okafor@northfield.co",
    ]);
  });

  it("splits a pasted list on commas and spaces", async () => {
    const { email } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent.changeText(screen.getByTestId("email-input"), "a@b.com, c@d.com e@f.com");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    fireEvent.press(screen.getByTestId("send-email"));
    await waitFor(() => expect(email.mutateAsync).toHaveBeenCalled());
    expect(email.mutateAsync.mock.calls[0][0].opts.emails).toEqual(["a@b.com", "c@d.com", "e@f.com"]);
  });

  it("names a bad address instead of refusing the whole list", () => {
    mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent.changeText(screen.getByTestId("email-input"), "not-an-email");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    expect(screen.getByTestId("create-error")).toHaveTextContent(/"not-an-email"/);
  });

  it("carries a message, which mobile never sent", async () => {
    const { email } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent.changeText(screen.getByTestId("email-input"), "a@b.com");
    fireEvent(screen.getByTestId("email-input"), "submitEditing");
    fireEvent.changeText(screen.getByTestId("message-input"), "Final cut plus sources.");
    fireEvent.press(screen.getByTestId("send-email"));
    await waitFor(() => expect(email.mutateAsync).toHaveBeenCalled());
    expect(email.mutateAsync.mock.calls[0][0].opts.message).toBe("Final cut plus sources.");
  });

  it("refuses to send an email share with nobody on it", async () => {
    const { email } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("tab-email"));
    fireEvent.press(screen.getByTestId("send-email"));
    await Promise.resolve();
    expect(email.mutateAsync).not.toHaveBeenCalled();
  });

  // ── download limit (migration 0143) ──────────────────────────────

  it("sends the download limit when one is typed", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "5");
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.maxDownloads).toBe(5);
  });

  it("sends no limit when the field is blank, meaning unlimited", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    expect(createLink.mutateAsync.mock.calls[0][0].opts.maxDownloads).toBeNull();
  });

  it("refuses 0 rather than minting a link nobody can use", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.changeText(screen.getByTestId("max-downloads"), "0");
    fireEvent.press(screen.getByTestId("create-link"));
    await Promise.resolve();
    expect(createLink.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-error")).toHaveTextContent(/at least 1/);
  });

  // A view-only link allows no downloads at all, so a ceiling on them would be
  // a control that does nothing.
  it("hides the download limit once the link is view-only", () => {
    mockMutations();
    render(wrap(<ShareScreen />));
    expect(screen.getByTestId("max-downloads")).toBeTruthy();
    fireEvent(screen.getByTestId("toggle-view-only"), "valueChange", true);
    expect(screen.queryByTestId("max-downloads")).toBeNull();
  });

  // ── custom date ──────────────────────────────────────────────────

  it("opens a calendar when the date chip is chosen", () => {
    mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("expiry-custom"));
    expect(screen.getByTestId("cal-month")).toBeTruthy();
  });

  it("sends the picked date as an absolute expiry, never as days", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("expiry-custom"));

    // Move to next month so every day is comfortably in the future.
    fireEvent.press(screen.getByTestId("cal-next"));
    fireEvent.press(screen.getByTestId("cal-day-15"));
    fireEvent.press(screen.getByTestId("cal-confirm"));

    fireEvent.press(screen.getByTestId("create-link"));
    await waitFor(() => expect(createLink.mutateAsync).toHaveBeenCalled());
    const opts = createLink.mutateAsync.mock.calls[0][0].opts;
    expect(typeof opts.expiresAt).toBe("number");
    expect(opts.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(opts.expiresInDays).toBeUndefined();
  });

  it("refuses to submit with the date chip selected but no date picked", async () => {
    const { createLink } = mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("expiry-custom"));
    fireEvent.press(screen.getByTestId("cal-confirm"));  // disabled: nothing chosen
    expect(createLink.mutateAsync).not.toHaveBeenCalled();
  });

  it("falls back to the default when the calendar is dismissed with no date", () => {
    mockMutations();
    render(wrap(<ShareScreen />));
    fireEvent.press(screen.getByTestId("expiry-custom"));
    fireEvent.press(screen.getByTestId("cal-cancel"));
    expect(screen.getByTestId("expiry-7d").props.accessibilityState).toMatchObject({ selected: true });
  });
});
