/**
 * Core-screen sweep: the activity feed in tr, de, pl and zh-Hans with no
 * leftover English. Mocks follow ../a.test.tsx.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import ActivityScreen from "../../../../app/activity";
import { listActivity, type ActivityPage, type ActivityRow } from "@/activity/api";
import { __resetI18nForTests } from "@/lib/i18n";
import { renderInLocale } from "../../../../test-utils/i18n-sweep";
import { SWEEP_LOCALES } from "./locales";

jest.mock("expo-router", () => require("../../../../test-utils/i18n-sweep").routerMockWithTitles());
jest.mock("@/activity/api", () => ({
  ...jest.requireActual("@/activity/api"),
  listActivity: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));

const mockList = listActivity as jest.MockedFunction<typeof listActivity>;
const NOW = Math.floor(Date.now() / 1000);

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, action: "file_uploaded", category: "files",
  entity_type: "file", entity_id: `f_${id}`, resource_name: `${id}.pdf`, entity_name: `${id}.pdf`,
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null,
  session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com",
  created_at: NOW - 3600, ...over,
});
const FULL_ROW = row("full", {
  action: "file_renamed",
  outcome: "denied",
  source: "mobile",
  on_behalf_of: "u9",
  obo_name: "Bob",
  source_ip: "1.2.3.4",
  user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Chrome/120.0",
  session_id: "sess1",
  meta: { old_name: "a", new_name: "b", file_count: 3, via: "api", reason: "no access", geo: { city: "Izmir", country: "TR" } },
});
const page = (activities: ActivityRow[], over: Partial<ActivityPage> = {}): ActivityPage => ({
  activities, members: [{ id: "u1", name: "Ada", email: "ada@x.com" }], total: activities.length, hasMore: false, ...over,
});

function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  mockList.mockResolvedValue(page([row("a1"), FULL_ROW, row("a3", { action: "member_joined" })], { total: 3 }));
});

describe.each(SWEEP_LOCALES)("Activity in %s", (locale) => {
  it("the feed, an expanded event and the filter sheet", async () => {
    const view = await renderInLocale(withQuery(<ActivityScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("activity-full"));
    expect(screen.getByTestId("activity-detail-full")).toBeTruthy();
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-members"));
    fireEvent.press(screen.getByTestId("activity-filter-actions"));
    expect(view.leftover()).toEqual([]);
  });

  it("the empty and the filtered states", async () => {
    mockList.mockResolvedValue(page([]));
    const view = await renderInLocale(withQuery(<ActivityScreen />), locale);
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-files"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));
    await waitFor(() => expect(screen.getByTestId("activity-clear-filters")).toBeTruthy());
    expect(view.leftover()).toEqual([]);
  });
});
