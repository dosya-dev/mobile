import { render, screen, fireEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { StepScreen } from "./StepScreen";

const base = { step: 2 as const, title: "T", primaryLabel: "Go", onPrimary: jest.fn() };

describe("StepScreen", () => {
  it("renders its title and children", () => {
    render(<StepScreen {...base}><Text>body</Text></StepScreen>);
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });

  it("marks progress through four steps", () => {
    render(<StepScreen {...base}><Text>b</Text></StepScreen>);
    expect(screen.getByTestId("onboarding-progress").props.accessibilityValue)
      .toEqual({ min: 1, max: 4, now: 2 });
  });

  it("fires the primary action", () => {
    const onPrimary = jest.fn();
    render(<StepScreen {...base} onPrimary={onPrimary}><Text>b</Text></StepScreen>);
    fireEvent.press(screen.getByText("Go"));
    expect(onPrimary).toHaveBeenCalled();
  });

  it("omits the secondary action when it has no handler", () => {
    render(<StepScreen {...base}><Text>b</Text></StepScreen>);
    expect(screen.queryByTestId("step-secondary")).toBeNull();
  });

  it("fires the secondary action when given one", () => {
    const onSecondary = jest.fn();
    render(
      <StepScreen {...base} secondaryLabel="Not now" onSecondary={onSecondary}>
        <Text>b</Text>
      </StepScreen>,
    );
    fireEvent.press(screen.getByTestId("step-secondary"));
    expect(onSecondary).toHaveBeenCalled();
  });

  it("blocks the primary action while loading", () => {
    const onPrimary = jest.fn();
    render(<StepScreen {...base} onPrimary={onPrimary} primaryLoading><Text>b</Text></StepScreen>);
    fireEvent.press(screen.getByTestId("step-primary"));
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it("speaks the step count, not just a bare percentage", () => {
    render(<StepScreen {...base}><Text>b</Text></StepScreen>);
    expect(screen.getByTestId("onboarding-progress").props.accessibilityLabel).toBe("Step 2 of 4");
  });

  it("fills only the dot for the first step", () => {
    render(<StepScreen {...base} step={1}><Text>b</Text></StepScreen>);
    expect(screen.getByTestId("onboarding-progress-dot-1").props.className).toContain("bg-primary");
    expect(screen.getByTestId("onboarding-progress-dot-2").props.className).toContain("bg-input");
    expect(screen.getByTestId("onboarding-progress-dot-3").props.className).toContain("bg-input");
    expect(screen.getByTestId("onboarding-progress-dot-4").props.className).toContain("bg-input");
  });

  it("fills every dot on the last step", () => {
    render(<StepScreen {...base} step={4}><Text>b</Text></StepScreen>);
    for (const i of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`onboarding-progress-dot-${i}`).props.className).toContain("bg-primary");
    }
  });

  // react-test-renderer performs no Yoga layout, so this cannot prove the
  // footer actually stays pinned or that overflow content actually scrolls -
  // only a device/simulator can confirm the pixels. It can prove the fix that
  // makes that possible: the scroll view carries the flex-1 style that lets it
  // fill the space between the progress bar and the footer, rather than
  // sizing to its own content.
  it("gives the scroll body a flex basis so it can fill the space above the footer", () => {
    render(<StepScreen {...base}><Text>b</Text></StepScreen>);
    expect(screen.getByTestId("step-scroll").props.className).toContain("flex-1");
  });
});
