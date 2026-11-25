import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActivityScreen from "./activity";
import { listActivity, NO_FILTERS, type ActivityPage, type ActivityRow } from "@/activity/api";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
// Only the request is mocked. NO_FILTERS and hasAnyFilter are pure and the
// screen's header reads them - stubbing them out would test a screen that
// cannot tell a filtered feed from an unfiltered one.
jest.mock("@/activity/api", () => ({
  ...jest.requireActual("@/activity/api"),
  listActivity: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));

const mockList = listActivity as jest.MockedFunction<typeof listActivity>;

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, action: "file_uploaded", category: "files",
  entity_type: "file", entity_id: `f_${id}`, resource_name: `${id}.pdf`, entity_name: `${id}.pdf`,
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null,
  session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com",
  created_at: Math.floor(Date.now() / 1000), ...over,
});

const MEMBERS = [{ id: "u1", name: "Ada", email: "ada@x.com" }, { id: "u2", name: "Bob", email: "b@x.com" }];

/** A page with the members and total the screen's header and filter need. */
const page = (activities: ActivityRow[], over: Partial<ActivityPage> = {}): ActivityPage => ({
  activities, members: MEMBERS, total: activities.length, hasMore: false, ...over,
});

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0}, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><ActivityScreen /></QueryClientProvider>);
}

describe("ActivityScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue(page([row("a1"), row("a2")]));
  });

  it("lists the activity rows", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(screen.getByTestId("activity-a2")).toBeTruthy();
  });

  it("shows an empty state rather than a blank screen", async () => {
    mockList.mockResolvedValue(page([]));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeTruthy());
  });

  it("hides Load older when there is no further page", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    expect(screen.queryByTestId("activity-load-more")).toBeNull();
  });

  it("appends the next page instead of replacing the list", async () => {
    mockList
      .mockResolvedValueOnce(page([row("a1")], { total: 2, hasMore: true }))
      .mockResolvedValueOnce(page([row("a2")], { total: 2 }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("activity-load-more"));
    await waitFor(() => expect(screen.getByTestId("activity-a2")).toBeTruthy());
    // The first page must still be there - replacing it would make paging feel
    // like the list jumping around under the reader.
    expect(screen.getByTestId("activity-a1")).toBeTruthy();
  });

  it("keeps the rows it already has when a page fails", async () => {
    mockList
      .mockResolvedValueOnce(page([row("a1")], { total: 2, hasMore: true }))
      .mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("activity-load-more"));
    await waitFor(() => expect(screen.getByTestId("activity-error")).toBeTruthy());
    expect(screen.getByTestId("activity-a1")).toBeTruthy();
  });

  it("counts the whole filtered set, not the rows on screen", async () => {
    mockList.mockResolvedValue(page([row("a1")], { total: 340, hasMore: true }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-count")).toHaveTextContent(/340 activities/));
    expect(screen.getByTestId("activity-count")).not.toHaveTextContent(/filtered/);
  });

  it("refetches from page one when a filter is applied, and says the count is filtered", async () => {
    // A filtered feed is a different feed: appending it to the unfiltered
    // pages already loaded would mix the two.
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    mockList.mockClear();
    mockList.mockResolvedValue(page([row("a3")], { total: 1 }));

    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith("w1", 1, {
      categories: ["folders"], actions: [], userIds: [],
    }));
    await waitFor(() => expect(screen.getByTestId("activity-count")).toHaveTextContent(/\(filtered\)/));
  });

  it("shows how many filters are on", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    // Unfiltered: the button is just "Filter", with no count beside it.
    expect(screen.getByTestId("activity-filter-open")).not.toHaveTextContent(/·/);
    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-files"));
    fireEvent.press(screen.getByTestId("activity-filter-category-folders"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));
    await waitFor(() => expect(screen.getByTestId("activity-filter-open")).toHaveTextContent(/Filters · 2/));
  });

  it("offers a way out of an empty filtered feed, not just the bad news", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    mockList.mockResolvedValue(page([], { total: 0 }));

    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-comments"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));

    await waitFor(() => expect(screen.getByTestId("activity-empty")).toHaveTextContent(/Nothing matches these filters/));
    mockList.mockResolvedValue(page([row("a1")]));
    fireEvent.press(screen.getByTestId("activity-clear-filters"));
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
  });

  it("keeps the member list when a filter returns nothing", async () => {
    // The members arrive on the feed response, so a filter matching no rows
    // would otherwise empty the very filter that has to undo it.
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    mockList.mockResolvedValue({ activities: [], members: [], total: 0, hasMore: false });

    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-category-comments"));
    fireEvent.press(screen.getByTestId("activity-filter-apply"));
    await waitFor(() => expect(screen.getByTestId("activity-empty")).toBeTruthy());

    fireEvent.press(screen.getByTestId("activity-filter-open"));
    fireEvent.press(screen.getByTestId("activity-filter-members"));
    expect(screen.getByTestId("activity-filter-member-u1")).toBeTruthy();
  });

  it("sends nothing when the feed is unfiltered", async () => {
    renderScreen();
    await waitFor(() => expect(mockList).toHaveBeenCalledWith("w1", 1, NO_FILTERS));
  });

  it("offers a retry after a failed page, not a dead end", async () => {
    mockList
      .mockResolvedValueOnce(page([row("a1")], { total: 2, hasMore: true }))
      .mockRejectedValueOnce(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("activity-a1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("activity-load-more"));
    await waitFor(() => expect(screen.getByTestId("activity-error")).toBeTruthy());
    expect(screen.getByTestId("activity-load-more")).toBeTruthy();
  });
});
