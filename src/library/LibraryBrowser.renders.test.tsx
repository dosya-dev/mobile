import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { LibraryBrowser } from "./LibraryBrowser";
import { useLibrary } from "./hooks";
import type { LibraryItem, LibraryPage } from "./api";

/**
 * Selection must stay smooth in a big library: a tap re-renders the tapped
 * tile, not every tile on screen. FileThumb renders once per photo tile
 * render, so a spy inside it counts tile renders.
 */
const mockThumbRender = jest.fn();
jest.mock("@/files/FileThumb", () => ({
  FileThumb: ({ file }: { file: { id: string } }) => {
    mockThumbRender(file.id);
    return null;
  },
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("./hooks", () => ({ useLibrary: jest.fn() }));

const photo = (i: number): LibraryItem => ({
  id: `p${i}`, name: `p${i}.jpg`, size_bytes: 1, mime_type: "image/jpeg", extension: "jpg",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 0, folder_id: null, taken_at: 1718445600,
});
const PAGE: LibraryPage = {
  total: 300, counts: { "2024-07": 300 },
  months: [{ key: "2024-07", label: "July 2024", files: Array.from({ length: 300 }, (_, i) => photo(i)) }],
  next_cursor: null,
};

function Harness() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(["p0"]));
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return <LibraryBrowser workspaceId="ws_1" kind="photos" layout="grid" selectable checks selected={selected} onToggleSelect={toggle} />;
}

it("ticking one of 300 photos re-renders about one tile", () => {
  (useLibrary as jest.Mock).mockReturnValue({
    data: { pages: [PAGE], pageParams: [null] },
    isLoading: false, isError: false, isFetchingNextPage: false, isRefetching: false, hasNextPage: false,
    fetchNextPage: jest.fn(), refetch: jest.fn(),
  });
  render(<Harness />);
  expect(mockThumbRender).toHaveBeenCalledWith("p4");

  mockThumbRender.mockClear();
  fireEvent.press(screen.getByTestId("photo-p4"));
  expect(screen.getByTestId("select-p4", { includeHiddenElements: true }).props.accessibilityState).toEqual({ checked: true });
  expect(mockThumbRender.mock.calls.length).toBeLessThanOrEqual(2);
  expect(mockThumbRender).toHaveBeenCalledWith("p4");
});
