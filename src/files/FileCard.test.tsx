import { render, screen, fireEvent } from "@testing-library/react-native";
import { FileCard } from "./FileCard";
import type { FileItem } from "./types";

const file: FileItem = {
  id: "f1", name: "pic.jpg", size_bytes: 1, mime_type: "image/jpeg", extension: "jpg",
  created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
};

it("shows the name and an image thumbnail, and fires onPress", () => {
  const onPress = jest.fn();
  render(<FileCard file={file} onPress={onPress} />);
  expect(screen.getByText("pic.jpg")).toBeTruthy();
  expect(screen.getByTestId("thumb-img-f1")).toBeTruthy();
  fireEvent.press(screen.getByTestId("card-f1"));
  expect(onPress).toHaveBeenCalled();
});
