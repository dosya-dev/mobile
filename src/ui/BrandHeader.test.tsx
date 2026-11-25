import { render, screen } from "@testing-library/react-native";
import { BrandHeader } from "./BrandHeader";

it("renders wordmark, title and subtitle", () => {
  render(<BrandHeader title="Welcome back" subtitle="Enter your credentials to access your account" />);
  expect(screen.getByText("dosya.dev")).toBeTruthy();
  expect(screen.getByText("Welcome back")).toBeTruthy();
  expect(screen.getByText("Enter your credentials to access your account")).toBeTruthy();
});
