// The reservation editor as a bottom sheet: the same strings and behaviour as
// the desktop's ReservationDialog (apps/desktop/src/renderer/components/family/
// ReservationDialog.test.tsx), with Remove behind the shared ConfirmDialog.
import { Keyboard } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { ReservationSheet } from "./ReservationSheet";
import * as api from "./api";
import { ApiError } from "@/api/errors";
import { useAppearance } from "@/theme/themeStore";
import { SWATCHES } from "@/theme/palette";
import { SHEET_DISMISS_DY } from "@/ui/SheetHandle";
import { dragSheetHandle } from "@/ui/sheetTesting";
import type { FamilyPerson } from "./people";
import type { FamilyMemberView } from "./types";

const GB = 1024 ** 3;

// The example family on a 1000 GB pool: Emma has 200 GB reserved, Sam 150 GB.
const person = (key: string, name: string, colorIndex: number, used: number, reserved: number | null, isPayer = false): FamilyPerson =>
  ({ key, name, isYou: isPayer, isPayer, colorIndex, used: used * GB, usedLabel: `${used} GB`, reserved: reserved === null ? null : reserved * GB });
const people: FamilyPerson[] = [
  person("alex", "Alex", 0, 310, null, true),
  person("emma", "Emma", 1, 184, 200),
  person("sam", "Sam", 2, 96, 150),
  person("mia", "Mia", 3, 72, null),
  person("leo", "Leo", 4, 41, null),
];
const mia: FamilyMemberView = { id: "fm_m", email: "mia@example.com", name: "Mia", status: "active", joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 72 * GB, max_reservable_bytes: 299 * GB, user_id: "mia" };
const emma: FamilyMemberView = { id: "fm_e", email: "emma@example.com", name: "Emma", status: "active", joined_at: 1, expires_at: null, reserved_bytes: 200 * GB, used_bytes: 184 * GB, max_reservable_bytes: 427 * GB, user_id: "emma" };

function open(member: FamilyMemberView, personKey: string, extra: { onSaved?: () => void; onClose?: () => void } = {}) {
  return render(<ReservationSheet member={member} personKey={personKey} people={people} poolLimit={1000 * GB}
    onClose={extra.onClose ?? jest.fn()} onSaved={extra.onSaved ?? jest.fn()} />);
}
const sheet = () => within(screen.getByTestId("reservation-sheet"));
const input = () => screen.getByTestId("reservation-gb");
const save = () => screen.getByTestId("reservation-save");
const flush = () => act(async () => {});

afterEach(async () => { await flush(); jest.restoreAllMocks(); act(() => useAppearance.setState({ mode: "system" })); });

it("new reservation: title, quick picks up to the max, and what it means", () => {
  open(mia, "mia");
  expect(sheet().getByText("Reserve storage for Mia")).toBeTruthy();
  expect(sheet().getByText("This space is held for Mia and is also their limit. Nobody else in the family can use it.")).toBeTruthy();
  for (const pick of ["50", "100", "200", "Max 299"]) expect(sheet().getByText(pick)).toBeTruthy();
  expect(input().props.value).toBe("100");
  expect(sheet().getByText("Mia uses 72 GB now. You can reserve up to 299 GB for them.")).toBeTruthy();
  expect(sheet().getByText("Reserve 100 GB")).toBeTruthy();
  expect(save()).not.toBeDisabled();
});

it("the GB field opens the number keyboard", () => {
  open(mia, "mia");
  expect(input().props.keyboardType).toBe("number-pad");
  expect(input().props.accessibilityLabel).toBe("Reservation in GB");
});

it("more than is free: says how much is free and disables the primary button", () => {
  open(mia, "mia");
  fireEvent.changeText(input(), "400");
  expect(sheet().getByText("Only 299 GB is free to reserve for Mia. Lower someone else’s reservation to free more.")).toBeTruthy();
  expect(sheet().getByText("Reserve 400 GB")).toBeTruthy();
  expect(save()).toBeDisabled();
  expect(sheet().getByText("Still free 0 GB")).toBeTruthy();
});

