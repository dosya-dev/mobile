import { render, screen } from "@testing-library/react-native";
import type { PaywallRow } from "./paywallModel";
import { WhatYouGet } from "./WhatYouGet";

const row = (over: Partial<PaywallRow> = {}): PaywallRow => ({
  planId: "pro", name: "Pro", storageLabel: "1 TB", features: [], aiImagesMax: null, aiDocumentsMax: null, yearlySavingPct: null, ...over,
});

it("lists storage, apps and support under What you get", () => {
  render(<WhatYouGet row={row()} />);
  expect(screen.getByText("What you get")).toBeTruthy();
  expect(screen.getByText("1 TB of end-to-end encrypted storage")).toBeTruthy();
  expect(screen.getByText("Phone, desktop, web and TV apps")).toBeTruthy();
  expect(screen.getByText("Priority support in live chat")).toBeTruthy();
  expect(screen.queryByText(/Smart Search/)).toBeNull();
});

it("adds Smart Search with the catalog's limits", () => {
  render(<WhatYouGet row={row({ features: ["ai_search"], aiImagesMax: 50000, aiDocumentsMax: 10000 })} />);
  expect(screen.getByText(/^Smart Search across 50.000 photos and 10.000 documents$/)).toBeTruthy();
});

it("adds own branding for a white-label plan", () => {
  render(<WhatYouGet row={row({ features: ["white_label"] })} />);
  expect(screen.getByText("Your own branding on shared pages")).toBeTruthy();
});
