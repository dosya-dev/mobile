import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));

import { toast } from "@/ui/toast";
import { PermissionDeniedStep } from "./PermissionDeniedStep";

beforeEach(() => jest.clearAllMocks());

describe("PermissionDeniedStep", () => {
  it("names the consequence rather than failing silently", () => {
    render(<PermissionDeniedStep onContinue={jest.fn()} />);
    expect(screen.getByText(/Photo access is off/)).toBeTruthy();
  });

  it("opens the OS settings, the only place this can be re-granted", () => {
    const spy = jest.spyOn(Linking, "openSettings").mockImplementation(() => Promise.resolve());
    render(<PermissionDeniedStep onContinue={jest.fn()} />);
    fireEvent.press(screen.getByTestId("step-primary"));
    expect(spy).toHaveBeenCalled();
  });

  // Journey 6 (the user denies photo access) is circular unless "Open
  // Settings" does something. An unhandled rejection there is the quietest
  // possible dead end on the one screen that exists to be the way back.
  it("says so rather than failing silently when the OS refuses to open Settings", async () => {
    jest.spyOn(Linking, "openSettings").mockRejectedValue(new Error("unsupported"));
    render(<PermissionDeniedStep onContinue={jest.fn()} />);
    fireEvent.press(screen.getByTestId("step-primary"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Settings/i), "error"));
    // The written path is the fallback the toast points at, so it has to be
    // on screen already.
    expect(screen.getByText(/dosya\.dev/)).toBeTruthy();
  });

  it("never traps the user - the product stays reachable", () => {
    const onContinue = jest.fn();
    render(<PermissionDeniedStep onContinue={onContinue} />);
    fireEvent.press(screen.getByTestId("step-secondary"));
    expect(onContinue).toHaveBeenCalled();
  });
});
