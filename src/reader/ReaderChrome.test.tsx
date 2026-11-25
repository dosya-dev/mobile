import { render, fireEvent, act, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ReaderChrome } from "./ReaderChrome";
import { CHROME_BOTTOM_GAP, CHROME_BUTTON, CHROME_TOP_GAP } from "./chromeLayout";

const props = {
  visible: true,
  onClose: jest.fn(),
  onOpenMenu: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

// reanimated's jest mock resolves withTiming synchronously, so only the END
// state of a transition is observable here. Mid-fade opacity is deliberately
// not asserted - it isn't reachable under the mock and pinning it would be
// testing the mock, not the component.

// Hidden chrome is marked accessibility-hidden, and RNTL's queries skip such
// elements by default - hence includeHiddenElements on the hidden-state
// queries below. That default is also why a "renders nothing when hidden"
// assertion would still pass against this component: it proves the buttons
// are out of the a11y tree, not unmounted.
const hidden = { includeHiddenElements: true };

it("keeps both buttons mounted when hidden so they can fade rather than pop", () => {
  render(<ReaderChrome {...props} visible={false} />);
  expect(screen.getByTestId("reader-close", hidden)).toBeTruthy();
  expect(screen.getByTestId("reader-menu", hidden)).toBeTruthy();
});

it("lets taps through to the page while hidden", () => {
  // Both buttons stay mounted, so pointerEvents is the only thing keeping a
  // tap in the top-right corner reaching the page instead of an invisible
  // button.
  render(<ReaderChrome {...props} visible={false} />);
  expect(screen.getByTestId("reader-close", hidden).props.pointerEvents).toBe("none");
  expect(screen.getByTestId("reader-menu", hidden).props.pointerEvents).toBe("none");
});

it("accepts taps once visible", () => {
  render(<ReaderChrome {...props} />);
  expect(screen.getByTestId("reader-close").props.pointerEvents).toBe("auto");
  expect(screen.getByTestId("reader-menu").props.pointerEvents).toBe("auto");
});

it("hides both buttons from the accessibility tree while hidden", () => {
  render(<ReaderChrome {...props} visible={false} />);
  expect(screen.getByTestId("reader-close", hidden).props.accessibilityElementsHidden).toBe(true);
  expect(screen.getByTestId("reader-menu", hidden).props.importantForAccessibility).toBe("no-hide-descendants");
});

it("renders the close and menu buttons and fires their callbacks", () => {
  render(<ReaderChrome {...props} />);
  fireEvent.press(screen.getByTestId("reader-close"));
  fireEvent.press(screen.getByTestId("reader-menu"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onOpenMenu).toHaveBeenCalledTimes(1);
});

it("positions both buttons absolutely in the right-hand corners with a real circle behind them", () => {
  // Regression guard. The buttons were once styled through `className` on
  // the reanimated-wrapped Pressable; NativeWind drops className on any
  // component type it has not registered, so no position, size or
  // background ever reached the native view - the X ended up laid out below
  // the screen. Jest can't see className-derived styles at all (NativeWind
  // skips registration under NODE_ENV=test), which is exactly why this
  // asserts the resolved `style` prop: a className could never satisfy it.
  render(<ReaderChrome {...props} />);
  const close = StyleSheet.flatten(screen.getByTestId("reader-close").props.style);
  const menu = StyleSheet.flatten(screen.getByTestId("reader-menu").props.style);
  // The safe-area mock reports zero insets, so the offsets are the bare gaps.
  expect(close).toMatchObject({
    position: "absolute",
    end: 16,
    top: CHROME_TOP_GAP,
    width: CHROME_BUTTON,
    height: CHROME_BUTTON,
    borderRadius: CHROME_BUTTON / 2,
  });
  expect(menu).toMatchObject({ position: "absolute", end: 16, bottom: CHROME_BOTTOM_GAP, width: CHROME_BUTTON });
  expect(close.backgroundColor).toBeTruthy();
  expect(menu.backgroundColor).toBe(close.backgroundColor);
});

it("has no auto-hide timer: the controls stay until the reader taps or turns a page", () => {
  jest.useFakeTimers();
  render(<ReaderChrome {...props} />);
  act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId("reader-close").props.pointerEvents).toBe("auto");
  expect(screen.getByTestId("reader-menu").props.pointerEvents).toBe("auto");
});
