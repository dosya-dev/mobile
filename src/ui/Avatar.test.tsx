import { render, screen } from "@testing-library/react-native";
import { Avatar } from "./Avatar";

it("renders the image when an imageUrl is given", () => {
  render(<Avatar testID="av" imageUrl="https://api.dosya.dev/api/workspaces/w1/icon" initials="AB" color="#22c55e" />);
  expect(screen.getByTestId("av-img")).toBeTruthy();
  expect(screen.queryByTestId("av-initials")).toBeNull();
});

it("renders initials on a colour chip when there is no image", () => {
  render(<Avatar testID="av" initials="AB" color="#22c55e" />);
  expect(screen.getByTestId("av-initials")).toBeTruthy();
  expect(screen.queryByTestId("av-img")).toBeNull();
  expect(screen.getByText("AB")).toBeTruthy();
});

it("uppercases and caps initials at two characters", () => {
  render(<Avatar testID="av" initials="abcd" color="#22c55e" />);
  expect(screen.getByText("AB")).toBeTruthy();
});
