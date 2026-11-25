import { render, screen, fireEvent } from "@testing-library/react-native";
import { PromptDialog } from "./PromptDialog";

const noop = () => {};

describe("PromptDialog", () => {
  it("shows the hint under the field when one is given", () => {
    render(
      <PromptDialog
        visible
        title="Create new folder"
        hint="Use / to create nested folders. e.g. Projects/Q2/Designs creates 3 levels."
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByTestId("prompt-hint")).toBeTruthy();
    expect(screen.getByText(/Use \/ to create nested folders/)).toBeTruthy();
  });

  it("renders no hint element when none is given", () => {
    render(<PromptDialog visible title="Rename folder" onSubmit={noop} onCancel={noop} />);
    expect(screen.queryByTestId("prompt-hint")).toBeNull();
  });

  it("submits the trimmed text", () => {
    const onSubmit = jest.fn();
    render(<PromptDialog visible title="Create new folder" onSubmit={onSubmit} onCancel={noop} />);
    fireEvent.changeText(screen.getByTestId("prompt-input"), "  Projects/Q2/Designs  ");
    fireEvent.press(screen.getByTestId("submit"));
    // The nested path must survive untouched - the server splits it on "/".
    expect(onSubmit).toHaveBeenCalledWith("Projects/Q2/Designs");
  });
});
