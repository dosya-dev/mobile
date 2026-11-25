import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FileBrowser } from "./FileBrowser";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorkspaces, useFileList } from "./hooks";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "./viewPrefs";

/**
 * Selection must stay smooth at 1,000 items: a tap re-renders the tapped tile,
 * not every tile on screen. FileThumb renders once per tile render, so a spy
 * inside it counts tile renders.
 */
const mockThumbRender = jest.fn();
jest.mock("./FileThumb", () => ({
  FileThumb: ({ file }: { file: { id: string } }) => {
    mockThumbRender(file.id);
    return null;
  },
}));

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void | (() => void)) => { require("react").useEffect(cb, [cb]); },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("./hooks", () => ({ useWorkspaces: jest.fn(), useFileList: jest.fn(), useFile: jest.fn(), useSearch: jest.fn() }));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ can: () => true, permissions: undefined, userId: "u1", roleId: "role_owner", roleName: "owner", rootFolderId: null }),
}));
jest.mock("@/player/controller", () => ({ playFolder: jest.fn(async () => true), playSingleFile: jest.fn(async () => true) }));
jest.mock("@/library/LibraryBrowser", () => ({ LibraryBrowser: () => null }));

const FILE = (i: number) => ({
  id: `f${i}`, name: `photo-${i}.jpg`, size_bytes: 10, mime_type: "image/jpeg", extension: "jpg", uploaded_by: "u1",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
});
const FILES = Array.from({ length: 300 }, (_, i) => FILE(i));
const LISTING = {
  data: { pages: [{ folders: [], files: FILES, breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
  isLoading: false, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(),
};

it.each(["grid", "list"] as const)("in the %s layout, ticking one of 300 items re-renders about one tile", (viewMode) => {
  useViewPrefs.setState({ viewMode, libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: false });
  useWorkspaceStore.setState({ activeId: "w1" });
  (useWorkspaces as jest.Mock).mockReturnValue({ data: [{ id: "w1", name: "Workspace 1" }], isLoading: false, isPending: false });
  (useFileList as jest.Mock).mockReturnValue(LISTING);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><FileBrowser folderId="src" /></QueryClientProvider>);

  // Into selection mode through the item's actions (a hold on f0 opens them).
  act(() => {
    fireGestureHandler(getByGestureTestId("hold-file-f0"), [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
  });
  fireEvent.press(screen.getByText("Select"));
  expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");

  mockThumbRender.mockClear();
  fireEvent.press(screen.getByText("photo-1.jpg"));
  expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
  expect(mockThumbRender.mock.calls.length).toBeLessThanOrEqual(2);
  expect(mockThumbRender).toHaveBeenCalledWith("f1");
  qc.clear();
});
