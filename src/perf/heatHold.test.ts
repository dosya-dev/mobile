jest.mock("./thermal", () => ({ getThermalState: jest.fn(() => "nominal") }));

import { getThermalState } from "./thermal";
import { usePlayerStore } from "@/player/playerStore";
import { isAutoWorkHeld, isPhoneHot } from "./heatHold";

beforeEach(() => {
  (getThermalState as jest.Mock).mockReturnValue("nominal");
  usePlayerStore.setState({ listening: false });
});

describe("isAutoWorkHeld", () => {
  it("lets automatic work run on a cool, quiet phone", () => {
    expect(isAutoWorkHeld()).toBe(false);
  });

  it("holds while music is playing", () => {
    usePlayerStore.setState({ listening: true });
    expect(isAutoWorkHeld()).toBe(true);
  });

  it.each(["serious", "critical"])("holds at %s thermal", (state) => {
    (getThermalState as jest.Mock).mockReturnValue(state);
    expect(isPhoneHot()).toBe(true);
    expect(isAutoWorkHeld()).toBe(true);
  });

  it("a merely warm phone is not held", () => {
    (getThermalState as jest.Mock).mockReturnValue("fair");
    expect(isPhoneHot()).toBe(false);
    expect(isAutoWorkHeld()).toBe(false);
  });
});
