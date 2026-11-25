// The inline name editor: saves through the engine (journaled for the user's
// other devices), keeps the field open with the reason on a refusal, refuses
// an empty name itself, cancels unchanged.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { PersonaNameField } from "./NameField";

const engineError = (code: string) => Object.assign(new Error(code), { name: "PersonasEngineError", code });

afterEach(async () => { await act(async () => {}); });

it("saves the trimmed name on Done", async () => {
  const engine = { rename: jest.fn(async () => {}) };
  const onSaved = jest.fn();
  render(<PersonaNameField engine={engine} personaId="p1" initial="" onSaved={onSaved} onCancel={jest.fn()} />);
  fireEvent.changeText(screen.getByTestId("persona-name-input"), "  Alex ");
  fireEvent(screen.getByTestId("persona-name-input"), "submitEditing");
  await act(async () => {});
  expect(engine.rename).toHaveBeenCalledWith("p1", "Alex");
  expect(onSaved).toHaveBeenCalledTimes(1);
});

it("refuses an empty name without asking the engine", () => {
  const engine = { rename: jest.fn(async () => {}) };
  render(<PersonaNameField engine={engine} personaId="p1" initial="" onSaved={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.press(screen.getByTestId("persona-name-save"));
  expect(screen.getByText("Type a name.")).toBeTruthy();
  expect(engine.rename).not.toHaveBeenCalled();
});

it("keeps the field open and says why when the name is taken, invalid or could not be saved", async () => {
  const engine = { rename: jest.fn() };
  render(<PersonaNameField engine={engine} personaId="p1" initial="" onSaved={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.changeText(screen.getByTestId("persona-name-input"), "Sam");
  engine.rename.mockRejectedValueOnce(engineError("name_taken"));
  fireEvent.press(screen.getByTestId("persona-name-save"));
  expect(await screen.findByText("Another persona already has this name.")).toBeTruthy();
  engine.rename.mockRejectedValueOnce(engineError("name_invalid"));
  fireEvent.press(screen.getByTestId("persona-name-save"));
  expect(await screen.findByText("Use a name of 1 to 60 characters.")).toBeTruthy();
  engine.rename.mockRejectedValueOnce(new Error("offline"));
  fireEvent.press(screen.getByTestId("persona-name-save"));
  expect(await screen.findByText("The name could not be saved. Try again.")).toBeTruthy();
  expect(screen.getByTestId("persona-name-input")).toBeTruthy();
});

it("an unchanged name cancels; the cross cancels; the controls are labelled", () => {
  const engine = { rename: jest.fn(async () => {}) };
  const onCancel = jest.fn();
  render(<PersonaNameField engine={engine} personaId="p1" initial="Alex" onSaved={jest.fn()} onCancel={onCancel} />);
  fireEvent.press(screen.getByTestId("persona-name-save"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("persona-name-input").props.accessibilityLabel).toBe("Name");
  expect(screen.getByTestId("persona-name-cancel").props.accessibilityLabel).toBe("Cancel");
  fireEvent.press(screen.getByTestId("persona-name-cancel"));
  expect(onCancel).toHaveBeenCalledTimes(2);
  expect(engine.rename).not.toHaveBeenCalled();
});
