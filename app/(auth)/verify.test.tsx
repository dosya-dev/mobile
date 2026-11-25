import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import VerifyScreen from "./verify";
import { useAuthStore } from "@/auth/authStore";

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

it("calls verifyEmail with the entered code", async () => {
  const verifyEmail = jest.fn().mockResolvedValue(undefined);
  useAuthStore.setState({ verifyEmail, pendingVerificationEmail: "t@x.com", error: null } as never);
  render(<VerifyScreen />);
  fireEvent.changeText(screen.getByTestId("code"), "123456");
  fireEvent.press(screen.getByTestId("verify"));
  await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith("123456"));
});
