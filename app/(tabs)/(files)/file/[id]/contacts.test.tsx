import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import ContactsRoute from "./contacts";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "f1" }),
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  Stack: { Screen: () => null },
}));

let mockFile: Record<string, unknown>;
jest.mock("@/files/hooks", () => ({ useFile: () => ({ data: mockFile, isLoading: false, isError: false }) }));
jest.mock("@/files/api", () => ({ getDownloadUrl: jest.fn(async () => "https://r2/presigned") }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: jest.fn(() => "tok") }));

const mockUploadOne = jest.fn(async () => ({ fileId: "f1", sizeBytes: null }));
jest.mock("@/upload/runner", () => ({ uploadOne: (...a: unknown[]) => mockUploadOne(...(a as [])) }));

const mockInvalidate = jest.fn(async () => {});
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: "w1" }),
}));

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

let writtenText = "";
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async (_p: string, d: string) => { writtenText = d; }),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 100 })),
  deleteAsync: jest.fn(async () => {}),
}));

const VCF = [
  "BEGIN:VCARD", "VERSION:3.0", "FN:Ada Lovelace", "ORG:Analytical Engines",
  "TEL;TYPE=CELL:+1-555-0100", "EMAIL;TYPE=WORK:ada@example.com",
  "PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ", "NOTE:Keep me", "END:VCARD",
  "BEGIN:VCARD", "VERSION:3.0", "FN:Adam Smith", "TEL;TYPE=HOME:+1-555-0142", "END:VCARD",
].join("\r\n") + "\r\n";

beforeEach(() => {
  jest.clearAllMocks();
  writtenText = "";
  mockFile = {
    id: "f1", name: "contacts.vcf", mime_type: "text/vcard", extension: ".vcf",
    size_bytes: VCF.length, current_version: 1, lock_mode: "none",
  };
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => VCF })) as never;
});

const ready = () => waitFor(() => expect(screen.getByTestId("contact-0")).toBeTruthy());

describe("viewing", () => {
  it("renders parsed contact cards instead of raw vCard source", async () => {
    render(<ContactsRoute />);
    await ready();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Analytical Engines")).toBeTruthy();
    expect(screen.getByText("+1-555-0100")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VCARD/)).toBeNull();
  });

  it("counts the contacts in the file", async () => {
    render(<ContactsRoute />);
    await ready();
    expect(screen.getByText("2 contacts")).toBeTruthy();
  });

  it("reports how many of the total a search matched", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "adam");
    await waitFor(() => expect(screen.getByText("1 of 2 contacts")).toBeTruthy());
  });

  it("opens the dialer for a phone and the mail app for an address", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    render(<ContactsRoute />);
    await ready();
    fireEvent.press(screen.getByTestId("contact-0-phone-0"));
    expect(open).toHaveBeenCalledWith("tel:+15550100");
    fireEvent.press(screen.getByTestId("contact-0-email-0"));
    expect(open).toHaveBeenCalledWith("mailto:ada@example.com");
  });

  it("reads a view-only file from /raw rather than presigning it", async () => {
    const { getDownloadUrl } = require("@/files/api");
    mockFile = { ...mockFile, lock_mode: "view_only" };
    render(<ContactsRoute />);
    await ready();
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/files/f1/raw"),
      { headers: { Authorization: "Bearer tok" } },
    );
  });

  it("shows a retry affordance when the fetch fails", async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => "" })) as never;
    render(<ContactsRoute />);
    await waitFor(() => expect(screen.getByTestId("retry-contacts")).toBeTruthy());
  });

  it("bounces a password-locked file back to the detail screen", async () => {
    mockFile = { ...mockFile, lock_mode: "full_lock" };
    render(<ContactsRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
  });

  it("bounces a file too large to parse synchronously", async () => {
    mockFile = { ...mockFile, size_bytes: 20 * 1024 * 1024 };
    render(<ContactsRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
  });
});

describe("searching", () => {
  it("filters to matching contacts", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "adam");
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    expect(screen.getByText("Adam Smith")).toBeTruthy();
  });

  it("matches on phone number and on organisation", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "555-0142");
    await waitFor(() => expect(screen.getByText("Adam Smith")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("contact-search"), "analytical");
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
  });

  it("says so when nothing matches", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "babbage");
    await waitFor(() => expect(screen.getByTestId("contacts-empty")).toBeTruthy());
  });

  it("clears the query", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "babbage");
    await waitFor(() => expect(screen.getByTestId("contacts-empty")).toBeTruthy());
    fireEvent.press(screen.getByTestId("contact-search-clear"));
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
  });
});

