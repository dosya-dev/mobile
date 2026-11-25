import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import CalendarRoute from "./calendar";

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
const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));
const mockSave = jest.fn(async (_p: object) => ({ kind: "saved" }));
jest.mock("@/files/saveToDevice", () => ({
  SaveCancelled: class extends Error {},
  saveToDevice: (p: object) => mockSave(p),
  saveOutcomeMessage: () => "Saved",
}));

const ICS = [
  "BEGIN:VCALENDAR", "X-WR-CALNAME:Personal",
  "BEGIN:VEVENT", "UID:a", "SUMMARY:Team standup", "DTSTART:20990105T090000Z", "DTEND:20990105T093000Z", "END:VEVENT",
  "BEGIN:VEVENT", "UID:b", "SUMMARY:Dentist", "DTSTART;VALUE=DATE:20990107", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const serve = (body: string, ok = true) => {
  global.fetch = jest.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => body })) as never;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFile = {
    id: "f1", name: "Personal.ics", mime_type: "text/calendar", extension: ".ics",
    size_bytes: ICS.length, current_version: 1, lock_mode: "none",
  };
  serve(ICS);
});

describe("calendar route", () => {
  it("reads the file into an agenda", async () => {
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("calendar-agenda")).toBeTruthy());
    expect(screen.getByText("Team standup")).toBeTruthy();
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledWith("https://r2/presigned", undefined);
  });

  it("reads a view-only file from /raw rather than presigning it", async () => {
    const { getDownloadUrl } = require("@/files/api");
    mockFile = { ...mockFile, lock_mode: "view_only" };
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("calendar-agenda")).toBeTruthy());
    expect(getDownloadUrl).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/files/f1/raw"), { headers: { Authorization: "Bearer tok" } });
  });

  it("shows the loading state first and parses after it", async () => {
    render(<CalendarRoute />);
    expect(screen.getByText("Loading calendar…")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("calendar-agenda")).toBeTruthy());
  });

  it("reads a calendar over the text cap, and shows its source as the too-large card with Save", async () => {
    mockFile = { ...mockFile, name: "Takeout.ics", size_bytes: 3 * 1024 * 1024 };
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("calendar-agenda")).toBeTruthy());
    expect(screen.getByText("Dentist")).toBeTruthy();
    fireEvent.press(screen.getByTestId("calendar-tab-source"));
    expect(screen.getByTestId("calendar-source-too-large")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VEVENT/)).toBeNull();
    fireEvent.press(screen.getByTestId("calendar-source-save"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ localUri: "file:///cache/Takeout.ics", fileName: "Takeout.ics" })));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Saved"));
  });

  it("keeps the text stage as the source under the text cap", async () => {
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("calendar-agenda")).toBeTruthy());
    fireEvent.press(screen.getByTestId("calendar-tab-source"));
    expect(screen.queryByTestId("calendar-source-too-large")).toBeNull();
    expect(screen.getAllByText(/BEGIN:VEVENT/).length).toBeGreaterThan(0);
  });

  it("falls back to the text for a file with no events", async () => {
    serve("just some text");
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("calendar-fallback")).toBeTruthy());
    expect(screen.getByText("just some text")).toBeTruthy();
  });

  it("offers a retry when the fetch fails", async () => {
    serve("", false);
    render(<CalendarRoute />);
    await waitFor(() => expect(screen.getByTestId("retry-calendar")).toBeTruthy());
  });

  it("bounces a password-locked or oversize file back to the detail screen", async () => {
    mockFile = { ...mockFile, lock_mode: "full_lock" };
    const first = render(<CalendarRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
    first.unmount();
    mockReplace.mockClear();
    mockFile = { ...mockFile, lock_mode: "none", size_bytes: 20 * 1024 * 1024 };
    render(<CalendarRoute />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/file/f1"));
  });
});
