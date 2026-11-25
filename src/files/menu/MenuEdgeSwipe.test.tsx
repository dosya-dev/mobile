import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { useSharedValue } from "react-native-reanimated";
import { MenuEdgeSwipe } from "./MenuEdgeSwipe";
import { FilesMenuProgressContext } from "./menuMotion";
import { useFilesMenu } from "./menuStore";
import { useFilesInteraction } from "./interactionStore";

function Harness() {
  const progress = useSharedValue(0);
  return (
    <FilesMenuProgressContext.Provider value={progress}>
      <MenuEdgeSwipe><Text>files</Text></MenuEdgeSwipe>
    </FilesMenuProgressContext.Provider>
  );
}

const swipe = (dx: number, vx = 0) =>
  act(() => {
    fireGestureHandler(getByGestureTestId("files-menu-edge"), [
      { state: State.BEGAN, translationX: 0, velocityX: 0 },
      { state: State.ACTIVE, translationX: dx / 2, velocityX: vx },
      { translationX: dx, velocityX: vx },
      { state: State.END, translationX: dx, velocityX: vx },
    ]);
  });

beforeEach(() => {
  useFilesMenu.setState({ open: false, dragging: false });
  useFilesInteraction.setState({ busy: false });
});

describe("MenuEdgeSwipe", () => {
  it("renders the screen it wraps", () => {
    render(<Harness />);
    expect(screen.getByText("files")).toBeTruthy();
  });

  it("a long swipe from the edge opens the menu", () => {
    render(<Harness />);
    swipe(200);
    expect(useFilesMenu.getState()).toMatchObject({ open: true, dragging: false });
  });

  it("a short slow swipe lets it fall closed", () => {
    render(<Harness />);
    swipe(40);
    expect(useFilesMenu.getState()).toMatchObject({ open: false, dragging: false });
  });

  it("a quick flick opens it", () => {
    render(<Harness />);
    swipe(30, 800);
    expect(useFilesMenu.getState().open).toBe(true);
  });

  it("is off while the browser is selecting or dragging", () => {
    useFilesInteraction.setState({ busy: true });
    render(<Harness />);
    const gesture = getByGestureTestId("files-menu-edge") as unknown as { config: { enabled?: boolean } };
    expect(gesture.config.enabled).toBe(false);
  });

  it("a pan that began and failed (a scroll flick from the strip) never opens it", () => {
    render(<Harness />);
    act(() => {
      fireGestureHandler(getByGestureTestId("files-menu-edge"), [
        { state: State.BEGAN, translationX: 0, velocityX: 0 },
        { state: State.FAILED, translationX: 30, velocityX: 800 },
      ]);
    });
    expect(useFilesMenu.getState()).toMatchObject({ open: false, dragging: false });
  });
});
