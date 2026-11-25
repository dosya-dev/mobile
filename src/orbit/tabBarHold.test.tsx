import { render } from "@testing-library/react-native";
import { holdTabBar, releaseTabBar, useTabBarHold, useTabBarHolds } from "./tabBarHold";

beforeEach(() => useTabBarHolds.setState({ holds: [] }));

function Holder(props: { active: boolean }) {
  useTabBarHold("screen-a", props.active);
  return null;
}

describe("tab bar holds", () => {
  it("counts each name once and releases only its own", () => {
    holdTabBar("a");
    holdTabBar("a");
    holdTabBar("b");
    expect(useTabBarHolds.getState().holds).toEqual(["a", "b"]);
    releaseTabBar("a");
    expect(useTabBarHolds.getState().holds).toEqual(["b"]);
  });

  it("holds while active and lets go when inactive or unmounted", () => {
    const { rerender, unmount } = render(<Holder active />);
    expect(useTabBarHolds.getState().holds).toEqual(["screen-a"]);
    rerender(<Holder active={false} />);
    expect(useTabBarHolds.getState().holds).toEqual([]);
    rerender(<Holder active />);
    unmount();
    expect(useTabBarHolds.getState().holds).toEqual([]);
  });
});
