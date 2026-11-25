import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Linking, Text } from "react-native";
import { CalendarView } from "./CalendarView";
import { readCalendar } from "./calendarRead";

let written: { path: string; text: string } | null = null;
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async (path: string, text: string) => { written = { path, text }; }),
}));
const mockShare = jest.fn(async (_uri: string, _opts?: object) => {});
jest.mock("@/files/download", () => ({ shareFile: (uri: string, opts?: object) => mockShare(uri, opts) }));
const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const ics = (...lines: string[]) => ["BEGIN:VCALENDAR", "X-WR-CALNAME:Personal", ...lines, "END:VCALENDAR"].join("\r\n");

// Dates far ahead, so "today" never passes them and the agenda opens on them.
const CALENDAR = ics(
  "BEGIN:VEVENT", "UID:a", "SUMMARY:Team standup", "DTSTART:20990105T090000Z", "DTEND:20990105T093000Z",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=10", "LOCATION:Room 4",
  "ORGANIZER;CN=Priya Shah:mailto:priya@example.com",
  "ATTENDEE;PARTSTAT=ACCEPTED;CN=Alex Morgan:mailto:alex@example.com",
  "DESCRIPTION:Join https://meet.google.com/abc-defg-hij",
  "BEGIN:VALARM", "TRIGGER:-PT10M", "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT", "UID:b", "SUMMARY:Dentist", "DTSTART;VALUE=DATE:20990107", "DTEND;VALUE=DATE:20990108", "END:VEVENT",
);
const SINGLE = ics("BEGIN:VEVENT", "UID:x", "SUMMARY:Flight QF 512", "DTSTART:20990301T204000Z", "DTEND:20990301T221500Z", "LOCATION:Gate 9", "END:VEVENT");

function show(text: string, opts: { name?: string; canExport?: boolean } = {}) {
  const parsed = readCalendar(text);
  if (!parsed) throw new Error("fixture has no events");
  return render(
    <CalendarView
      parsed={parsed}
      text={text}
      fileName={opts.name ?? "Personal.ics"}
      source={<Text testID="source">SOURCE</Text>}
      canExport={opts.canExport ?? true}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  written = null;
});

describe("CalendarView", () => {
  it("lists events as an agenda under the calendar name, count and span", () => {
    show(CALENDAR);
    expect(screen.getByTestId("calendar-name").props.children).toBe("Personal");
    expect(screen.getByTestId("calendar-sub").props.children).toContain("2 events");
    expect(screen.getAllByText("Team standup").length).toBeGreaterThan(0);
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.getByText("All day")).toBeTruthy();
    expect(screen.queryByText(/BEGIN:VEVENT/)).toBeNull();
  });

  it("opens the agenda at today, not at the first event in the file", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2099, 0, 10, 12));
    try {
      show(CALENDAR);
      const list = screen.getByTestId("calendar-agenda");
      const at = list.props.data[list.props.initialScrollIndex];
      // The first event on or after Saturday 10 January is Monday's standup.
      expect(at).toMatchObject({ kind: "event", day: "2099-01-12" });
    } finally {
      now.mockRestore();
    }
  });

  it("opens an event in a sheet with its repeat, guests, reminder and call link", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    show(CALENDAR);
    fireEvent.press(screen.getByTestId("calendar-event-0"));
    const sheet = within(screen.getByTestId("calendar-event-sheet"));
    expect(sheet.getByText("Every weekday, 10 times")).toBeTruthy();
    expect(sheet.getByText("Priya Shah")).toBeTruthy();
    expect(sheet.getByText("Organizer")).toBeTruthy();
    expect(sheet.getByText("Going")).toBeTruthy();
    expect(sheet.getByText("Reminder 10 minutes before")).toBeTruthy();
    fireEvent.press(sheet.getByTestId("calendar-join-call"));
    expect(open).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij");
    fireEvent.press(sheet.getByTestId("calendar-location"));
    expect(open).toHaveBeenCalledWith("https://maps.google.com/?q=Room%204");
    fireEvent.press(sheet.getByTestId("calendar-add-google"));
    expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Team\+standup/));
  });

  it("shares the one event as its own .ics", async () => {
    show(CALENDAR);
    fireEvent.press(screen.getByTestId("calendar-event-0"));
    fireEvent.press(screen.getByTestId("calendar-share-event"));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    expect(mockShare).toHaveBeenCalledWith("file:///cache/Team standup.ics", expect.objectContaining({ mimeType: "text/calendar", UTI: "com.apple.ical.ics" }));
    expect(written?.text).toContain("SUMMARY:Team standup");
    expect(written?.text).not.toContain("SUMMARY:Dentist");
  });

  it("offers no export for a view-only file", () => {
    show(CALENDAR, { canExport: false });
    fireEvent.press(screen.getByTestId("calendar-event-0"));
    expect(screen.getByTestId("calendar-add-google")).toBeTruthy();
    expect(screen.queryByTestId("calendar-share-event")).toBeNull();
  });

  it("filters by search, and says when nothing matches", () => {
    show(CALENDAR);
    fireEvent.changeText(screen.getByTestId("calendar-search"), "dent");
    expect(screen.getByText("Dentist")).toBeTruthy();
    expect(screen.queryByText("Team standup")).toBeNull();
    fireEvent.changeText(screen.getByTestId("calendar-search"), "zzz");
    expect(screen.getByTestId("calendar-empty")).toBeTruthy();
  });

  it("switches to a month grid with prev and next, and to the source", () => {
    show(CALENDAR);
    fireEvent.press(screen.getByTestId("calendar-tab-month"));
    expect(screen.getByTestId("calendar-month")).toBeTruthy();
    fireEvent.press(screen.getByTestId("calendar-next-month"));
    fireEvent.press(screen.getByTestId("calendar-prev-month"));
    fireEvent.press(screen.getByTestId("calendar-prev-month"));
    fireEvent.press(screen.getByTestId("calendar-tab-source"));
    expect(screen.getByTestId("source")).toBeTruthy();
  });

  it("puts a day's events under the month grid", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2099, 0, 1, 12));
    try {
      show(CALENDAR);
      fireEvent.press(screen.getByTestId("calendar-tab-month"));
      expect(screen.getByTestId("calendar-month-label").props.children).toBe("January 2099");
      fireEvent.press(screen.getByTestId("calendar-next-month"));
      expect(screen.getByTestId("calendar-month-label").props.children).toBe("February 2099");
      fireEvent.press(screen.getByTestId("calendar-prev-month"));
      fireEvent.press(screen.getByTestId("calendar-day-2099-01-07"));
      expect(screen.getByText("Dentist")).toBeTruthy();
    } finally {
      now.mockRestore();
    }
  });

  it("shows a file with one event as a card with its actions", () => {
    show(SINGLE, { name: "invite.ics" });
    expect(screen.getByTestId("calendar-single")).toBeTruthy();
    expect(screen.getByText("Flight QF 512")).toBeTruthy();
    expect(screen.getByText("Gate 9")).toBeTruthy();
    expect(screen.getByText("Add to Google Calendar")).toBeTruthy();
    expect(screen.getByTestId("calendar-tab-details")).toBeTruthy();
    fireEvent.press(screen.getByTestId("calendar-tab-source"));
    expect(screen.getByTestId("source")).toBeTruthy();
  });
});
