jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));

import { render, screen } from "@testing-library/react-native";
import TermsScreen from "../../app/terms";
import PrivacyScreen from "../../app/privacy";
import { TERMS_SECTIONS, PRIVACY_SECTIONS } from "./content";

describe("in-app legal pages", () => {
  it("renders the full Terms of Service copied from the web", () => {
    render(<TermsScreen />);
    expect(TERMS_SECTIONS.length).toBeGreaterThan(15);
    expect(screen.getByText("1. Agreement to Terms")).toBeTruthy();
    expect(screen.getByText(/legally binding agreement/)).toBeTruthy();
  });

  it("renders the full Privacy Policy copied from the web", () => {
    render(<PrivacyScreen />);
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(15);
    expect(screen.getAllByText(/Privacy Policy/).length).toBeGreaterThan(0);
  });
});
