import { render, screen, within } from "@testing-library/react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { PlanHero } from "./PlanHero";

const pkg = (price: number, priceString: string) =>
  ({ identifier: "x", product: { identifier: "x", price, priceString, currencyCode: "USD" } }) as unknown as PurchasesPackage;

it("monthly: the store's price with its period on the same line, no saving, no per-month line", () => {
  render(<PlanHero planId="pro" storageLabel="1 TB" pkg={pkg(10, "$10.00")} interval="month" savingPct={null} />);
  expect(screen.getByText("Your space")).toBeTruthy();
  expect(screen.getByText("1 TB")).toBeTruthy();
  const line = within(screen.getByTestId("plan-hero-price"));
  expect(line.getByText("$10.00")).toBeTruthy();
  expect(line.getByText("/ month")).toBeTruthy();
  expect(screen.queryByText("/ year")).toBeNull();
  expect(screen.queryByTestId("plan-hero-saving")).toBeNull();
  expect(screen.queryByTestId("plan-hero-per-month")).toBeNull();
});

it("yearly: the full yearly price is the figure; per month is only the secondary approximate line", () => {
  render(<PlanHero planId="pro" storageLabel="1 TB" pkg={pkg(120, "$120.00")} interval="year" savingPct={17} />);
  const line = within(screen.getByTestId("plan-hero-price"));
  expect(line.getByText("$120.00")).toBeTruthy();
  expect(line.getByText("/ year")).toBeTruthy();
  expect(line.queryByText(/≈/)).toBeNull();
  expect(screen.getByTestId("plan-hero-per-month")).toHaveTextContent(/^≈ .*10\.00 \/ month$/);
  expect(screen.getByText("Save 17% vs monthly")).toBeTruthy();
});

it("yearly without a saving shows no pill", () => {
  render(<PlanHero planId="pro" storageLabel="1 TB" pkg={pkg(120, "$120.00")} interval="year" savingPct={null} />);
  expect(screen.queryByTestId("plan-hero-saving")).toBeNull();
});
