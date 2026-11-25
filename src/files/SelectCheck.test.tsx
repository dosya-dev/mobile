import { render, screen } from "@testing-library/react-native";
import { SelectCheck } from "./SelectCheck";
import { SelectionMotionProvider } from "./selection/SelectionMotion";

const HIDDEN = { includeHiddenElements: true } as const;

describe("SelectCheck", () => {
  it("reports its checked state, with or without a grid position", () => {
    const view = render(
      <SelectionMotionProvider selecting>
        <SelectCheck selected={false} testID="c1" row={2} col={1} overlay />
        <SelectCheck selected testID="c2" />
      </SelectionMotionProvider>,
    );
    expect(screen.getByTestId("c1", HIDDEN).props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId("c2", HIDDEN).props.accessibilityState).toEqual({ checked: true });
    view.rerender(
      <SelectionMotionProvider selecting>
        <SelectCheck selected testID="c1" row={2} col={1} overlay />
        <SelectCheck selected testID="c2" />
      </SelectionMotionProvider>,
    );
    expect(screen.getByTestId("c1", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });

  it("renders outside a provider (a lone tile in a test or a ghost)", () => {
    render(<SelectCheck selected testID="lone" />);
    expect(screen.getByTestId("lone", HIDDEN).props.accessibilityState).toEqual({ checked: true });
  });
});
