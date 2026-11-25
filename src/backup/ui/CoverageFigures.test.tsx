import { render, screen, fireEvent } from "@testing-library/react-native";
import { CoverageFigures } from "./CoverageFigures";

describe("CoverageFigures", () => {
  it("shows backed-up, pending, and failed counts", () => {
    render(<CoverageFigures uploaded={1204} pending={37} failed={0} skipped={0} />);
    expect(screen.getByTestId("count-uploaded")).toHaveTextContent("1204");
    expect(screen.getByTestId("count-pending")).toHaveTextContent("37");
    expect(screen.getByTestId("count-error")).toHaveTextContent("0");
    expect(screen.queryByTestId("count-skipped")).toBeNull();
  });

  it("surfaces items skipped by the size limit apart from the pending count", () => {
    // Skipped items never retry, so folding them into pending would report
    // the backup as unfinished forever.
    render(<CoverageFigures uploaded={5} pending={0} failed={0} skipped={4} />);
    expect(screen.getByTestId("count-skipped")).toHaveTextContent("4 too large");
    expect(screen.getByTestId("count-pending")).toHaveTextContent("0");
  });

  it("makes the failed figure a way in when there are failures", () => {
    const onPress = jest.fn();
    render(<CoverageFigures uploaded={5} pending={0} failed={3} skipped={0} onPressFailed={onPress} />);
    fireEvent.press(screen.getByTestId("failed-tile"));
    expect(onPress).toHaveBeenCalled();
  });

  it("is pressable for size-capped items even with no failures", () => {
    const onPress = jest.fn();
    render(<CoverageFigures uploaded={5} pending={0} failed={0} skipped={2} onPressFailed={onPress} />);
    fireEvent.press(screen.getByTestId("failed-tile"));
    expect(onPress).toHaveBeenCalled();
  });

  it("is not pressable when nothing has failed or been skipped", () => {
    const onPress = jest.fn();
    render(<CoverageFigures uploaded={5} pending={0} failed={0} skipped={0} onPressFailed={onPress} />);
    fireEvent.press(screen.getByTestId("failed-tile"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
