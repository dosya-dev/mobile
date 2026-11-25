import { render, screen, fireEvent } from "@testing-library/react-native";
import { Gesture } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FileRow } from "./FileRow";
import type { FileItem } from "./types";

const HIDDEN = { includeHiddenElements: true } as const;

const file: FileItem = {
  id: "f1", name: "report.pdf", size_bytes: 5 * 1024 * 1024, mime_type: "application/pdf",
  extension: "pdf", created_at: 1700000000, updated_at: 1700000000, current_version: 1,
  lock_mode: "none", share_count: 0, comment_count: 0,
};

describe("FileRow selection and drag", () => {
  it("in selection mode a tap toggles instead of opening", () => {
    const onPress = jest.fn();
    const onToggleSelect = jest.fn();
    render(<FileRow file={file} onPress={onPress} selectable selected onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByText("report.pdf"));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-f1", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });

  it("shows no check outside selection mode", () => {
    render(<FileRow file={file} onPress={() => {}} />);
    expect(screen.queryByTestId("select-f1", HIDDEN)).toBeNull();
  });

  it("hides the more button in selection mode", () => {
    render(<FileRow file={file} onPress={() => {}} onMore={() => {}} selectable selected={false} onToggleSelect={() => {}} />);
    expect(screen.queryByTestId("more-f1", HIDDEN)).toBeNull();
  });

  it("mounts the drag handle's gesture around the row, and a hold no longer opens anything by itself", () => {
    const onPress = jest.fn();
    render(<FileRow file={file} onPress={onPress} drag={{ gesture: Gesture.Pan().withTestId("row-drag"), key: "file-f1" }} />);
    expect(() => getByGestureTestId("row-drag")).not.toThrow();
    fireEvent(screen.getByText("report.pdf"), "longPress");
    expect(onPress).not.toHaveBeenCalled();
  });
});
