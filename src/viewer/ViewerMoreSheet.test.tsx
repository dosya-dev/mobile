import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewerMoreSheet, type MoreAction } from "./ViewerMoreSheet";
import { finishSheetDismissal } from "@/ui/sheetTesting";
import type { FileItem } from "@/files/types";

const file: FileItem = {
  id: "f1", name: "Kas-harbour-sunset.jpg", size_bytes: 2_517_193, mime_type: "image/jpeg", extension: ".jpg",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};

function actions(over: Partial<MoreAction> = {}): MoreAction[] {
  return [
    { label: "Rename", icon: "create-outline", onPress: jest.fn(), ...over },
    { label: "Move to trash", icon: "trash-outline", destructive: true, onPress: jest.fn() },
  ];
}

// The menu opens over a full-screen viewer where the filename may be hidden
// behind the scrim, and it ends in a destructive action.
it("names the file the actions will apply to", () => {
  render(<ViewerMoreSheet visible file={file} actions={actions()} onClose={jest.fn()} />);
  expect(screen.getByText("Kas-harbour-sunset.jpg")).toBeTruthy();
  expect(screen.getByText("2.4 MB · JPEG image")).toBeTruthy();
});

it("renders each action under a stable id", () => {
  render(<ViewerMoreSheet visible file={file} actions={actions()} onClose={jest.fn()} />);
  expect(screen.getByTestId("more-rename")).toBeTruthy();
  expect(screen.getByTestId("more-move-to-trash")).toBeTruthy();
});

// And acts only once the sheet is gone: Rename and the Live Photo prompt
// present their own dialogs, which iOS would tear down with a closing sheet.
it("closes before it acts, so the sheet is not left open over a gone file", () => {
  const order: string[] = [];
  const onClose = jest.fn(() => order.push("close"));
  const list: MoreAction[] = [
    { label: "Rename", icon: "create-outline", onPress: () => order.push("act") },
  ];
  render(<ViewerMoreSheet visible file={file} actions={list} onClose={onClose} />);
  fireEvent.press(screen.getByTestId("more-rename"));
  expect(order).toEqual(["close"]);
  finishSheetDismissal();
  expect(order).toEqual(["close", "act"]);
});

it("dismisses on the scrim", () => {
  const onClose = jest.fn();
  render(<ViewerMoreSheet visible file={file} actions={actions()} onClose={onClose} />);
  fireEvent.press(screen.getByTestId("more-scrim"));
  expect(onClose).toHaveBeenCalled();
});
