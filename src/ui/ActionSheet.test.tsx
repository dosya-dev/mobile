import { Modal, Platform } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ActionSheet } from "./ActionSheet";
import { DISMISS_FALLBACK_MS } from "./afterDismiss";

function mount(onPress: () => void, onClose = jest.fn()) {
  render(<ActionSheet visible onClose={onClose} actions={[{ label: "Upload a file", onPress }]} />);
  return onClose;
}

const dismiss = () => act(() => screen.UNSAFE_getByType(Modal).props.onDismiss());

afterEach(() => {
  Platform.OS = "ios";
  jest.useRealTimers();
});

describe("ActionSheet on iOS", () => {
  beforeEach(() => { Platform.OS = "ios"; });

  // The bug: a picker launched while the sheet is still sliding away is
  // presented on a view controller that is going away, never reports back,
  // and leaves the picker module stuck. The action must wait for the sheet.
  it("closes at once but holds the action until the sheet has gone", () => {
    const onPress = jest.fn();
    const onClose = mount(onPress);
    fireEvent.press(screen.getByText("Upload a file"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    dismiss();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("runs the action once even if the dismissal is reported twice", () => {
    const onPress = jest.fn();
    mount(onPress);
    fireEvent.press(screen.getByText("Upload a file"));
    dismiss();
    dismiss();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("still runs the action when the dismissal never reports back", () => {
    jest.useFakeTimers();
    const onPress = jest.fn();
    mount(onPress);
    fireEvent.press(screen.getByText("Upload a file"));
    act(() => { jest.advanceTimersByTime(DISMISS_FALLBACK_MS); });
    expect(onPress).toHaveBeenCalledTimes(1);
    dismiss();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // FileBrowser unmounts its file sheet on close instead of hiding it, and an
  // unmounted Modal never reports onDismiss.
  it("runs the action at once when the parent unmounts the sheet on close", () => {
    const onPress = jest.fn();
    let open = true;
    const { rerender } = render(
      <ActionSheet visible onClose={() => { open = false; }} actions={[{ label: "Rename", onPress }]} />,
    );
    fireEvent.press(screen.getByText("Rename"));
    expect(open).toBe(false);
    rerender(<></>);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a dismissal that no item asked for", () => {
    const onPress = jest.fn();
    mount(onPress);
    dismiss();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("ActionSheet on Android", () => {
  it("runs the action at once, as before", () => {
    Platform.OS = "android";
    const onPress = jest.fn();
    mount(onPress);
    fireEvent.press(screen.getByText("Upload a file"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
