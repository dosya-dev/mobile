// The sheet handle: claims the touch at touch start (so it wins inside a
// Pressable sheet), and a drag down past the threshold closes the sheet.
// The responder events are driven by hand with the touch history PanResponder
// reads (dragSheetHandle); what jest cannot do is the native negotiation
// between views, so a real-device check still stands.
import { render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { SHEET_DISMISS_DY, SheetHandle, dragDismisses } from "./SheetHandle";
import { dragSheetHandle } from "./sheetTesting";

it("claims the touch at touch start and closes on a drag down past the threshold", () => {
  const onDismiss = jest.fn();
  render(
    <Pressable onPress={() => {}}>
      <SheetHandle onDismiss={onDismiss} testID="handle"><Text>Title</Text></SheetHandle>
    </Pressable>,
  );
  const handle = screen.getByTestId("handle");
  expect(dragSheetHandle(handle, 0, SHEET_DISMISS_DY + 20)).toBe(true);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("ignores a short drag, a drag up and a sideways drag", () => {
  const onDismiss = jest.fn();
  render(<SheetHandle onDismiss={onDismiss} testID="handle" />);
  const handle = screen.getByTestId("handle");
  dragSheetHandle(handle, 0, SHEET_DISMISS_DY - 10);
  dragSheetHandle(handle, 0, -120);
  dragSheetHandle(handle, 200, 10);
  expect(onDismiss).not.toHaveBeenCalled();
});

it("reads the latest onDismiss, not the one it was created with", () => {
  const first = jest.fn();
  const second = jest.fn();
  const { rerender } = render(<SheetHandle onDismiss={first} testID="handle" />);
  rerender(<SheetHandle onDismiss={second} testID="handle" />);
  dragSheetHandle(screen.getByTestId("handle"), 0, 100);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it("dragDismisses is the threshold the release uses", () => {
  expect(dragDismisses(SHEET_DISMISS_DY + 1)).toBe(true);
  expect(dragDismisses(SHEET_DISMISS_DY - 1)).toBe(false);
  expect(dragDismisses(-80)).toBe(false);
});
