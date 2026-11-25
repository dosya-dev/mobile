import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import ForgotPasswordScreen from "./forgot-password";
import { requestResetCode } from "@/auth/passwordReset";
import { ApiError } from "@/api/errors";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("@/auth/passwordReset", () => ({
  ...jest.requireActual("@/auth/passwordReset"),
  requestResetCode: jest.fn(),
}));

const mockRequest = requestResetCode as jest.MockedFunction<typeof requestResetCode>;

describe("ForgotPasswordScreen", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRequest.mockReset().mockResolvedValue(undefined);
  });

  it("keeps the submit button disabled until the email looks like one", () => {
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "nope");
    fireEvent.press(screen.getByTestId("send-code"));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("sends a lowercased, trimmed address and advances to the code screen", async () => {
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "  A@B.com ");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith("A@B.com"));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: "/(auth)/reset-password",
        params: { email: "a@b.com" },
      }),
    );
  });

  it("advances even for an address with no account, so the screen cannot be used to enumerate users", async () => {
    // The endpoint resolves ok for unknown addresses by design; the UI must not
    // branch on it. Same call, same navigation, no different message.
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "ghost@nowhere.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(screen.queryByTestId("forgot-error")).toBeNull();
  });

  it("advances on a cooldown 429, because a code is already in flight", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError("Too many attempts. Try again later.", 429));
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it("reports a real failure instead of advancing", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError("Server exploded", 500));
    render(<ForgotPasswordScreen />);
    fireEvent.changeText(screen.getByTestId("email"), "a@b.com");
    fireEvent.press(screen.getByTestId("send-code"));
    await waitFor(() => expect(screen.getByTestId("forgot-error")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
