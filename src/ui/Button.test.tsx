import { render, screen, fireEvent } from "@testing-library/react-native";
import { Button } from "./Button";

describe("Button", () => {
  it("calls onPress when tapped", () => {
    const onPress = jest.fn();
    render(<Button title="Sign in" onPress={onPress} />);
    fireEvent.press(screen.getByText("Sign in"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  // Regression guard: a centred Button shrinks to its label, so without
  // horizontal padding the text touches both edges. Structural, because the
  // clipping itself is only visible on a device.
  it("keeps horizontal padding so a shrink-to-fit button cannot clip its label", () => {
    render(<Button title="Try again" onPress={() => {}} testID="btn" />);
    expect(screen.getByTestId("btn").props.className).toMatch(/\bpx-\d/);
  });
  it("does not call onPress while loading", () => {
    const onPress = jest.fn();
    render(<Button title="Sign in" onPress={onPress} loading testID="btn" />);
    fireEvent.press(screen.getByTestId("btn"));
    expect(onPress).not.toHaveBeenCalled();
  });
});

it("brand variant: the green call to action", () => {
  render(<Button title="Continue" onPress={() => {}} variant="brand" testID="btn" />);
  expect(screen.getByTestId("btn").props.className).toMatch(/\bbg-brand\b/);
  expect(screen.getByText("Continue").props.className).toMatch(/\btext-brand-foreground\b/);
});
