import { fireEvent, render, screen } from "@testing-library/react-native";
import { PassphraseStep } from "./PassphraseStep";
import { useVault } from "@/vault/store";

const setup = jest.fn(async () => {});

beforeEach(() => {
  setup.mockClear();
  useVault.setState({ busy: false, error: null, setup } as never);
});

function type(pass: string, confirm = pass) {
  fireEvent.changeText(screen.getByTestId("vault-setup-pass"), pass);
  fireEvent.changeText(screen.getByTestId("vault-setup-confirm"), confirm);
}

const disabled = () => screen.getByTestId("vault-setup-submit").props.accessibilityState.disabled;

describe("PassphraseStep", () => {
  it("keeps Continue off until there are eight matching characters", () => {
    render(<PassphraseStep onBack={() => {}} />);
    expect(disabled()).toBe(true);

    type("short1");
    expect(disabled()).toBe(true);
    expect(screen.getByText("Too short")).toBeTruthy();

    type("long enough", "long enougj");
    expect(disabled()).toBe(true);
    expect(screen.getByText("Passphrases do not match.")).toBeTruthy();

    type("long enough");
    expect(disabled()).toBe(false);
    expect(screen.getByText("Matches")).toBeTruthy();
  });

  it("ticks the tips the passphrase meets", () => {
    render(<PassphraseStep onBack={() => {}} />);
    type("maple orbit candle river");
    expect(screen.getByTestId("vault-tip-length").props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId("vault-tip-words").props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText("Strong")).toBeTruthy();
  });

  // The fields are the only place the passphrase lives: once it has gone to
  // the store, neither keeps a copy.
  it("hands the passphrase to the store and clears both fields", () => {
    render(<PassphraseStep onBack={() => {}} />);
    type("maple orbit candle river");
    fireEvent.press(screen.getByTestId("vault-setup-submit"));

    expect(setup).toHaveBeenCalledWith("maple orbit candle river");
    expect(screen.getByTestId("vault-setup-pass").props.value).toBe("");
    expect(screen.getByTestId("vault-setup-confirm").props.value).toBe("");
  });

  it("goes back on the back arrow", () => {
    const onBack = jest.fn();
    render(<PassphraseStep onBack={onBack} />);
    fireEvent.press(screen.getByTestId("onboarding-back"));
    expect(onBack).toHaveBeenCalled();
  });
});