describe("editing", () => {
  const startEditing = async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.press(screen.getByTestId("contact-0-edit"));
    await waitFor(() => expect(screen.getByTestId("contact-0-name-input")).toBeTruthy());
  };

  it("offers no save button until something changes", async () => {
    render(<ContactsRoute />);
    await ready();
    expect(screen.queryByTestId("contacts-save")).toBeNull();
  });

  it("edits a phone number and enables saving", async () => {
    await startEditing();
    fireEvent.changeText(screen.getByTestId("contact-0-phone-0-input"), "+1-555-0199");
    await waitFor(() => expect(screen.getByTestId("contacts-save")).toBeTruthy());
  });

  it("saves as a new version of the same file", async () => {
    await startEditing();
    fireEvent.changeText(screen.getByTestId("contact-0-phone-0-input"), "+1-555-0199");
    fireEvent.press(await screen.findByTestId("contacts-save"));
    await waitFor(() => expect(mockUploadOne).toHaveBeenCalled());
    const [item] = mockUploadOne.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(item.versionOfFileId).toBe("f1");
    expect(item.name).toBe("contacts.vcf");
    expect(item.mime).toBe("text/vcard");
  });

  it("writes back the edit while preserving fields the UI never showed", async () => {
    // The whole reason for the lossless document layer: this screen exposes
    // name, phones and emails, but the file also holds a PHOTO blob, an ORG
    // and a NOTE, and saving must not drop them.
    await startEditing();
    fireEvent.changeText(screen.getByTestId("contact-0-phone-0-input"), "+1-555-0199");
    fireEvent.press(await screen.findByTestId("contacts-save"));
    await waitFor(() => expect(mockUploadOne).toHaveBeenCalled());
    expect(writtenText).toContain("TEL;TYPE=CELL:+1-555-0199");
    expect(writtenText).toContain("PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQ");
    expect(writtenText).toContain("ORG:Analytical Engines");
    expect(writtenText).toContain("NOTE:Keep me");
    expect(writtenText).toContain("FN:Adam Smith");
  });

  it("invalidates the cached file so the detail screen sees the new version", async () => {
    await startEditing();
    fireEvent.changeText(screen.getByTestId("contact-0-phone-0-input"), "+1-555-0199");
    fireEvent.press(await screen.findByTestId("contacts-save"));
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["file", "f1"] }));
  });

  it("reports a failed save instead of pretending it worked", async () => {
    mockUploadOne.mockRejectedValueOnce(new Error("Upload failed"));
    await startEditing();
    fireEvent.changeText(screen.getByTestId("contact-0-phone-0-input"), "+1-555-0199");
    fireEvent.press(await screen.findByTestId("contacts-save"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Upload failed", "error"));
    // Still dirty, so the user can retry rather than losing the edit.
    expect(screen.getByTestId("contacts-save")).toBeTruthy();
  });

  it("adds a phone row", async () => {
    await startEditing();
    fireEvent.press(screen.getByTestId("contact-0-add-phone"));
    await waitFor(() => expect(screen.getByTestId("contact-0-phone-1-input")).toBeTruthy());
  });

  it("removes a field", async () => {
    await startEditing();
    fireEvent.press(screen.getByTestId("contact-0-email-0-remove"));
    await waitFor(() => expect(screen.queryByTestId("contact-0-email-0-input")).toBeNull());
  });

  it("adds a contact", async () => {
    render(<ContactsRoute />);
    await ready();
    fireEvent.press(screen.getByTestId("contact-add"));
    await waitFor(() => expect(screen.getByTestId("contact-2")).toBeTruthy());
  });

  it("deletes a contact only after confirmation", async () => {
    await startEditing();
    fireEvent.press(screen.getByTestId("contact-0-delete"));
    fireEvent.press(await screen.findByTestId("confirm"));
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    expect(screen.getByText("Adam Smith")).toBeTruthy();
  });

  it("tells the user their unshown fields are preserved", async () => {
    await startEditing();
    // PHOTO and NOTE are kept but not editable here.
    expect(screen.getByText("2 other fields are kept unchanged")).toBeTruthy();
  });
});

describe("read-only modes", () => {
  it("offers no editing for a view-only file", async () => {
    mockFile = { ...mockFile, lock_mode: "view_only" };
    render(<ContactsRoute />);
    await ready();
    expect(screen.queryByTestId("contact-0-edit")).toBeNull();
    expect(screen.queryByTestId("contact-add")).toBeNull();
    expect(screen.getByTestId("contacts-readonly")).toBeTruthy();
  });

  it("still lets a view-only file be searched", async () => {
    mockFile = { ...mockFile, lock_mode: "view_only" };
    render(<ContactsRoute />);
    await ready();
    fireEvent.changeText(screen.getByTestId("contact-search"), "adam");
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
  });
});
