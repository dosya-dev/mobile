import { render, screen, fireEvent } from "@testing-library/react-native";
import { Gesture } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FolderRow } from "./FolderRow";
import type { FolderItem } from "./types";

// Decorative icons are aria-hidden; see FolderRow.test.tsx.
const HIDDEN = { includeHiddenElements: true } as const;

const folder: FolderItem = {
  id: "d1", name: "Vacation Photos", created_at: 1700000000, lock_mode: "none",
  file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none",
};

describe("FolderRow selection and drop", () => {
  it("in selection mode a tap toggles instead of opening, and the check reflects `selected`", () => {
    const onPress = jest.fn();
    const onToggleSelect = jest.fn();
    render(<FolderRow folder={folder} onPress={onPress} selectable selected={false} onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByText("Vacation Photos"));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-folder-d1", HIDDEN).props.accessibilityState).toEqual({ checked: false });
  });

  it("shows the check as ticked when selected", () => {
    render(<FolderRow folder={folder} onPress={() => {}} selectable selected onToggleSelect={() => {}} />);
    expect(screen.getByTestId("select-folder-d1", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });

  it("shows no check outside selection mode", () => {
    render(<FolderRow folder={folder} onPress={() => {}} />);
    expect(screen.queryByTestId("select-folder-d1", HIDDEN)).toBeNull();
  });

  it("hides the more button in selection mode", () => {
    render(<FolderRow folder={folder} onPress={() => {}} onMore={() => {}} selectable selected={false} onToggleSelect={() => {}} />);
    expect(screen.queryByTestId("more-folder-d1", HIDDEN)).toBeNull();
  });

  it("shows the drop ring only while a drag hovers it", () => {
    const { rerender } = render(<FolderRow folder={folder} onPress={() => {}} dropActive />);
    expect(screen.getByTestId("drop-ring-d1", HIDDEN)).toBeTruthy();
    rerender(<FolderRow folder={folder} onPress={() => {}} />);
    expect(screen.queryByTestId("drop-ring-d1", HIDDEN)).toBeNull();
  });

  it("mounts the drag handle's gesture around the row, and a hold no longer opens anything by itself", () => {
    const onPress = jest.fn();
    render(<FolderRow folder={folder} onPress={onPress} drag={{ gesture: Gesture.Pan().withTestId("row-drag"), key: "folder-d1" }} />);
    expect(() => getByGestureTestId("row-drag")).not.toThrow();
    fireEvent(screen.getByText("Vacation Photos"), "longPress");
    expect(onPress).not.toHaveBeenCalled();
  });
});