it("Max picks the most that fits and saving sends whole GB", async () => {
  const put = jest.spyOn(api, "setFamilyReservation").mockResolvedValue({ ok: true });
  const onSaved = jest.fn();
  open(mia, "mia", { onSaved });
  fireEvent.press(sheet().getByText("Max 299"));
  expect(input().props.value).toBe("299");
  fireEvent.press(save());
  await flush();
  expect(put).toHaveBeenCalledWith("fm_m", 299);
  expect(onSaved).toHaveBeenCalled();
});

it("a zero, empty or fractional amount cannot be saved", () => {
  open(mia, "mia");
  for (const v of ["0", "", "2.5", "1e3"]) {
    fireEvent.changeText(input(), v);
    expect(save()).toBeDisabled();
  }
});

it("the server refusing with a 409 shows its own max", async () => {
  jest.spyOn(api, "setFamilyReservation").mockRejectedValue(new ApiError("You can reserve up to 250 GB for this person", 409, "reservation_too_large", undefined, { ok: false, code: "reservation_too_large", max_gb: 250 }));
  open(mia, "mia");
  fireEvent.changeText(input(), "280");
  fireEvent.press(save());
  await flush();
  expect(sheet().getByText("Only 250 GB is free to reserve for Mia. Lower someone else’s reservation to free more.")).toBeTruthy();
  expect(save()).toBeDisabled();
});

it("any other refusal shows the server's message in the sheet", async () => {
  jest.spyOn(api, "setFamilyReservation").mockRejectedValue(new ApiError("Reservations need a paid plan", 403, "free_plan"));
  const onSaved = jest.fn();
  open(mia, "mia", { onSaved });
  fireEvent.press(save());
  await flush();
  expect(sheet().getByText("Reservations need a paid plan")).toBeTruthy();
  expect(onSaved).not.toHaveBeenCalled();
});

it("change below what they use: amber warning, still allowed", () => {
  open(emma, "emma");
  expect(sheet().getByText("Change Emma’s reservation")).toBeTruthy();
  expect(sheet().getByText("Emma has 200 GB reserved and uses 184 GB.")).toBeTruthy();
  expect(input().props.value).toBe("200");
  fireEvent.changeText(input(), "100");
  expect(screen.getByTestId("reservation-note-warn")).toHaveTextContent("Emma already uses 184 GB. With 100 GB their uploads stop until they are under 100 GB. Nothing is deleted.");
  expect(sheet().getByText("Save 100 GB")).toBeTruthy();
  expect(save()).not.toBeDisabled();
});

it("an unchanged amount cannot be saved", () => {
  open(emma, "emma");
  expect(sheet().getByText("Save 200 GB")).toBeTruthy();
  expect(save()).toBeDisabled();
});

it("Remove reservation asks Are you sure? first, Cancel goes back, then it removes", async () => {
  const put = jest.spyOn(api, "setFamilyReservation").mockResolvedValue({ ok: true });
  const onSaved = jest.fn();
  open(emma, "emma", { onSaved });
  fireEvent.press(screen.getByTestId("reservation-remove"));
  expect(put).not.toHaveBeenCalled();
  expect(screen.getByText("Are you sure?")).toBeTruthy();
  expect(screen.getByText("You are ending Emma’s 200 GB reservation. Their files stay. They share the free space in the pool again.")).toBeTruthy();
  const cancels = screen.getAllByText("Cancel");
  fireEvent.press(cancels[cancels.length - 1]);
  expect(screen.queryByText("Are you sure?")).toBeNull();
  expect(sheet().getByText("Change Emma’s reservation")).toBeTruthy();
  fireEvent.press(screen.getByTestId("reservation-remove"));
  fireEvent.press(screen.getByTestId("confirm"));
  await flush();
  expect(put).toHaveBeenCalledWith("fm_e", null);
  expect(onSaved).toHaveBeenCalled();
});

it("an overbooked pool still lets the payer lower a reservation", () => {
  open({ ...emma, max_reservable_bytes: 0 }, "emma");
  fireEvent.changeText(input(), "150");
  expect(save()).not.toBeDisabled();
  fireEvent.changeText(input(), "250");
  expect(save()).toBeDisabled();
});

