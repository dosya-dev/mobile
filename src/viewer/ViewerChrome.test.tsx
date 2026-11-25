import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewerChrome } from "./ViewerChrome";
import { stagePalette } from "./stageTheme";

const palette = stagePalette("dark");

it("carries back and more", () => {
  const onBack = jest.fn();
  const onMore = jest.fn();
  render(<ViewerChrome visible position="4 of 27" palette={palette} onBack={onBack} onMore={onMore} />);
  fireEvent.press(screen.getByTestId("viewer-back"));
  fireEvent.press(screen.getByTestId("viewer-more-top"));
  expect(onBack).toHaveBeenCalled();
  expect(onMore).toHaveBeenCalled();
});

it("shows the position when there is a folder to page through", () => {
  render(<ViewerChrome visible position="4 of 27" palette={palette} onBack={jest.fn()} onMore={jest.fn()} />);
  expect(screen.getByText("4 of 27")).toBeTruthy();
});

// The filename lives in the sheet directly below. The screen this replaces
// printed it in the header AND as a heading, on top of each other.
it("shows nothing in the middle when there is nowhere to page", () => {
  render(<ViewerChrome visible position={null} palette={palette} onBack={jest.fn()} onMore={jest.fn()} />);
  expect(screen.queryByTestId("viewer-position")).toBeNull();
});

// It cross-fades rather than unmounting, which costs the one thing an
// unmounted button gives for free: it cannot intercept a touch.
it("lets a tap fall through to the stage while hidden", () => {
  render(<ViewerChrome visible={false} position="4 of 27" palette={palette} onBack={jest.fn()} onMore={jest.fn()} />);
  const chrome = screen.getByTestId("viewer-chrome", { includeHiddenElements: true });
  expect(chrome.props.pointerEvents).toBe("none");
  expect(chrome.props.accessibilityElementsHidden).toBe(true);
});

it("takes touches again once visible", () => {
  render(<ViewerChrome visible position={null} palette={palette} onBack={jest.fn()} onMore={jest.fn()} />);
  expect(screen.getByTestId("viewer-chrome").props.pointerEvents).toBe("auto");
});
