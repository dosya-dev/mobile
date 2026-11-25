import { render, screen, fireEvent } from "@testing-library/react-native";
import { OAuthButton } from "./OAuthButton";
import { useAppearance } from "@/theme/themeStore";

it("renders the provider label and fires onPress", () => {
  const onPress = jest.fn();
  render(<OAuthButton provider="google" onPress={onPress} testID="oauth-google" />);
  expect(screen.getByText("Continue with Google")).toBeTruthy();
  fireEvent.press(screen.getByTestId("oauth-google"));
  expect(onPress).toHaveBeenCalled();
});

it("shows the Last used badge when requested", () => {
  render(<OAuthButton provider="github" onPress={() => {}} lastUsed testID="oauth-github" />);
  expect(screen.getByText("Continue with GitHub")).toBeTruthy();
  expect(screen.getByText("Last used")).toBeTruthy();
});

// Apple's HIG permits "Sign in with Apple", "Sign up with Apple" and "Use with
// Apple". "Continue with Apple" is not on that list, and it also read as a
// generic consent button rather than as the Apple sign-in.
it("uses Apple's own wording for the Apple button", () => {
  render(<OAuthButton provider="apple" onPress={() => {}} testID="oauth-apple" />);
  expect(screen.getByText("Sign in with Apple")).toBeTruthy();
});

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean) as object[]);

// The palette's `primary` is the user's chosen accent - green, amber, pink,
// blue. Painting the Apple button with it produced a coloured button with a
// small logo on it: not the black-and-white mark users recognise, and not what
// the HIG allows. These pin the button OUT of the theme system: same colours in
// every theme, in both light and dark.
describe("the Apple button is outside the theme", () => {
  const appleColours = () => {
    const button = screen.getByTestId("oauth-apple");
    const label = screen.getByTestId("oauth-apple-label");
    return {
      bg: flatten(button.props.style).backgroundColor,
      fg: flatten(label.props.style).color,
    };
  };

  it("is black on white whatever palette is active", () => {
    for (const theme of ["default", "mono", "amber"] as const) {
      useAppearance.setState({ theme });
      const view = render(<OAuthButton provider="apple" onPress={() => {}} testID="oauth-apple" />);
      expect(appleColours()).toEqual({ bg: "#000000", fg: "#ffffff" });
      view.unmount();
    }
  });

  it("does not follow the app between light and dark", () => {
    useAppearance.setState({ mode: "light" });
    const light = render(<OAuthButton provider="apple" onPress={() => {}} testID="oauth-apple" />);
    const inLight = appleColours();
    light.unmount();

    useAppearance.setState({ mode: "dark" });
    render(<OAuthButton provider="apple" onPress={() => {}} testID="oauth-apple" />);
    expect(appleColours()).toEqual(inLight);
  });
});