it("the + stepper stops at the most that fits, the - stepper steps down", () => {
  open(mia, "mia");
  const plus = () => screen.getByTestId("reservation-more");
  fireEvent.press(screen.getByTestId("reservation-less"));
  expect(input().props.value).toBe("90");
  fireEvent.changeText(input(), "295");
  expect(plus()).not.toBeDisabled();
  fireEvent.press(plus());
  expect(input().props.value).toBe("299");
  expect(plus()).toBeDisabled();
  fireEvent.changeText(input(), "400");
  expect(plus()).toBeDisabled();
  expect(screen.getByTestId("reservation-less").props.accessibilityLabel).toBe("Less");
  expect(plus().props.accessibilityLabel).toBe("More");
});

it("Cancel, the backdrop and a drag down on the handle close without saving", () => {
  const put = jest.spyOn(api, "setFamilyReservation");
  const onClose = jest.fn();
  open(mia, "mia", { onClose });
  fireEvent.press(sheet().getByText("Cancel"));
  fireEvent.press(screen.getByTestId("reservation-backdrop"));
  dragSheetHandle(screen.getByTestId("reservation-handle"), 0, SHEET_DISMISS_DY + 20);
  expect(onClose).toHaveBeenCalledTimes(3);
  expect(put).not.toHaveBeenCalled();
});

it("does not close while a save is in flight", async () => {
  let resolve: (v: { ok: true }) => void = () => {};
  jest.spyOn(api, "setFamilyReservation").mockReturnValue(new Promise((r) => { resolve = r; }));
  const onClose = jest.fn();
  open(mia, "mia", { onClose });
  fireEvent.press(save());
  fireEvent.press(screen.getByTestId("reservation-backdrop"));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { resolve({ ok: true }); });
});

it("the pool preview follows a theme change while the sheet is open", () => {
  act(() => useAppearance.setState({ mode: "light" }));
  open(mia, "mia");
  const fill = () => screen.getByTestId("reservation-preview-me", { includeHiddenElements: true }).props.style;
  const flat = (s: unknown) => Object.assign({}, ...([] as unknown[]).concat(s as never).flat(Infinity as 1).filter(Boolean)) as { backgroundColor?: string };
  expect(flat(fill()).backgroundColor).toBe(SWATCHES[3].light);
  act(() => useAppearance.setState({ mode: "dark" }));
  expect(flat(fill()).backgroundColor).toBe(SWATCHES[3].dark);
});

it("screen readers reach the field, steppers and Save: no accessible element wraps them", () => {
  open(emma, "emma");
  const accessibleAncestor = (node: ReturnType<typeof screen.getByTestId>) => {
    for (let p = node.parent; p; p = p.parent) if (typeof p.type === "string" && p.props.accessible === true) return p.props.testID ?? p.props.accessibilityLabel ?? "?";
    return null;
  };
  for (const id of ["reservation-gb", "reservation-less", "reservation-more", "reservation-save", "reservation-remove"]) {
    expect([id, accessibleAncestor(screen.getByTestId(id))]).toEqual([id, null]);
  }
  // The backdrop is a sibling behind the panel, not its parent.
  expect(accessibleAncestor(screen.getByTestId("reservation-sheet"))).toBeNull();
});

it("a tap on the panel outside a control puts the keyboard away (number-pad has no return key)", () => {
  const dismiss = jest.spyOn(Keyboard, "dismiss");
  open(mia, "mia");
  const panel = screen.getByTestId("reservation-sheet");
  expect(panel.props.onStartShouldSetResponder()).toBe(true);
  fireEvent(panel, "responderRelease");
  expect(dismiss).toHaveBeenCalled();
});

it("Remove reports itself disabled while a save runs", async () => {
  let resolve: (v: { ok: true }) => void = () => {};
  jest.spyOn(api, "setFamilyReservation").mockReturnValue(new Promise((r) => { resolve = r; }));
  open(emma, "emma");
  expect(screen.getByTestId("reservation-remove").props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  fireEvent.changeText(input(), "250");
  fireEvent.press(save());
  expect(screen.getByTestId("reservation-remove").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  await act(async () => { resolve({ ok: true }); });
});
