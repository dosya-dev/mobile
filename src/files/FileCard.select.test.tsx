import { act, render, screen, fireEvent } from "@testing-library/react-native";
import { Gesture } from "react-native-gesture-handler";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { FileCard } from "./FileCard";
import type { FileItem } from "./types";

const HIDDEN = { includeHiddenElements: true } as const;

const file: FileItem = {
  id: "f1", name: "pic.jpg", size_bytes: 1, mime_type: "image/jpeg", extension: "jpg",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};
const handle = () => ({ gesture: Gesture.Pan().withTestId("card-drag"), key: "file-f1" });

describe("FileCard selection and drag", () => {
  it("in selection mode a tap toggles instead of opening", () => {
    const onPress = jest.fn();
    const onToggleSelect = jest.fn();
    render(<FileCard file={file} onPress={onPress} selectable selected={false} onToggleSelect={onToggleSelect} />);
    fireEvent.press(screen.getByTestId("card-f1"));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-f1", HIDDEN).props.accessibilityState).toEqual({ checked: false });
  });

  it("with a drag handle the gesture is mounted and a long press no longer opens the more sheet by itself", () => {
    const onMore = jest.fn();
    render(<FileCard file={file} onPress={() => {}} onMore={onMore} drag={handle()} />);
    expect(() => getByGestureTestId("card-drag")).not.toThrow();
    fireEvent(screen.getByTestId("card-f1"), "longPress");
    expect(onMore).not.toHaveBeenCalled();
  });

  it("a long press still opens the more sheet when there is no drag handle", () => {
    const onMore = jest.fn();
    render(<FileCard file={file} onPress={() => {}} onMore={onMore} />);
    fireEvent(screen.getByTestId("card-f1"), "longPress");
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  // Driven through Pressability's own timer: a responder grant starts the
  // long-press clock, so the delay in force is what decides when it fires.
  describe("long-press delay", () => {
    const grant = { persist() {}, nativeEvent: { pageX: 10, pageY: 10, touches: [], changedTouches: [], timestamp: 0 } };
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("keeps Pressable's own 500 ms when there is no drag to arm", () => {
      const onMore = jest.fn();
      render(<FileCard file={file} onPress={() => {}} onMore={onMore} />);
      fireEvent(screen.getByTestId("card-f1"), "responderGrant", grant);
      act(() => { jest.advanceTimersByTime(320); });
      expect(onMore).not.toHaveBeenCalled();
      act(() => { jest.advanceTimersByTime(200); });
      expect(onMore).toHaveBeenCalledTimes(1);
    });

    it("with a drag handle a hold released after 300 ms is not a tap", () => {
      const onPress = jest.fn();
      render(<FileCard file={file} onPress={onPress} drag={handle()} />);
      const card = screen.getByTestId("card-f1");
      fireEvent(card, "responderGrant", grant);
      act(() => { jest.advanceTimersByTime(320); });
      fireEvent(card, "responderRelease", grant);
      expect(onPress).not.toHaveBeenCalled();
    });
  });
});
