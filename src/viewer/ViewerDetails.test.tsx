import { fireEvent, render, screen } from "@testing-library/react-native";
import { ViewerDetails } from "./ViewerDetails";
import type { FileItem } from "@/files/types";

function file(id: string): FileItem {
  return {
    id, name: `${id}.jpg`, size_bytes: 10, mime_type: "image/jpeg", extension: ".jpg",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
  };
}

const rows = [
  { label: "Kind", value: "JPEG image" },
  { label: "Added by", value: "Firat Kaya" },
];

it("lists every row it is given", () => {
  render(<ViewerDetails rows={rows} neighbours={[file("a")]} currentId="a" onSelect={jest.fn()} />);
  expect(screen.getByText("Kind")).toBeTruthy();
  expect(screen.getByText("Firat Kaya")).toBeTruthy();
});

it("offers a filmstrip only when there are neighbours", () => {
  render(<ViewerDetails rows={rows} neighbours={[file("a")]} currentId="a" onSelect={jest.fn()} />);
  expect(screen.queryByTestId("viewer-filmstrip")).toBeNull();
});

it("shows the folder and marks where you are in it", () => {
  render(
    <ViewerDetails rows={rows} neighbours={[file("a"), file("b"), file("c")]} currentId="b" onSelect={jest.fn()} />,
  );
  expect(screen.getByTestId("viewer-filmstrip")).toBeTruthy();
  expect(screen.getByTestId("filmstrip-b").props.accessibilityState?.selected).toBe(true);
  expect(screen.getByTestId("filmstrip-a").props.accessibilityState?.selected).toBe(false);
});

it("jumps to a file picked from the strip", () => {
  const onSelect = jest.fn();
  render(<ViewerDetails rows={rows} neighbours={[file("a"), file("b")]} currentId="a" onSelect={onSelect} />);
  fireEvent.press(screen.getByTestId("filmstrip-b"));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
});
