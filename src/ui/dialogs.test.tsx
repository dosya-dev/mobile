import { render, screen, fireEvent } from "@testing-library/react-native";
import { ConfirmDialog } from "./ConfirmDialog";
import { PromptDialog } from "./PromptDialog";

describe("ConfirmDialog", () => {
  it("fires onConfirm", () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog visible title="Delete?" message="Sure?" confirmLabel="Delete" destructive onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.press(screen.getByText("Delete"));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("PromptDialog", () => {
  it("submits the entered text", () => {
    const onSubmit = jest.fn();
    render(<PromptDialog visible title="Rename" initialValue="a.txt" onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.changeText(screen.getByTestId("prompt-input"), "b.txt");
    fireEvent.press(screen.getByText("Save"));
    expect(onSubmit).toHaveBeenCalledWith("b.txt");
  });
});
