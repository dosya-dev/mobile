import { ScrollView, StyleSheet, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Segmented, Sheet } from "./controls";

// iOS shifts a vertical ScrollView's content sideways by its own horizontal
// padding in a right-to-left layout (seen on the simulator: the share sheet sat
// 40 pt off the right edge). The side padding belongs on the content container.
describe("Sheet", () => {
  it("pads the content container, not the ScrollView, on the sides", () => {
    const { UNSAFE_getByType } = render(
      <Sheet visible onClose={() => {}}>
        <Text>x</Text>
      </Sheet>,
    );
    const scroll = UNSAFE_getByType(ScrollView);
    const className = String((scroll.props as { className?: string }).className ?? "");
    expect(className).not.toMatch(/(^|\s)(px|ps|pe|pl|pr|p)-/);
    const own = (StyleSheet.flatten(scroll.props.style) ?? {}) as Record<string, unknown>;
    expect(own.paddingHorizontal ?? own.paddingLeft ?? own.paddingRight ?? own.paddingStart ?? own.paddingEnd).toBeUndefined();
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle) as { paddingHorizontal?: number };
    // What `px-5` gave before (NativeWind's native rem is 14), so LTR is unchanged.
    expect(content.paddingHorizontal).toBe(17.5);
  });
});

describe("Segmented", () => {
  const options = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
  it("reports the tapped option", () => {
    const onChange = jest.fn();
    render(<Segmented testID="s" options={options} value="a" onChange={onChange} />);
    fireEvent.press(screen.getByTestId("s-b"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
  it("disabled: taps do nothing and every option says so", () => {
    const onChange = jest.fn();
    render(<Segmented testID="s" options={options} value="a" onChange={onChange} disabled />);
    fireEvent.press(screen.getByTestId("s-b"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("s-b").props.accessibilityState).toMatchObject({ disabled: true });
  });
});
