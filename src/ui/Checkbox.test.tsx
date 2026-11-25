import { render, screen, fireEvent } from "@testing-library/react-native";
import { Checkbox } from "./Checkbox";

it("toggles on press", () => {
  const onChange = jest.fn();
  render(<Checkbox checked={false} onChange={onChange} testID="cb" />);
  fireEvent.press(screen.getByTestId("cb"));
  expect(onChange).toHaveBeenCalledWith(true);
});

it("reflects the checked state to accessibility", () => {
  render(<Checkbox checked onChange={() => {}} testID="cb" />);
  expect(screen.getByTestId("cb").props.accessibilityState.checked).toBe(true);
});
