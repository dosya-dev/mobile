import { render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddToGroupSheet } from "./AddToGroupSheet";
import { getGroups } from "./api";

jest.mock("./api", () => ({
  getGroups: jest.fn(async () => []),
  createGroup: jest.fn(),
  addFolderToGroup: jest.fn(),
  addFileToGroup: jest.fn(),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

/** A three-button Android navigation bar - the case that swallowed the last row. */
const NAV_BAR = 48;

// gcTime: 0 keeps jest from holding the cache timer open.
let qc: QueryClient;
function renderSheet() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: NAV_BAR, left: 0, right: 0 }}>
      <QueryClientProvider client={qc}>
        <AddToGroupSheet
          target={{ kind: "file", id: "f1", name: "song.mp3" }}
          workspaceId="w1"
          visible
          onClose={() => {}}
        />
      </QueryClientProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

afterEach(() => qc?.clear());

it("keeps its last row clear of the Android navigation bar", async () => {
  (getGroups as jest.Mock).mockResolvedValue([
    { id: "g1", name: "Road trip", color: "#22c55e", sort_order: 0, created_at: 0, folders: [], files: [] },
  ]);
  renderSheet();
  // The sheet is a Modal: it renders in its own window, outside any
  // SafeAreaView, so a fixed pb-8 (32dp) left "New group…" - the row nearest
  // the thumb, and the one a first-time user needs - behind the bar.
  await waitFor(() => expect(screen.getByTestId("add-to-group-g1")).toBeTruthy());
  const style = StyleSheet.flatten(screen.getByTestId("add-to-group-sheet").props.style);
  expect(style.paddingBottom).toBeGreaterThan(NAV_BAR);
});
