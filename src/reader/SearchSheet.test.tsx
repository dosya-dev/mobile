import { render, fireEvent, act } from "@testing-library/react-native";
import { SearchSheet } from "./SearchSheet";
import type { SearchHit } from "./bridge";

const props = {
  visible: true,
  hits: [] as SearchHit[],
  searching: false,
  error: null as string | null,
  onQuery: jest.fn(),
  onSelect: jest.fn(),
  onClose: jest.fn(),
  onBack: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it("shows the idle prompt and does not query under two characters", () => {
  jest.useFakeTimers();
  const onQuery = jest.fn();
  const { getByTestId, getByText } = render(<SearchSheet {...props} onQuery={onQuery} />);
  fireEvent.changeText(getByTestId("search-input"), "a");
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onQuery).not.toHaveBeenCalled();
  getByText("Type at least two letters.");
});

it("debounces the query 300ms and fires onQuery once for a burst of keystrokes", () => {
  jest.useFakeTimers();
  const onQuery = jest.fn();
  const { getByTestId } = render(<SearchSheet {...props} onQuery={onQuery} />);
  const input = getByTestId("search-input");
  fireEvent.changeText(input, "c");
  act(() => {
    jest.advanceTimersByTime(100);
  });
  fireEvent.changeText(input, "ca");
  act(() => {
    jest.advanceTimersByTime(100);
  });
  fireEvent.changeText(input, "cat");
  expect(onQuery).not.toHaveBeenCalled();
  act(() => {
    jest.advanceTimersByTime(300);
  });
  expect(onQuery).toHaveBeenCalledTimes(1);
  expect(onQuery).toHaveBeenCalledWith("cat");
});

it("renders hits and selecting one passes its cfi", () => {
  const onSelect = jest.fn();
  const hits: SearchHit[] = [
    { cfi: "epubcfi(/6/4[a]!/4)", excerpt: "Call me Ishmael." },
    { cfi: "epubcfi(/6/6[b]!/4)", excerpt: "It is a way I have." },
  ];
  const { getByTestId } = render(<SearchSheet {...props} hits={hits} onSelect={onSelect} />);
  fireEvent.changeText(getByTestId("search-input"), "ish");
  getByTestId("search-hit-0");
  fireEvent.press(getByTestId("search-hit-1"));
  expect(onSelect).toHaveBeenCalledWith("epubcfi(/6/6[b]!/4)");
});

it("shows the no-results copy when a query has no hits", () => {
  const { getByTestId, getByText } = render(<SearchSheet {...props} hits={[]} searching={false} />);
  fireEvent.changeText(getByTestId("search-input"), "zzz");
  getByText('No results for "zzz".');
});

it("shows the searching indicator while a search is in flight", () => {
  const { getByTestId } = render(<SearchSheet {...props} searching hits={[]} />);
  fireEvent.changeText(getByTestId("search-input"), "zzz");
  getByTestId("search-indicator");
});

it("fires Done and Menu from the header", () => {
  const onClose = jest.fn();
  const onBack = jest.fn();
  const { getByTestId } = render(<SearchSheet {...props} onClose={onClose} onBack={onBack} />);
  fireEvent.press(getByTestId("sheet-done"));
  fireEvent.press(getByTestId("sheet-back"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
});

it("shows an inline error message instead of the hit list or the 'no results' copy", () => {
  const { getByTestId, getByText, queryByText } = render(
    <SearchSheet {...props} error="Search failed. Try again." hits={[]} searching={false} />,
  );
  fireEvent.changeText(getByTestId("search-input"), "zzz");
  getByText("Search failed. Try again.");
  expect(queryByText('No results for "zzz".')).toBeNull();
});

it("resets the query when the sheet closes, so reopening does not show a stale 'No results'", () => {
  const { getByTestId, getByText, queryByText, rerender } = render(<SearchSheet {...props} />);
  fireEvent.changeText(getByTestId("search-input"), "zzz");
  getByText('No results for "zzz".');

  rerender(<SearchSheet {...props} visible={false} />);
  rerender(<SearchSheet {...props} visible={true} />);

  expect(queryByText('No results for "zzz".')).toBeNull();
  expect(getByTestId("search-input").props.value).toBe("");
});
