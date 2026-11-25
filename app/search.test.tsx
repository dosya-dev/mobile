// /search: the content results beside the name search, and - where this
// phone's Personas is ready and this role may see files - the people whose
// name starts with the typed text, each with "Go to person". The names come
// from the engine on this phone; nothing about people is asked of a server.
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SearchScreen, { PEOPLE_DEBOUNCE_MS } from "./search";
import { useSearch, useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useContentSearch, type ContentState } from "@/ai-search/useContentSearch";
import { card, fakeHost, READY } from "@/personas/device/__fixtures__/fake-host";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string | string[]> = {};
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => { jest.requireActual("react").useEffect(cb, [cb]); },
}));
jest.mock("@/files/hooks", () => ({ useSearch: jest.fn(), useWorkspaces: jest.fn(), useRegions: jest.fn(() => ({ data: [] })) }));
jest.mock("@/ai-search/useContentSearch", () => ({ useContentSearch: jest.fn() }));
jest.mock("@/personas/device/engine-host", () => require("@/personas/device/__fixtures__/fake-host"));
jest.mock("@/personas/device/teardown", () => ({ personasUser: () => "u1", subscribePersonasUser: () => () => undefined }));
jest.mock("@/api/config", () => ({ API_BASE_URL: "https://api.test" }));
jest.mock("@/auth/authStore", () => ({ getAccessToken: () => "tok" }));
let mockPermissions: Record<string, boolean> | undefined = { access_files: true };
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ permissions: mockPermissions, can: (p: string) => (mockPermissions ? mockPermissions[p] ?? false : true) }),
}));
jest.mock("@/files/FileRow", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return { FileRow: ({ file, onPress }: { file: { id: string; name: string }; onPress: () => void }) => (
    <Pressable testID={`file-${file.id}`} onPress={onPress}><Text>{file.name}</Text></Pressable>
  ) };
});
jest.mock("@/files/FolderRow", () => ({ FolderRow: () => null }));

const mockUseSearch = useSearch as jest.Mock;
const mockContent = useContentSearch as jest.Mock;

const hit = (over: Record<string, unknown> = {}) => ({
  id: "c1", name: "invoice.pdf", size_bytes: 1, mime_type: "application/pdf", extension: "pdf", created_at: 1, updated_at: 1,
  current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0, score: 1, snippet: "total due", page: 3, source: "both", ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockPermissions = { access_files: true };
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1" }] });
  mockUseSearch.mockReturnValue({ data: { files: [], folders: [] }, isFetching: false });
  mockContent.mockReturnValue({ state: "hidden" });
  fakeHost.reset(READY);
  fakeHost.engine.personas = [card("p1", "Alex", { photo_count: 412 }), card("p2", "Alana"), card("p3", null)];
});
afterEach(async () => { await act(async () => {}); });

function typeQuery(q: string, content: ContentState) {
  mockContent.mockReturnValue(content);
  render(<SearchScreen />);
  fireEvent.changeText(screen.getByTestId("search-input"), q);
}

/** Type, then let the people debounce and the engine's status settle. */
async function typeAndSettle(q: string) {
  fireEvent.changeText(screen.getByTestId("search-input"), q);
  await act(async () => { await new Promise((r) => setTimeout(r, PEOPLE_DEBOUNCE_MS + 20)); });
}

describe("name search with content results (unchanged)", () => {
  it("hides the section when the workspace has no AI search", () => {
    typeQuery("invoice", { state: "hidden" });
    expect(screen.queryByTestId("content-results")).toBeNull();
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("shows content hits with their snippet and page, and opens the file", () => {
    typeQuery("total", { state: "ok", files: [hit()] as never });
    expect(screen.getByText("In file contents")).toBeTruthy();
    expect(screen.queryByText("No results")).toBeNull();
    expect(screen.getByText(/total due/)).toBeTruthy();
    expect(screen.getByText(/p\. 3/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("file-c1"));
    expect(mockPush).toHaveBeenCalledWith("/file/c1");
  });

  it("does not print an image's index text under it", () => {
    typeQuery("beach", { state: "ok", files: [hit({ id: "i1", name: "IMG_1.jpg", mime_type: "image/jpeg", snippet: "A beach at sunset" })] as never });
    expect(screen.getByTestId("file-i1")).toBeTruthy();
    expect(screen.queryByText(/A beach at sunset/)).toBeNull();
  });

  it("shows the busy line while retrying", () => {
    typeQuery("x1", { state: "busy" });
    expect(screen.getByText("Content search is busy, retrying")).toBeTruthy();
  });

  it("leaves content out of the Folders tab", () => {
    typeQuery("total", { state: "ok", files: [hit()] as never });
    fireEvent.press(screen.getByTestId("search-tab-folders"));
    expect(screen.queryByTestId("content-results")).toBeNull();
  });
});

describe("People", () => {
  it("offers the named people whose name starts with two or more letters, each with Go to person", async () => {
    render(<SearchScreen />);
    await typeAndSettle("A");
    expect(screen.queryByTestId("people-suggestions")).toBeNull();
    await typeAndSettle("Al");
    expect(fakeHost.engine.findByName).toHaveBeenLastCalledWith("Al", 5);
    expect(screen.getByTestId("people-suggestions")).toBeTruthy();
    expect(screen.getByTestId("people-suggestion-p1")).toBeTruthy();
    expect(screen.getByTestId("people-suggestion-p2")).toBeTruthy();
    expect(screen.queryByTestId("people-suggestion-p3")).toBeNull();
    expect(screen.getAllByText("Go to person")).toHaveLength(2);
    fireEvent.press(screen.getByTestId("people-suggestion-p1"));
    expect(mockPush).toHaveBeenCalledWith("/personas/p1");
  });

  it("shows nobody while this phone's Personas is not ready, or cannot be made", async () => {
    fakeHost.set({ status: { state: "needs_unlock" } });
    const { unmount } = render(<SearchScreen />);
    await typeAndSettle("Al");
    expect(screen.queryByTestId("people-suggestions")).toBeNull();
    unmount();
    fakeHost.set({ engine: null });
    render(<SearchScreen />);
    await typeAndSettle("Al");
    expect(screen.queryByTestId("people-suggestions")).toBeNull();
  });

  it("asks nothing about people for a role that may not see files, or while the permissions are unknown", async () => {
    mockPermissions = { access_files: false };
    const { unmount } = render(<SearchScreen />);
    await typeAndSettle("Al");
    expect(fakeHost.engine.findByName).not.toHaveBeenCalled();
    unmount();
    mockPermissions = undefined;
    render(<SearchScreen />);
    await typeAndSettle("Al");
    expect(fakeHost.engine.findByName).not.toHaveBeenCalled();
  });

  it("an old person= link is a plain search: no person filter is sent anywhere", async () => {
    mockParams = { person: "p1", q: "beach" };
    render(<SearchScreen />);
    await act(async () => {});
    expect(screen.getByTestId("search-input").props.value).toBe("beach");
    expect(mockContent).toHaveBeenCalledWith("w1", "beach");
  });
});
