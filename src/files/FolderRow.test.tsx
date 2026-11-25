import { render, screen, fireEvent } from "@testing-library/react-native";
import { FolderRow } from "./FolderRow";
import type { FolderItem } from "./types";

// Icons are lucide SVGs and carry `aria-hidden` unless given a label, which is
// correct for a decorative glyph. RNTL skips hidden elements by default, so
// these queries opt in explicitly - including the negative ones, which would
// otherwise pass because the element is hidden rather than because it is absent.
const HIDDEN = { includeHiddenElements: true } as const;

const folder: FolderItem = {
  id: "d1", name: "Vacation Photos", created_at: 1700000000, lock_mode: "none",
  file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none",
};

describe("FolderRow", () => {
  it("shows the name and item count", () => {
    render(<FolderRow folder={folder} onPress={() => {}} />);
    expect(screen.getByText("Vacation Photos")).toBeTruthy();
    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("calls onPress", () => {
    const onPress = jest.fn();
    render(<FolderRow folder={folder} onPress={onPress} />);
    fireEvent.press(screen.getByText("Vacation Photos"));
    expect(onPress).toHaveBeenCalled();
  });

  // Mirrors FileRow's hidden badge: "hidden" means "hidden from someone else"
  // - the viewer can see the row, so it's never "hidden from you".
  it("shows a hidden badge for a hidden folder, and not for a visible one", () => {
    render(<FolderRow folder={{ ...folder, is_hidden: 1, hidden_mode: "users" }} onPress={() => {}} />);
    expect(screen.getByTestId("hidden-folder-d1", HIDDEN)).toBeTruthy();
  });

  it("shows no hidden badge for a visible folder", () => {
    render(<FolderRow folder={folder} onPress={() => {}} />);
    expect(screen.queryByTestId("hidden-folder-d1", HIDDEN)).toBeNull();
  });
});
