import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { SwipeRow } from "./SwipeRow";

// Gesture events reach the handlers outside React's own event path, so the
// state they set is flushed explicitly.
const swipe = (id: string, dx: number) =>
  act(() => {
    fireGestureHandler(getByGestureTestId(`swipe-${id}`), [
      { state: State.BEGAN, translationX: 0 },
      { state: State.ACTIVE, translationX: dx / 2 },
      { translationX: dx },
      { state: State.END, translationX: dx, velocityX: 0 },
    ]);
  });

function renderRow(props: Partial<React.ComponentProps<typeof SwipeRow>> = {}) {
  const onSelect = jest.fn();
  const onDelete = jest.fn();
  render(
    <SwipeRow id="r1" onSelect={onSelect} onDelete={onDelete} width={360} {...props}>
      <Text>row</Text>
    </SwipeRow>,
  );
  return { onSelect, onDelete };
}

describe("SwipeRow", () => {
  it("a short swipe to the right reveals Select, and tapping it selects", () => {
    const { onSelect, onDelete } = renderRow();
    swipe("r1", 90);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("swipe-select-r1"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("a long swipe to the right selects without a tap", () => {
    const { onSelect } = renderRow();
    swipe("r1", 260);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a short swipe to the left reveals Delete, and tapping it asks to delete", () => {
    const { onDelete } = renderRow();
    swipe("r1", -90);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("swipe-delete-r1"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a long swipe to the left asks to delete without a tap", () => {
    const { onDelete } = renderRow();
    swipe("r1", -260);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a tiny swipe does nothing and reveals nothing", () => {
    const { onSelect, onDelete } = renderRow();
    swipe("r1", 20);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId("swipe-row-r1").props.accessibilityState).toEqual({ expanded: false });
  });

  it("offers only the side that has an action", () => {
    const { onSelect } = renderRow({ onDelete: undefined });
    swipe("r1", -260);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("swipe-delete-r1")).toBeNull();
  });

  it("does nothing while disabled", () => {
    const { onSelect } = renderRow({ enabled: false });
    swipe("r1", 260);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
