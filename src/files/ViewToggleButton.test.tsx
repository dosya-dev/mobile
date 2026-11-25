import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewToggleButton } from "./ViewToggleButton";

describe("ViewToggleButton", () => {
  it("in grid mode shows the list icon and switches to list when pressed", () => {
    const onToggle = jest.fn();
    render(<ViewToggleButton mode="grid" onToggle={onToggle} />);
    expect(screen.getByTestId("view-toggle-icon-list")).toBeTruthy();
    expect(screen.queryByTestId("view-toggle-icon-grid")).toBeNull();
    fireEvent.press(screen.getByTestId("view-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("in list mode shows the grid icon", () => {
    render(<ViewToggleButton mode="list" onToggle={jest.fn()} />);
    expect(screen.getByTestId("view-toggle-icon-grid")).toBeTruthy();
    expect(screen.queryByTestId("view-toggle-icon-list")).toBeNull();
  });

  it("swaps the icon when the mode changes", () => {
    const view = render(<ViewToggleButton mode="list" onToggle={jest.fn()} />);
    view.rerender(<ViewToggleButton mode="grid" onToggle={jest.fn()} />);
    expect(screen.getByTestId("view-toggle-icon-list")).toBeTruthy();
    expect(screen.queryByTestId("view-toggle-icon-grid")).toBeNull();
  });

  it("is a button that is never reported selected", () => {
    render(<ViewToggleButton mode="grid" onToggle={jest.fn()} />);
    expect(screen.getByTestId("view-toggle")).not.toBeSelected();
    expect(screen.getByRole("button")).toBeTruthy();
  });
});
