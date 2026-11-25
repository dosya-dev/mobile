import { act, render, screen } from "@testing-library/react-native";
import { Keyboard, Platform, StyleSheet } from "react-native";
import SupportChatScreen from "./support-chat";
import { __setClientFactory, useSupportChat } from "@/support-chat/store";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) };
});

type Listener = (e: { endCoordinates: { height: number } }) => void;
const listeners: Record<string, Listener> = {};

beforeEach(() => {
  jest.spyOn(Keyboard, "addListener").mockImplementation(((name: string, fn: Listener) => {
    listeners[name] = fn;
    return { remove: () => { delete listeners[name]; } };
  }) as never);
  __setClientFactory(() => ({ connect() {}, close() {}, send() {}, sendMessage: () => "m", discard() {} }) as never);
  useSupportChat.getState().__reset();
});
afterEach(() => { __setClientFactory(null); jest.restoreAllMocks(); });

const lift = () => StyleSheet.flatten(screen.getByTestId("support-chat-body").props.style).paddingBottom;

describe("SupportChatScreen", () => {
  const openAndClose = (expected: number) => {
    render(<SupportChatScreen />);
    expect(screen.getByTestId("support-chat-input")).toBeTruthy();
    expect(lift()).toBe(0);
    const show = listeners.keyboardDidShow ?? listeners.keyboardWillShow;
    const hide = listeners.keyboardDidHide ?? listeners.keyboardWillHide;
    act(() => show({ endCoordinates: { height: 300 } }));
    expect(lift()).toBe(expected);
    act(() => hide({ endCoordinates: { height: 0 } }));
    expect(lift()).toBe(0);
  };

  it("on Android lifts the composer by the full reported height (it already excludes the navigation bar)", () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    try { openAndClose(300); } finally { Object.defineProperty(Platform, "OS", { value: os, configurable: true }); }
  });

  it("on iOS takes the bottom safe-area inset off the keyboard height", () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    try { openAndClose(280); } finally { Object.defineProperty(Platform, "OS", { value: os, configurable: true }); }
  });
});
