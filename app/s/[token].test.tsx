import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import ShareView from "./[token]";
import * as shareApi from "@/share/api";
import type { SharePayload } from "@/share/api";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "tok" }),
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///tmp/x"), shareFile: jest.fn(async () => {}) }));
// The stages pull in native modules; this screen's job is choosing between
// them, which the testID below is enough to observe.
jest.mock("@/share/SharePreview", () => ({ SharePreview: () => null }));

function payload(over: Partial<SharePayload> = {}): SharePayload {
  return {
    isFolder: false, isBundle: false, lockMode: "none",
    requiresPassword: false, requiresRecipientVerification: false,
    files: [{ id: "f1", name: "shared.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf" }],
    file: { id: "f1", name: "shared.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf" },
    folder: null, viewCount: 0, downloadCount: 0, expiresAt: null,
    ...over,
  };
}

function mockOpen(p: SharePayload | Error) {
  jest.spyOn(shareApi, "openShare").mockImplementation(async () => {
    if (p instanceof Error) throw p;
    return p;
  });
}

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

describe("ShareView", () => {
  beforeEach(() => jest.restoreAllMocks());

  it("shows the shared file and a download button", async () => {
    mockOpen(payload());
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("shared.pdf")).toBeTruthy());
    expect(screen.getByTestId("download-shared")).toBeTruthy();
  });

  it("shows the expiry and view count the old screen never displayed", async () => {
    mockOpen(payload({ expiresAt: Math.floor(Date.now() / 1000) + 6 * 86400, viewCount: 17 }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("6d")).toBeTruthy());
    expect(screen.getByText("17")).toBeTruthy();
  });

  // The previous screen printed one sentence for every 410, so "the sender
  // turned this off" and "this expired" were indistinguishable.
  it("tells a revoked link apart from an expired one", async () => {
    mockOpen(httpError(410, "This link has been revoked"));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("This link was turned off")).toBeTruthy());
  });

  it("names an expired link as expired", async () => {
    mockOpen(httpError(410, "This link has expired"));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("This link has expired")).toBeTruthy());
  });

  it("does not blame the sender for a network failure", async () => {
    mockOpen(new Error("Network request failed"));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("Could not open this link")).toBeTruthy());
  });

  it("offers no download on a view-only link, and says why", async () => {
    mockOpen(payload({ lockMode: "view_only" }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText(/The sender turned off downloads/)).toBeTruthy());
    expect(screen.queryByTestId("download-shared")).toBeNull();
    // Saving a copy is a download by another name, so it goes too.
    expect(screen.queryByTestId("save-to-dosya")).toBeNull();
  });

  it("browses a shared folder rather than offering a bare download", async () => {
    mockOpen(payload({
      isFolder: true, file: null, files: [{ id: "f2", name: "notes.pdf", size_bytes: 10 }],
      folder: { root_id: "r", root_name: "Root", current_id: "r", current_name: "Root", breadcrumb: [{ id: "r", name: "Root" }], subfolders: [{ id: "s1", name: "Stills" }] },
    }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByTestId("shared-folder-s1")).toBeTruthy());
    expect(screen.getByText("notes.pdf")).toBeTruthy();
    expect(screen.getByText("Download all")).toBeTruthy();
  });

  it("descends into a subfolder by path_id", async () => {
    const open = jest.spyOn(shareApi, "openShare").mockResolvedValue(payload({
      isFolder: true, file: null, files: [],
      folder: { root_id: "r", root_name: "Root", current_id: "r", current_name: "Root", breadcrumb: [], subfolders: [{ id: "s1", name: "Stills" }] },
    }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByTestId("shared-folder-s1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("shared-folder-s1"));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith("tok", "s1"));
  });

  it("lists the members of a bundle link", async () => {
    mockOpen(payload({
      isBundle: true,
      files: [
        { id: "a", name: "one.png", size_bytes: 1 },
        { id: "b", name: "two.png", size_bytes: 2 },
      ],
    }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("2 files in this link")).toBeTruthy());
    expect(screen.getByText("one.png")).toBeTruthy();
    expect(screen.getByText("two.png")).toBeTruthy();
  });

  // Mobile called neither request-code nor verify-code, so a link sent
  // privately could not be opened in the app that received the notification.
  it("runs the email-then-code flow for a private link", async () => {
    mockOpen(payload({ requiresRecipientVerification: true, file: null, files: [] }));
    const request = jest.spyOn(shareApi, "requestShareCode").mockResolvedValue(undefined);
    const verify = jest.spyOn(shareApi, "verifyShareCode").mockResolvedValue(undefined);

    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("This link is for you only")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("recipient-email"), "dana@northfield.co");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("tok", "dana@northfield.co"));

    fireEvent.changeText(screen.getByTestId("recipient-code"), "123456");
    fireEvent.press(screen.getByTestId("verify-code"));
    await waitFor(() => expect(verify).toHaveBeenCalledWith("tok", "dana@northfield.co", "123456"));
  });

  it("reports a rejected code without losing the address", async () => {
    mockOpen(payload({ requiresRecipientVerification: true, file: null, files: [] }));
    jest.spyOn(shareApi, "requestShareCode").mockResolvedValue(undefined);
    jest.spyOn(shareApi, "verifyShareCode").mockRejectedValue(new Error("That code has expired"));

    render(<ShareView />);
    await waitFor(() => expect(screen.getByTestId("recipient-email")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("recipient-email"), "dana@northfield.co");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(screen.getByTestId("recipient-code")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("recipient-code"), "000000");
    fireEvent.press(screen.getByTestId("verify-code"));
    await waitFor(() => expect(screen.getByTestId("recipient-error")).toHaveTextContent(/expired/));
  });

  it("prompts for a password without treating it as an error", async () => {
    mockOpen(payload({ requiresPassword: true, file: null, files: [] }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("Password required")).toBeTruthy());
  });

  it("offers Save to dosya on an ordinary single-file link", async () => {
    mockOpen(payload());
    render(<ShareView />);
    await waitFor(() => expect(screen.getByTestId("save-to-dosya")).toBeTruthy());
  });

  it("does not offer Save to dosya for a folder, which would save a zip", async () => {
    mockOpen(payload({
      isFolder: true, file: null, files: [],
      folder: { root_id: "r", root_name: "Root", current_id: "r", current_name: "Root", breadcrumb: [], subfolders: [] },
    }));
    render(<ShareView />);
    await waitFor(() => expect(screen.getByText("Download all")).toBeTruthy());
    expect(screen.queryByTestId("save-to-dosya")).toBeNull();
  });
});
