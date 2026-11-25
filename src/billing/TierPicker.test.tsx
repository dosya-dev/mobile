import { fireEvent, render, screen } from "@testing-library/react-native";
import { TierPicker } from "./TierPicker";

const TIERS = ["100 GB", "500 GB", "1 TB", "2 TB", "4 TB", "6 TB", "8 TB", "10 TB", "20 TB"].map((storageLabel, i) => ({
  planId: `p${i}`,
  storageLabel,
}));

function renderPicker(index: number, tiers = TIERS, disabled = false) {
  const onChange = jest.fn();
  render(<TierPicker tiers={tiers} index={index} onChange={onChange} disabled={disabled} />);
  return onChange;
}

it("draws one tappable dot per tier, with room above and below to hit and no sideways overlap", () => {
  const onChange = renderPicker(2);
  for (const tier of TIERS) {
    const slop = screen.getByTestId(`tier-dot-${tier.planId}`).props.hitSlop;
    expect(slop.top).toBeGreaterThanOrEqual(12);
    expect(slop.bottom).toBeGreaterThanOrEqual(12);
    expect(slop.left).toBeLessThanOrEqual(4);
    expect(slop.right).toBeLessThanOrEqual(4);
  }
  fireEvent.press(screen.getByTestId("tier-dot-p6"));
  expect(onChange).toHaveBeenCalledWith(6);
});

it("labels the first, 1 TB, 4 TB and last tiers from the rows (visual only; the adjustable value speaks)", () => {
  renderPicker(0);
  const hidden = { includeHiddenElements: true };
  for (const label of ["100 GB", "1 TB", "4 TB", "20 TB"]) expect(screen.getByText(label, hidden)).toBeTruthy();
  for (const label of ["500 GB", "2 TB", "6 TB", "8 TB", "10 TB"]) expect(screen.queryByText(label, hidden)).toBeNull();
});

it("+ and - step one tier", () => {
  const onChange = renderPicker(3);
  fireEvent.press(screen.getByTestId("tier-more"));
  fireEvent.press(screen.getByTestId("tier-less"));
  expect(onChange.mock.calls).toEqual([[4], [2]]);
});

it("the step buttons stop at both ends and are named for screen readers", () => {
  const atStart = renderPicker(0);
  expect(screen.getByLabelText("Less space").props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(screen.getByTestId("tier-less"));
  expect(atStart).not.toHaveBeenCalled();
  screen.unmount();
  const atEnd = renderPicker(8);
  expect(screen.getByLabelText("More space").props.accessibilityState).toMatchObject({ disabled: true });
  fireEvent.press(screen.getByTestId("tier-more"));
  expect(atEnd).not.toHaveBeenCalled();
});

it("is one adjustable control for screen readers, read as the chosen size", () => {
  const onChange = renderPicker(4);
  const track = screen.getByTestId("tier-track");
  expect(track.props.accessibilityRole).toBe("adjustable");
  expect(track.props.accessibilityValue).toEqual({ text: "4 TB" });
  fireEvent(track, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  fireEvent(track, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
  expect(onChange.mock.calls).toEqual([[5], [3]]);
});

it("a single tier leaves both buttons off", () => {
  renderPicker(0, TIERS.slice(0, 1));
  expect(screen.getByTestId("tier-less").props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId("tier-more").props.accessibilityState).toMatchObject({ disabled: true });
});

it("disabled: dots, step buttons and screen-reader steps all do nothing", () => {
  const onChange = renderPicker(4, TIERS, true);
  fireEvent.press(screen.getByTestId("tier-dot-p6"));
  fireEvent.press(screen.getByTestId("tier-more"));
  fireEvent.press(screen.getByTestId("tier-less"));
  fireEvent(screen.getByTestId("tier-track"), "accessibilityAction", { nativeEvent: { actionName: "increment" } });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByTestId("tier-more").props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByTestId("tier-less").props.accessibilityState).toMatchObject({ disabled: true });
});
