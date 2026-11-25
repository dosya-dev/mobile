import { fireEvent, render, screen } from "@testing-library/react-native";
import { SelectionHeader } from "./SelectionHeader";

describe("SelectionHeader", () => {
  it("closes, moves, and disables Move with nothing ticked", () => {
    const onCancel = jest.fn();
    const onMove = jest.fn();
    const view = render(<SelectionHeader count={2} onCancel={onCancel} onMove={onMove} moveDisabled={false} />);
    expect(screen.getByTestId("selection-header")).toBeTruthy();
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
    fireEvent.press(screen.getByTestId("selection-close"));
    fireEvent.press(screen.getByTestId("selection-move"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
    view.rerender(<SelectionHeader count={0} onCancel={onCancel} onMove={onMove} moveDisabled />);
    expect(screen.getByTestId("selection-move").props.accessibilityState).toEqual({ disabled: true });
  });
});
