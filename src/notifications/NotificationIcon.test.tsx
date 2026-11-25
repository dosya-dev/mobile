import { render, screen } from "@testing-library/react-native";
import { KNOWN_ICON_KEYS, NOTIFICATION_ICON_COMPONENTS, NotificationIcon } from "./NotificationIcon";

// The ring is decorative and hidden from assistive tech (the title carries the
// meaning), so the queries have to opt in to hidden elements.
const hidden = { includeHiddenElements: true };

describe("NotificationIcon (mobile)", () => {
  it("has a component for every generated key, and nothing else", () => {
    expect(Object.keys(NOTIFICATION_ICON_COMPONENTS).sort()).toEqual([...KNOWN_ICON_KEYS].sort());
  });

  it("draws the key the row carries", () => {
    render(<NotificationIcon icon="credit-card" category="billing" priority="critical" />);
    expect(screen.getByTestId("notification-icon-credit-card", hidden)).toBeTruthy();
  });

  it("falls back to the group icon for a legacy emoji, and to the bell when nothing is known", () => {
    render(<NotificationIcon icon="🔐" category="security" priority="normal" />);
    expect(screen.getByTestId("notification-icon-shield", hidden)).toBeTruthy();
    render(<NotificationIcon icon={null} category="admin_message" priority={null} />);
    expect(screen.getByTestId("notification-icon-bell", hidden)).toBeTruthy();
  });
});
