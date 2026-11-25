import { render, screen } from "@testing-library/react-native";
import { RollingCount } from "./RollingCount";

describe("RollingCount", () => {
  it("shows the new count, and the outgoing one is not read out", () => {
    const view = render(<RollingCount count={1} />);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    view.rerender(<RollingCount count={2} />);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2 selected");
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.queryByText("1 selected")).toBeNull();
  });
});

it("does not roll while hidden, nor on the first change after it shows", () => {
  const view = render(<RollingCount count={3} roll={false} />);
  view.rerender(<RollingCount count={0} roll={false} />);
  expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected");
  expect(screen.queryByText("3 selected", { includeHiddenElements: true })).toBeNull();
  view.rerender(<RollingCount count={1} roll />);
  expect(screen.queryByText("0 selected", { includeHiddenElements: true })).toBeNull();
  view.rerender(<RollingCount count={2} roll />);
  expect(screen.getByText("1 selected", { includeHiddenElements: true })).toBeTruthy();
});
