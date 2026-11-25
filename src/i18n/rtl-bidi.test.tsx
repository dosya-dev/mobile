/**
 * Bidi at the edges. Standalone names render bare (first-strong direction
 * isolates them already); names inside a sentence are isolated by t(); server
 * text is shown unchanged; left-to-right languages never see a bidi control.
 */
import { Alert } from "react-native";
import { screen } from "@testing-library/react-native";
import { collectTexts, renderInLocale, captureAlerts } from "../../test-utils/i18n-sweep";
import { __resetI18nForTests, t as moduleT } from "@/lib/i18n";
import { FileRow } from "@/files/FileRow";
import { ActivityEntry } from "@/activity/ActivityEntry";
import { ViewerSheet } from "@/viewer/ViewerSheet";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { toast } from "@/ui/toast";
import { scrubEvent } from "@/telemetry/sentry";
import type { ActivityRow } from "@/activity/api";
import type { FileItem } from "@/files/types";

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const FSI = "\u2068";
const PDI = "\u2069";
const NOW = 1_800_000_000;

const file = (name: string): FileItem => ({
  id: "f1", name, size_bytes: 1024, mime_type: "application/pdf", extension: "pdf",
  created_at: 1700000000, updated_at: 1700000000, current_version: 1,
  lock_mode: "none", share_count: 0, comment_count: 0,
} as FileItem);

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1", action: "file_uploaded", category: "files",
  entity_type: "file", entity_id: "f1", resource_name: "report (1).pdf", entity_name: "report (1).pdf",
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null,
  session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com",
  created_at: NOW - 3600, ...over,
});

afterEach(() => {
  __resetI18nForTests();
  jest.restoreAllMocks();
});

describe("file rows", () => {
  it.each(["report (1).pdf", "גיבוי 2026 (final).zip"])("renders %s bare in Arabic", async (name) => {
    await renderInLocale(<FileRow file={file(name)} onPress={() => {}} />, "ar");
    const texts = collectTexts();
    // The name is its own Text: bare, with nothing added around it.
    expect(texts).toContain(name);
    expect(screen.getByText(name).props.children).toBe(name);
  });
});

// Seen on device in Arabic: the viewer's "166 B  ·  أرشيف ZIP  ·  22 أكتوبر"
// read "ZIP · 22" as one left-to-right run, so the date's day sat on the
// wrong side of the separator. The line goes through rtlLine like the rows.
describe("viewer meta line", () => {
  const meta = ["166 B", "أرشيف ZIP", "22 أكتوبر، 2026"];
  const sheet = <ViewerSheet visible expanded={false} onToggleExpanded={() => {}} name="x.zip" meta={meta}>{null}</ViewerSheet>;

  it("gets a right-to-left base and marked separators in Arabic", async () => {
    await renderInLocale(sheet, "ar");
    expect(screen.getByTestId("viewer-meta").props.children).toBe(
      "\u200F166 B \u200F · \u200F أرشيف ZIP \u200F · \u200F 22 أكتوبر، 2026",
    );
  });

  it("is unchanged in English", async () => {
    await renderInLocale(sheet, "en");
    expect(screen.getByTestId("viewer-meta").props.children).toBe("166 B  ·  أرشيف ZIP  ·  22 أكتوبر، 2026");
  });
});

describe("server text", () => {
  it("shows an English server error in a toast unchanged in Arabic", async () => {
    await renderInLocale(<></>, "ar");
    const alerts = captureAlerts();
    toast("Network request failed", "error");
    expect(alerts.calls[0].message).toBe("Network request failed");
    expect(alerts.calls[0].message).not.toMatch(BIDI);
    alerts.restore();
  });
});

describe("activity sentence", () => {
  it("isolates a Latin file name inside the sentence in Arabic", async () => {
    await renderInLocale(<ThemeProvider><ActivityEntry row={row()} now={NOW} /></ThemeProvider>, "ar");
    const label = screen.getByTestId("activity-a1").props.accessibilityLabel as string;
    expect(label).toContain(`${FSI}report (1).pdf${PDI}`);
    expect(label).toContain(`${FSI}Ada${PDI}`);
  });
});

describe("an error built from t() in Arabic", () => {
  it("is isolated for display and clean once Sentry scrubs it", async () => {
    await renderInLocale(<></>, "ar");
    const message = moduleT("common.error.failedToResolveFolderName", { name: "My Folder (2)" });
    expect(message).toContain(`${FSI}My Folder (2)${PDI}`);
    const sent = scrubEvent({ exception: { values: [{ value: message }] } });
    expect(sent.exception?.values?.[0]?.value).not.toMatch(BIDI);
    expect(sent.exception?.values?.[0]?.value).toContain("My Folder (2)");
  });
});

describe.each(["en", "de"] as const)("%s", (locale) => {
  it("has no bidi control on the same screens", async () => {
    await renderInLocale(
      <ThemeProvider>
        <FileRow file={file("report (1).pdf")} onPress={() => {}} />
        <ActivityEntry row={row()} now={NOW} />
      </ThemeProvider>,
      locale,
    );
    const texts = collectTexts();
    expect(texts.join("")).not.toMatch(BIDI);
    expect(texts).toContain("report (1).pdf");
    expect(screen.getByTestId("activity-a1").props.accessibilityLabel).not.toMatch(BIDI);
    expect(moduleT("common.error.failedToResolveFolderName", { name: "x (1)" })).not.toMatch(BIDI);
    expect(Alert).toBeTruthy();
  });
});
