import { render, screen, fireEvent } from "@testing-library/react-native";
import { ShortcutTile } from "./ShortcutTile";

it("renders its label and fires onPress", () => {
  const onPress = jest.fn();
  render(<ShortcutTile testID="tile" icon="star" label="Favourites" onPress={onPress} />);
  expect(screen.getByText("Favourites")).toBeTruthy();
  fireEvent.press(screen.getByTestId("tile"));
  expect(onPress).toHaveBeenCalled();
});
