import { render, screen, fireEvent } from "@testing-library/react-native";
import { Gesture } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FolderCard } from "./FolderCard";
import type { FolderItem } from "./types";

const HIDDEN = { includeHiddenElements: true } as const;
const folder: FolderItem = {
  id: "d1", name: "Vacation", created_at: 1700000000, lock_mode: "none",
  file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none",
};

describe("FolderCard", () => {
  it("shows the name and fires onPress", () => {
    const onPress = jest.fn();
    render(<FolderCard folder={folder} onPress={onPress} />);
    expect(screen.getByText("Vacation")).toBeTruthy();
    fireEvent.press(screen.getByTestId("folder-card-d1"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("in selection mode a tap toggles instead of opening", () => {
    const onPress = jest.fn();
    const onToggleSelect = jest.fn();
    render(<FolderCard folder={folder} onPress={onPress} selectable selected onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByTestId("folder-card-d1"));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-folder-d1", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });

  it("shows the drop ring only while a drag hovers it", () => {
    const { rerender } = render(<FolderCard folder={folder} onPress={() => {}} dropActive />);
    expect(screen.getByTestId("drop-ring-d1", HIDDEN)).toBeTruthy();
    rerender(<FolderCard folder={folder} onPress={() => {}} />);
    expect(screen.queryByTestId("drop-ring-d1", HIDDEN)).toBeNull();
  });

  it("with a drag handle the gesture is mounted and a long press no longer opens the more sheet by itself", () => {
    const onMore = jest.fn();
    render(<FolderCard folder={folder} onPress={() => {}} onMore={onMore} drag={{ gesture: Gesture.Pan().withTestId("card-drag"), key: "folder-d1" }} />);
    expect(() => getByGestureTestId("card-drag")).not.toThrow();
    fireEvent(screen.getByTestId("folder-card-d1"), "longPress");
    expect(onMore).not.toHaveBeenCalled();
  });
});
