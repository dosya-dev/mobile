import { render, screen, fireEvent } from "@testing-library/react-native";
import { SettingsRow } from "./SettingsRow";

// Icons are lucide SVGs and carry `aria-hidden` unless given a label, which is
// correct for a decorative glyph. RNTL skips hidden elements by default, so
// these queries opt in explicitly - including the negative ones, which would
// otherwise pass because the element is hidden rather than because it is absent.
const HIDDEN = { includeHiddenElements: true } as const;

it("renders label and description and fires onPress", () => {
  const onPress = jest.fn();
  render(<SettingsRow testID="row" label="Favourites" description="Starred files" onPress={onPress} />);
  expect(screen.getByText("Favourites")).toBeTruthy();
  expect(screen.getByText("Starred files")).toBeTruthy();
  fireEvent.press(screen.getByTestId("row"));
  expect(onPress).toHaveBeenCalled();
});

it("shows a chevron when pressable with no right slot", () => {
  render(<SettingsRow testID="row" label="Trash" onPress={() => {}} />);
  expect(screen.getByTestId("row-chevron", HIDDEN)).toBeTruthy();
});

it("omits the chevron when a right slot is supplied", () => {
  render(<SettingsRow testID="row" label="Wi-Fi only" right={<></>} onPress={() => {}} />);
  expect(screen.queryByTestId("row-chevron", HIDDEN)).toBeNull();
});

it("shows a value label without losing the chevron", () => {
  render(<SettingsRow testID="row" label="Appearance" value="System" onPress={() => {}} />);
  expect(screen.getByText("System")).toBeTruthy();
  expect(screen.getByTestId("row-chevron", HIDDEN)).toBeTruthy();
});
