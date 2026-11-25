import { render, fireEvent, screen } from "@testing-library/react-native";
import { ReaderMenu } from "./ReaderMenu";

const props = {
  visible: true,
  percent: 42,
  canSearch: true,
  canTheme: true,
  bookmarked: false,
  onClose: jest.fn(),
  onContents: jest.fn(),
  onSearch: jest.fn(),
  onThemes: jest.fn(),
  onShare: jest.fn(),
  onToggleBookmark: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

it("renders nothing when not visible", () => {
  render(<ReaderMenu {...props} visible={false} />);
  expect(screen.queryByTestId("menu-contents")).toBeNull();
  expect(screen.queryByTestId("menu-search")).toBeNull();
  expect(screen.queryByTestId("menu-themes")).toBeNull();
  expect(screen.queryByTestId("menu-share")).toBeNull();
  expect(screen.queryByTestId("menu-bookmark")).toBeNull();
});

it("renders all four rows in order for a book with both capabilities", () => {
  render(<ReaderMenu {...props} />);
  expect(screen.getByTestId("menu-contents")).toBeTruthy();
  expect(screen.getByTestId("menu-search")).toBeTruthy();
  expect(screen.getByTestId("menu-themes")).toBeTruthy();
  expect(screen.getByTestId("menu-share")).toBeTruthy();
  expect(screen.getByTestId("menu-bookmark")).toBeTruthy();
});

it("shows the rounded percent right-aligned on the contents row", () => {
  render(<ReaderMenu {...props} percent={7} />);
  expect(screen.getByText("7%")).toBeTruthy();
});

it("hides search when canSearch is false, independent of canTheme", () => {
  render(<ReaderMenu {...props} canSearch={false} canTheme />);
  expect(screen.queryByTestId("menu-search")).toBeNull();
  expect(screen.getByTestId("menu-themes")).toBeTruthy();
});

it("hides themes when canTheme is false, independent of canSearch", () => {
  render(<ReaderMenu {...props} canSearch canTheme={false} />);
  expect(screen.getByTestId("menu-search")).toBeTruthy();
  expect(screen.queryByTestId("menu-themes")).toBeNull();
});

it("hides both search and themes for PDF (neither capability), keeping contents and the circle row", () => {
  render(<ReaderMenu {...props} canSearch={false} canTheme={false} />);
  expect(screen.getByTestId("menu-contents")).toBeTruthy();
  expect(screen.queryByTestId("menu-search")).toBeNull();
  expect(screen.queryByTestId("menu-themes")).toBeNull();
  expect(screen.getByTestId("menu-share")).toBeTruthy();
  expect(screen.getByTestId("menu-bookmark")).toBeTruthy();
});

it("fires every row and circle-button callback on press", () => {
  render(<ReaderMenu {...props} />);
  fireEvent.press(screen.getByTestId("menu-contents"));
  fireEvent.press(screen.getByTestId("menu-search"));
  fireEvent.press(screen.getByTestId("menu-themes"));
  fireEvent.press(screen.getByTestId("menu-share"));
  fireEvent.press(screen.getByTestId("menu-bookmark"));
  expect(props.onContents).toHaveBeenCalledTimes(1);
  expect(props.onSearch).toHaveBeenCalledTimes(1);
  expect(props.onThemes).toHaveBeenCalledTimes(1);
  expect(props.onShare).toHaveBeenCalledTimes(1);
  expect(props.onToggleBookmark).toHaveBeenCalledTimes(1);
});

it("closes on backdrop press", () => {
  render(<ReaderMenu {...props} />);
  fireEvent.press(screen.getByTestId("reader-menu-backdrop"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("shows an active bookmark state only when bookmarked", () => {
  const { rerender } = render(<ReaderMenu {...props} bookmarked={false} />);
  expect(screen.getByTestId("menu-bookmark").props.className ?? "").not.toContain("bg-primary");
  rerender(<ReaderMenu {...props} bookmarked />);
  expect(screen.getByTestId("menu-bookmark").props.className ?? "").toContain("bg-primary");
});
