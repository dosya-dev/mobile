import { render, fireEvent } from "@testing-library/react-native";
import { TocSheet } from "./TocSheet";

const toc = [{ label: "Chapter 1", href: "c1", depth: 0 }, { label: "Part A", href: "c1a", depth: 1 }];
const bookmarks = [{ id: "b1", location: "cfi(a)", label: "Chapter 1 · 12%", createdAt: "2026-08-06T00:00:00Z" }];
const props = { visible: true, toc, bookmarks, onClose: jest.fn(), onSelectToc: jest.fn(), onSelectBookmark: jest.fn(), onRemoveBookmark: jest.fn() };

it("lists chapters and selects one", () => {
  const { getByText } = render(<TocSheet {...props} />);
  fireEvent.press(getByText("Chapter 1"));
  expect(props.onSelectToc).toHaveBeenCalledWith("c1");
});

it("switches to bookmarks tab, selects and removes", () => {
  const { getByText, getByTestId } = render(<TocSheet {...props} />);
  fireEvent.press(getByText("Bookmarks"));
  fireEvent.press(getByText("Chapter 1 · 12%"));
  expect(props.onSelectBookmark).toHaveBeenCalledWith(bookmarks[0]);
  fireEvent.press(getByTestId("remove-bookmark-b1"));
  expect(props.onRemoveBookmark).toHaveBeenCalledWith("b1");
});

it("shows an empty state for no bookmarks", () => {
  const { getByText } = render(<TocSheet {...props} bookmarks={[]} />);
  fireEvent.press(getByText("Bookmarks"));
  getByText("No bookmarks yet");
});

it("shows no back control when onBack is not given", () => {
  const { queryByTestId } = render(<TocSheet {...props} />);
  expect(queryByTestId("sheet-back")).toBeNull();
});

it("shows and fires the back control when onBack is given", () => {
  const onBack = jest.fn();
  const { getByTestId } = render(<TocSheet {...props} onBack={onBack} />);
  fireEvent.press(getByTestId("sheet-back"));
  expect(onBack).toHaveBeenCalledTimes(1);
});
