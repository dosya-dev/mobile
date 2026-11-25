import { fireEvent, render, screen } from "@testing-library/react-native";
import { ActivityEntry } from "./ActivityEntry";
import { ThemeProvider } from "@/theme/ThemeProvider";
import type { ActivityRow } from "./api";
import { renderInLocale } from "../../test-utils/i18n-sweep";

const NOW = 1_800_000_000;

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1", action: "file_uploaded", category: "files",
  entity_type: "file", entity_id: "f1", resource_name: "report.pdf", entity_name: "report.pdf",
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null,
  session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com",
  created_at: NOW - 3600, ...over,
});

const renderRow = (over: Partial<ActivityRow> = {}) =>
  render(<ThemeProvider><ActivityEntry row={row(over)} now={NOW} /></ThemeProvider>);

describe("the sentence", () => {
  it("reads actor, verb, subject", () => {
    renderRow();
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText(" uploaded")).toBeTruthy();
    expect(screen.getByText(" report.pdf")).toBeTruthy();
  });

  it("falls back to the older entity_name when the audit row has no resource_name", () => {
    // Names are stripped server-side for items this viewer cannot open, and
    // older rows only ever carried entity_name.
    renderRow({ resource_name: null });
    expect(screen.getByText(" report.pdf")).toBeTruthy();
  });

  it("still reads as a sentence with no subject and no actor at all", () => {
    renderRow({ resource_name: null, entity_name: null, user_name: null, meta: null });
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText(" uploaded")).toBeTruthy();
  });
});

describe("the sentence in a right-to-left language", () => {
  // The names are spans of their own, not t() values, so t()'s isolation never
  // reached them: on the simulator "Local Test" and "report (1).pdf" ran together
  // into one left-to-right phrase inside the Arabic sentence.
  // The locale store is module-wide: leave it in English for the blocks below.
  afterAll(async () => { await renderInLocale(<></>, "en"); });
  const texts = (): string[] =>
    screen.UNSAFE_root
      .findAll((n: { props: { children?: unknown } }) => typeof n.props.children === "string")
      .map((n: { props: { children?: unknown } }) => n.props.children as string);

  it("isolates the actor and the subject in ar", async () => {
    await renderInLocale(<ThemeProvider><ActivityEntry row={row({ action: "file_downloaded", user_name: "Local Test", resource_name: "report (1).pdf" })} now={NOW} /></ThemeProvider>, "ar");
    expect(texts()).toContain("\u2068Local Test\u2069");
    expect(texts().some((x) => x.trim() === "\u2068report (1).pdf\u2069")).toBe(true);
  });

  it("adds no bidi control in de", async () => {
    await renderInLocale(<ThemeProvider><ActivityEntry row={row({ action: "file_downloaded", user_name: "Local Test", resource_name: "report (1).pdf" })} now={NOW} /></ThemeProvider>, "de");
    expect(texts().join("")).not.toMatch(/[\u2066-\u2069]/);
    expect(texts()).toContain("Local Test");
  });
});

describe("badges", () => {
  it("says nothing extra about an ordinary successful web action", () => {
    renderRow();
    expect(screen.queryByText("success")).toBeNull();
    expect(screen.queryByText("web")).toBeNull();
  });

  it("calls out a failure, a non-web client, and acting on someone's behalf", () => {
    renderRow({ outcome: "denied", source: "mobile", on_behalf_of: "u9", obo_name: "Bob" });
    expect(screen.getByText("denied")).toBeTruthy();
    expect(screen.getByText("mobile")).toBeTruthy();
    expect(screen.getByText("on behalf of Bob")).toBeTruthy();
  });

  it("shows a rename as old → new", () => {
    renderRow({ action: "file_renamed", meta: { old_name: "a.pdf", new_name: "b.pdf" } });
    expect(screen.getByText("a.pdf → b.pdf")).toBeTruthy();
  });

  it("shows a batch count but not a count of one", () => {
    renderRow({ meta: { file_count: 12 } });
    expect(screen.getByText("12 files")).toBeTruthy();
    screen.unmount();
    renderRow({ meta: { file_count: 1 } });
    expect(screen.queryByText("1 files")).toBeNull();
  });

  it("ignores metadata of the wrong shape rather than rendering it", () => {
    // meta is parsed from a free-form JSON column; a number where a string
    // belongs must not reach the UI as "[object Object]" or crash it.
    renderRow({ meta: { old_name: 7, new_name: 9, via: { nested: true }, file_count: "many" } });
    expect(screen.queryByText(/7/)).toBeNull();
    expect(screen.queryByText(/via/)).toBeNull();
  });
});

describe("the detail", () => {
  it("stays closed until the row is tapped, and closes again", () => {
    renderRow();
    expect(screen.queryByTestId("activity-detail-a1")).toBeNull();
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.getByTestId("activity-detail-a1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.queryByTestId("activity-detail-a1")).toBeNull();
  });

  it("shows where and on what device, when the viewer is allowed those", () => {
    renderRow({
      source_ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36",
      meta: { geo: { city: "Berlin", country: "DE" } },
      session_id: "sess_123",
    });
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.getByText("203.0.113.7 · Berlin, DE")).toBeTruthy();
    expect(screen.getByText("Chrome 120 · macOS")).toBeTruthy();
    expect(screen.getByText("sess_123")).toBeTruthy();
  });

  it("omits the forensic rows the API scrubbed, without leaving blanks", () => {
    // A non-privileged viewer looking at someone else's row gets these as
    // null. The row renders what survived rather than deciding for itself.
    renderRow({ source_ip: null, user_agent: null, session_id: null });
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.getByTestId("activity-detail-a1")).toBeTruthy();
    expect(screen.queryByText("Where")).toBeNull();
    expect(screen.queryByText("Device")).toBeNull();
    expect(screen.queryByText("Session")).toBeNull();
    expect(screen.getByText("When")).toBeTruthy();
  });

  it("names the resource even when the row carries only a type and an id", () => {
    renderRow({ resource_name: null, entity_name: null, entity_type: "folder", entity_id: "d7" });
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.getByText("folder d7")).toBeTruthy();
  });

  it("explains a failure with its reason", () => {
    renderRow({ outcome: "denied", meta: { reason: "no permission" } });
    fireEvent.press(screen.getByTestId("activity-a1"));
    expect(screen.getByText("denied (no permission)")).toBeTruthy();
  });
});
