import { render, screen } from "@testing-library/react-native";
import { Badge } from "./Badge";

it("renders its label", () => {
  render(<Badge label="Owner" />);
  expect(screen.getByText("Owner")).toBeTruthy();
});

it("renders an outline variant", () => {
  render(<Badge label="Member" variant="outline" />);
  expect(screen.getByText("Member")).toBeTruthy();
});
