import { render, fireEvent } from "@testing-library/react-native";
import { ThemesSheet } from "./ThemesSheet";
import { useReaderPrefs, FONT_MAX, FONT_STEP } from "./readerPrefs";

jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));

const props = { visible: true, onClose: jest.fn(), onBack: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  useReaderPrefs.setState({ fontSizePct: 100, themeId: "light", hydrated: true });
});

it("renders both theme groups with real ids", () => {
  const { getByTestId } = render(<ThemesSheet {...props} />);
  getByTestId("theme-light");
  getByTestId("theme-sepia");
  getByTestId("theme-dark");
  getByTestId("theme-ocean");
  getByTestId("theme-neo-brutal");
});

it("selects an app theme swatch and writes themeId to the store", () => {
  const { getByTestId } = render(<ThemesSheet {...props} />);
  fireEvent.press(getByTestId("theme-ocean"));
  expect(useReaderPrefs.getState().themeId).toBe("ocean");
});

it("steps the font size by FONT_STEP", () => {
  const { getByTestId, getByText } = render(<ThemesSheet {...props} />);
  fireEvent.press(getByTestId("font-larger"));
  expect(useReaderPrefs.getState().fontSizePct).toBe(100 + FONT_STEP);
  getByText(`${100 + FONT_STEP}%`);
  fireEvent.press(getByTestId("font-smaller"));
  expect(useReaderPrefs.getState().fontSizePct).toBe(100);
});

it("clamps the font size at the upper bound", () => {
  useReaderPrefs.setState({ fontSizePct: FONT_MAX - FONT_STEP, themeId: "light", hydrated: true });
  const { getByTestId } = render(<ThemesSheet {...props} />);
  fireEvent.press(getByTestId("font-larger"));
  expect(useReaderPrefs.getState().fontSizePct).toBe(FONT_MAX);
  fireEvent.press(getByTestId("font-larger"));
  expect(useReaderPrefs.getState().fontSizePct).toBe(FONT_MAX);
});

it("fires Done and Menu from the header", () => {
  const onClose = jest.fn();
  const onBack = jest.fn();
  const { getByTestId } = render(<ThemesSheet {...props} onClose={onClose} onBack={onBack} />);
  fireEvent.press(getByTestId("sheet-done"));
  fireEvent.press(getByTestId("sheet-back"));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
});
