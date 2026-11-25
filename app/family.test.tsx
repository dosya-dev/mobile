import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react-native";
import FamilyScreen from "./family";
import { useFamily } from "@/family/hooks";
import * as api from "@/family/api";
import { toast } from "@/ui/toast";
import { ApiError } from "@/api/errors";
import { useAppearance } from "@/theme/themeStore";
import { SWATCHES } from "@/theme/palette";

jest.mock("@/family/hooks", () => ({ useFamily: jest.fn(), FAMILY_KEY: ["family"] }));
const mockBack = jest.fn();
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ back: mockBack }) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ ...jest.requireActual("@tanstack/react-query"), useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

const mockUseFamily = useFamily as jest.Mock;
const pool = { used_bytes: 300, limit_bytes: 1000, used_label: "300 GB", limit_label: "1 TB" };
const PAYER = {
  ok: true, role: "payer", limit: 7, included: 5, extra_places: 2, can_buy_places: true, over_capacity: false,
  eligible: true, ineligible_reason: null, pool, plan: { id: "pro", name: "Pro" }, payer: null,
  members: [
    { id: "fm_a", email: "ada@x.test", name: "Ada", status: "active", joined_at: 1, expires_at: null, over_free: false },
    { id: "fm_b", email: "bo@x.test", name: null, status: "invited", joined_at: null, expires_at: 2_000_000_000 },
  ],
  usage: [
    { id: "u_me", name: "Me", is_you: true, is_payer: true, used_bytes: 200, used_label: "200 GB" },
    { id: "u_a", name: "Ada", is_you: false, is_payer: false, used_bytes: 100, used_label: "100 GB" },
  ],
};
const MEMBER = { ok: true, role: "member", limit: 5, eligible: false, ineligible_reason: "is_member", pool, plan: { id: "pro", name: "Pro" }, payer: { name: "Ayşe" }, members: null, own_used_label: "7 GB" };
const ret = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false });

beforeEach(() => { mockUseFamily.mockReset(); mockInvalidate.mockReset(); mockBack.mockReset(); (toast as jest.Mock).mockReset(); jest.restoreAllMocks(); });

it("payer: lists people, shows the counter with places, offers an invite field", () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  render(<FamilyScreen />);
  expect(screen.getByText("Ada")).toBeTruthy();
  expect(screen.getByText("bo@x.test")).toBeTruthy();
  expect(screen.getByText("2 of 7 places used (5 included, 2 extra)")).toBeTruthy();
  expect(screen.getByTestId("family-invite-email")).toBeTruthy();
});

it("invites and clears the field; on refusal keeps the address and toasts the server message", async () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  const invite = jest.spyOn(api, "inviteFamilyMember").mockRejectedValueOnce(new Error("All 7 places are taken")).mockResolvedValueOnce({ ok: true });
  render(<FamilyScreen />);
  fireEvent.changeText(screen.getByTestId("family-invite-email"), "new@x.test");
  fireEvent.press(screen.getByTestId("family-invite"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("All 7 places are taken", "error"));
  expect(screen.getByTestId("family-invite-email").props.value).toBe("new@x.test");
  fireEvent.press(screen.getByTestId("family-invite"));
  await waitFor(() => expect(invite).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Invitation sent"));
  await waitFor(() => expect(screen.getByTestId("family-invite-email").props.value).toBe(""));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["family"] });
});

it("remove, revoke and resend each confirm first, then call the endpoint", async () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  const remove = jest.spyOn(api, "removeFamilyMember").mockResolvedValue({ ok: true });
  const revoke = jest.spyOn(api, "revokeFamilyInvite").mockResolvedValue({ ok: true });
  const resend = jest.spyOn(api, "inviteFamilyMember").mockResolvedValue({ ok: true });
  render(<FamilyScreen />);
  fireEvent.press(screen.getByTestId("family-remove-fm_a"));
  expect(screen.getByText("Remove Ada from your family plan?")).toBeTruthy();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText("Remove"));
  await waitFor(() => expect(remove).toHaveBeenCalledWith("fm_a"));
  await waitFor(() => expect(screen.getByTestId("family-remove-fm_b")).not.toBeDisabled());

  fireEvent.press(screen.getByTestId("family-remove-fm_b"));
  expect(screen.getByText("Revoke the invitation to bo@x.test?")).toBeTruthy();
  fireEvent.press(screen.getByText("Revoke"));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith("fm_b"));
  await waitFor(() => expect(screen.getByTestId("family-remove-fm_b")).not.toBeDisabled());

  fireEvent.press(screen.getByTestId("family-resend-fm_b"));
  expect(screen.getByText("Send the invitation to bo@x.test again?")).toBeTruthy();
  fireEvent.press(screen.getByText("Send again"));
  await waitFor(() => expect(resend).toHaveBeenCalledWith("bo@x.test"));
});

it("member: names the payer, no invite field or remove buttons, Leave confirms with own usage", async () => {
  mockUseFamily.mockReturnValue(ret(MEMBER));
  const leave = jest.spyOn(api, "leaveFamily").mockResolvedValue({ ok: true });
  render(<FamilyScreen />);
  expect(screen.getByText(/Ayşe/)).toBeTruthy();
  expect(screen.queryByTestId("family-invite-email")).toBeNull();
  expect(screen.queryByTestId("family-remove-fm_a")).toBeNull();
  fireEvent.press(screen.getByTestId("family-leave"));
  expect(screen.getByText("Leave Ayşe's family plan?")).toBeTruthy();
  expect(screen.getByText(/You currently store 7 GB\./)).toBeTruthy();
  fireEvent.press(screen.getByText("Leave"));
  await waitFor(() => expect(leave).toHaveBeenCalled());
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["family"] });
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["workspace-dashboard"] });
  await waitFor(() => expect(mockBack).toHaveBeenCalled());
});

it("over capacity: explains without purchase wording and disables inviting", () => {
  mockUseFamily.mockReturnValue(ret({ ...PAYER, limit: 1, included: 1, extra_places: 0, over_capacity: true }));
  render(<FamilyScreen />);
  expect(screen.getByText("You have more people than places. Nobody has been removed; new invitations wait until someone leaves.")).toBeTruthy();
  expect(screen.getByTestId("family-invite")).toBeDisabled();
});

it("never shows a price, an upgrade, a purchase or a web link", () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  const { toJSON } = render(<FamilyScreen />);
  // Collect what a person can read or hear: text children plus labels and placeholders.
  const words: string[] = [];
  const walk = (n: any) => {
    if (typeof n === "string") { words.push(n); return; }
    if (!n) return;
    for (const k of ["accessibilityLabel", "placeholder"]) if (typeof n.props?.[k] === "string") words.push(n.props[k]);
    (n.children ?? []).forEach(walk);
  };
  const root = toJSON() as any;
  (Array.isArray(root) ? root : [root]).forEach(walk);
  expect(words.length).toBeGreaterThan(5);
  expect(words.join("\n")).not.toMatch(/\$|upgrade|paid plan|buy|Manage places/i);
});

it("Usage tab lists every person and the free space", () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  render(<FamilyScreen />);
  fireEvent.press(screen.getByTestId("family-tab-usage"));
  expect(screen.getByText("200 GB")).toBeTruthy();
  expect(screen.getByText("100 GB")).toBeTruthy();
  expect(screen.getByText("Free in the pool")).toBeTruthy();
});

it("lapsed payer: no resend control, revoke still offered", () => {
  mockUseFamily.mockReturnValue(ret({ ...PAYER, eligible: false, ineligible_reason: "free_plan" }));
  render(<FamilyScreen />);
  expect(screen.queryByTestId("family-resend-fm_b")).toBeNull();
  expect(screen.getByTestId("family-remove-fm_b")).toBeTruthy();
});

it("a free_plan refusal toasts the plain sentence", async () => {
  mockUseFamily.mockReturnValue(ret(PAYER));
  jest.spyOn(api, "inviteFamilyMember").mockRejectedValueOnce(new ApiError("Family sharing needs a paid plan", 403, "free_plan"));
  render(<FamilyScreen />);
  fireEvent.press(screen.getByTestId("family-resend-fm_b"));
  fireEvent.press(screen.getByText("Send again"));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Your plan has ended, so you cannot invite anyone new.", "error"));
});

it("after leaving, never shows 'plan has ended' or a places counter", () => {
  mockUseFamily.mockReturnValue(ret({ ...PAYER, role: "none", eligible: false, members: [], usage: [PAYER.usage[0]] }));
  render(<FamilyScreen />);
  expect(screen.getByText("You are not in a family plan.")).toBeTruthy();
  expect(screen.queryByText(/Your plan has ended/)).toBeNull();
  expect(screen.queryByText(/places used/)).toBeNull();
  expect(screen.queryByTestId("family-tab-usage")).toBeNull();
});

// ---- storage reservations + the redesigned screen (mirrors the desktop's FamilySection tests) ----
const GBn = 1024 ** 3;
// The example family on a 1 TB plan (1000 GB pool): Emma has 200 GB reserved, Sam 150 GB.
const reservedFamily = (over: Record<string, unknown> = {}) => ({
  ok: true, role: "payer", limit: 5, included: 5, extra_places: 0, can_buy_places: true, over_capacity: false, eligible: true, ineligible_reason: null,
  pool: { used_bytes: 703 * GBn, limit_bytes: 1000 * GBn, used_label: "703 GB", limit_label: "1 TB", reserved_bytes: 350 * GBn, held_bytes: 70 * GBn, free_bytes: 227 * GBn },
  reservations_exceed_pool: false,
  plan: { id: "pro", name: "Pro" }, payer: null,
  members: [
    { id: "fm_e", email: "emma@example.com", name: "Emma", status: "active", joined_at: 1, expires_at: null, reserved_bytes: 200 * GBn, used_bytes: 184 * GBn, max_reservable_bytes: 427 * GBn, user_id: "u_emma" },
    { id: "fm_s", email: "sam@example.com", name: "Sam", status: "active", joined_at: 1, expires_at: null, reserved_bytes: 150 * GBn, used_bytes: 96 * GBn, max_reservable_bytes: 377 * GBn, user_id: "u_sam" },
    { id: "fm_m", email: "mia@example.com", name: "Mia", status: "active", joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 72 * GBn, max_reservable_bytes: 299 * GBn, user_id: "u_mia" },
    { id: "fm_l", email: "leo@example.com", name: "Leo", status: "active", joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 41 * GBn, max_reservable_bytes: 268 * GBn, user_id: "u_leo" },
    { id: "fm_a", email: "ava@example.com", name: null, status: "invited", joined_at: null, expires_at: 2_000_000_000, reserved_bytes: null, user_id: null },
  ],
  usage: [
    { id: "u_alex", name: "Alex", is_you: true, is_payer: true, used_bytes: 310 * GBn, used_label: "310 GB", reserved_bytes: null },
    { id: "u_emma", name: "Emma", is_you: false, is_payer: false, used_bytes: 184 * GBn, used_label: "184 GB", reserved_bytes: 200 * GBn },
    { id: "u_sam", name: "Sam", is_you: false, is_payer: false, used_bytes: 96 * GBn, used_label: "96 GB", reserved_bytes: 150 * GBn },
    { id: "u_mia", name: "Mia", is_you: false, is_payer: false, used_bytes: 72 * GBn, used_label: "72 GB", reserved_bytes: null },
    { id: "u_leo", name: "Leo", is_you: false, is_payer: false, used_bytes: 41 * GBn, used_label: "41 GB", reserved_bytes: null },
  ],
  ...over,
});
const memberView = (over: Record<string, unknown> = {}) => {
  const f = reservedFamily();
  return { ...f, role: "member", eligible: false, ineligible_reason: "is_member", payer: { name: "Alex" }, members: null,
    usage: f.usage.map((u) => ({ ...u, is_you: u.name === "Emma" })),
    own_used_bytes: 184 * GBn, own_used_label: "184 GB", own_reserved_bytes: 200 * GBn, ...over };
};
const row = (key: string) => within(screen.getByTestId(`family-row-${key}`));
const chips = () => screen.getAllByTestId("family-chip").map((c) => [].concat(within(c).getByText(/.+/).props.children).join(""));
// Avatars are decoration (hidden from screen readers), so their queries include hidden elements.
const avatar = (id: string) => screen.getByTestId(`family-avatar-${id}`, { includeHiddenElements: true });
const flat = (s: unknown) => Object.assign({}, ...([] as unknown[]).concat(s as never).flat(Infinity as 1).filter(Boolean)) as Record<string, unknown>;

describe("reservations", () => {
  afterEach(() => { act(() => useAppearance.setState({ mode: "system" })); });

  it("header chips name the plan and the places; the pool line counts the reservations", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    expect(chips()).toEqual(["Pro · 1 TB", "5 places included"]);
    expect(screen.getByText("703 GB of 1 TB used · 350 GB reserved for 2 people.")).toBeTruthy();
  });

  it("member view: the chips say Shared with you", () => {
    mockUseFamily.mockReturnValue(ret(memberView()));
    render(<FamilyScreen />);
    expect(chips()).toEqual(["Pro · 1 TB", "Shared with you"]);
  });

  it("rows: the payer pays the plan, an invitation has a dashed avatar, reservations show on the row", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    expect(row("u_alex").getByText("Alex (you)")).toBeTruthy();
    expect(row("u_alex").getByText("Pays the plan")).toBeTruthy();
    expect(row("u_alex").getByText("310 GB · shares the pool")).toBeTruthy();
    expect(row("fm_a").getByText("Invited")).toBeTruthy();
    expect(flat(avatar("fm_a").props.style).borderStyle).toBe("dashed");
    expect(row("fm_e").getByText("184 of 200 GB reserved")).toBeTruthy();
    expect(within(screen.getByTestId("family-reserve-fm_e")).getByText("200 GB")).toBeTruthy();
    expect(row("fm_m").getByText("72 GB · shares the pool")).toBeTruthy();
    expect(within(screen.getByTestId("family-reserve-fm_m")).getByText("Reserve")).toBeTruthy();
    expect(screen.getByTestId("family-reserve-fm_m").props.accessibilityLabel).toBe("Reserve storage for Mia");
    expect(screen.getByTestId("family-reserve-fm_e").props.accessibilityLabel).toBe("Change Emma’s reservation");
    // Invitations get no reservation control; the row actions keep their names.
    expect(screen.queryByTestId("family-reserve-fm_a")).toBeNull();
    expect(screen.getByTestId("family-remove-fm_e").props.accessibilityLabel).toBe("Remove Emma");
    expect(screen.getByTestId("family-remove-fm_a").props.accessibilityLabel).toBe("Revoke invitation to ava@example.com");
  });

  it("+ Reserve opens the sheet for that person with the max the server allows", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    fireEvent.press(screen.getByTestId("family-reserve-fm_m"));
    const s = within(screen.getByTestId("reservation-sheet"));
    expect(s.getByText("Reserve storage for Mia")).toBeTruthy();
    for (const pick of ["50", "100", "200", "Max 299"]) expect(s.getByText(pick)).toBeTruthy();
  });

  it("saving a reservation closes the sheet and refreshes the family and the storage figures", async () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    const put = jest.spyOn(api, "setFamilyReservation").mockResolvedValue({ ok: true });
    render(<FamilyScreen />);
    fireEvent.press(screen.getByTestId("family-reserve-fm_m"));
    fireEvent.press(screen.getByTestId("reservation-save"));
    await act(async () => {});
    expect(put).toHaveBeenCalledWith("fm_m", 100);
    expect(screen.queryByTestId("reservation-sheet")).toBeNull();
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["family"] });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["workspace-dashboard"] });
  });

  it("the reservation button opens the change sheet, and Remove asks Are you sure?", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    fireEvent.press(screen.getByTestId("family-reserve-fm_e"));
    expect(within(screen.getByTestId("reservation-sheet")).getByText("Change Emma’s reservation")).toBeTruthy();
    fireEvent.press(screen.getByTestId("reservation-remove"));
    expect(screen.getByText("Are you sure?")).toBeTruthy();
    expect(screen.getByText("You are ending Emma’s 200 GB reservation. Their files stay. They share the free space in the pool again.")).toBeTruthy();
  });

  it("a lapsed payer gets no reservation controls", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily({ eligible: false, ineligible_reason: "free_plan", plan: { id: "free", name: "Free" } })));
    render(<FamilyScreen />);
    expect(screen.queryByTestId("family-reserve-fm_e")).toBeNull();
    expect(screen.queryByTestId("family-reserve-fm_m")).toBeNull();
    expect(row("fm_e").getByText("Joined")).toBeTruthy();
  });

  it("an older API without reservation fields shows the email and Joined, no reservation controls", () => {
    mockUseFamily.mockReturnValue(ret(PAYER));
    render(<FamilyScreen />);
    expect(row("fm_a").getByText("ada@x.test")).toBeTruthy();
    expect(row("fm_a").getByText("Joined")).toBeTruthy();
    expect(screen.queryByTestId("family-reserve-fm_a")).toBeNull();
  });

  it("member view: the reserved member sees their own reservation", () => {
    mockUseFamily.mockReturnValue(ret(memberView()));
    render(<FamilyScreen />);
    expect(screen.getByText("Reserved for you by Alex")).toBeTruthy();
    expect(screen.getByText("184 of 200 GB")).toBeTruthy();
    expect(screen.getByText("This space is yours alone. Uploads stop at 200 GB.")).toBeTruthy();
    expect(row("u_emma").getByText("Emma (you)")).toBeTruthy();
    expect(row("u_alex").getByText("Pays the plan")).toBeTruthy();
    expect(row("u_sam").getByText("Joined")).toBeTruthy();
    expect(screen.getByTestId("family-leave")).toBeTruthy();
    expect(screen.queryByText("Reserve")).toBeNull();
  });

  it("member without a reservation sees no reservation box", () => {
    mockUseFamily.mockReturnValue(ret(memberView({ own_reserved_bytes: null, usage: reservedFamily().usage.map((u) => ({ ...u, is_you: u.name === "Mia" })) })));
    render(<FamilyScreen />);
    expect(screen.queryByText("Reserved for you by Alex")).toBeNull();
  });

  it("reservations over the pool: the payer is told to lower them", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily({ reservations_exceed_pool: true })));
    render(<FamilyScreen />);
    expect(screen.getByText("Reservations add up to more than your plan. Lower them so everyone can upload.")).toBeTruthy();
  });

  it("Members and Usage sit behind the pill toggle", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    expect(screen.getAllByRole("tab").map((t) => t.props.testID)).toEqual(["family-tab-members", "family-tab-usage"]);
    expect(screen.getByTestId("family-tab-members").props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.queryByTestId("family-usage")).toBeNull();
    fireEvent.press(screen.getByTestId("family-tab-usage"));
    expect(screen.getByTestId("family-tab-usage").props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(screen.getByTestId("family-usage")).toBeTruthy();
  });

  it("usage legend splits what is free to share from what is held for reservations", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    fireEvent.press(screen.getByTestId("family-tab-usage"));
    expect(within(screen.getByTestId("family-legend-free")).getByText("227 GB")).toBeTruthy();
    expect(within(screen.getByTestId("family-legend-free")).getByText("Free to share")).toBeTruthy();
    expect(within(screen.getByTestId("family-legend-held")).getByText("70 GB")).toBeTruthy();
    expect(within(screen.getByTestId("family-legend-held")).getByText("Held for reservations")).toBeTruthy();
    expect(screen.getByText("184 of 200 GB")).toBeTruthy();
    expect(screen.getByText("350 GB reserved")).toBeTruthy();
    expect(screen.getByText("of 1 TB · 70%")).toBeTruthy();
    expect(screen.queryByText("Free in the pool")).toBeNull();
  });

  it("two members with the same name keep their own colours: rows match usage by user id", () => {
    act(() => useAppearance.setState({ mode: "light" }));
    const f = reservedFamily();
    const members = [
      { id: "fm_a", email: "sam.a@example.com", name: "Sam", status: "active", joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 10 * GBn, max_reservable_bytes: 100 * GBn, user_id: "sam_a" },
      { id: "fm_b", email: "sam.b@example.com", name: "Sam", status: "active", joined_at: 1, expires_at: null, reserved_bytes: null, used_bytes: 96 * GBn, max_reservable_bytes: 100 * GBn, user_id: "sam_b" },
    ];
    const usage = [
      { id: "u_alex", name: "Alex", is_you: true, is_payer: true, used_bytes: 310 * GBn, used_label: "310 GB", reserved_bytes: null },
      { id: "sam_b", name: "Sam", is_you: false, is_payer: false, used_bytes: 96 * GBn, used_label: "96 GB", reserved_bytes: null },
      { id: "sam_a", name: "Sam", is_you: false, is_payer: false, used_bytes: 10 * GBn, used_label: "10 GB", reserved_bytes: null },
    ];
    mockUseFamily.mockReturnValue(ret({ ...f, members, usage, pool: { ...f.pool, reserved_bytes: 0, held_bytes: 0 } }));
    render(<FamilyScreen />);
    expect(flat(avatar("fm_b").props.style).backgroundColor).toBe(SWATCHES[1].light);
    expect(flat(avatar("fm_a").props.style).backgroundColor).toBe(SWATCHES[2].light);
  });

  it("person colours follow a theme change while the screen is open", () => {
    act(() => useAppearance.setState({ mode: "light" }));
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    expect(flat(avatar("fm_e").props.style).backgroundColor).toBe(SWATCHES[1].light);
    act(() => useAppearance.setState({ mode: "dark" }));
    expect(flat(avatar("fm_e").props.style).backgroundColor).toBe(SWATCHES[1].dark);
  });

  it("a reservation line uses one number format on both sides (whole GB, grouped)", () => {
    const f = reservedFamily();
    mockUseFamily.mockReturnValue(ret({ ...f, members: f.members.map((m) => m.id === "fm_e" ? { ...m, used_bytes: 1234.4 * GBn, reserved_bytes: 2000 * GBn } : m.id === "fm_s" ? { ...m, used_bytes: 7.6 * GBn } : m) }));
    render(<FamilyScreen />);
    expect(row("fm_e").getByText("1,234 of 2,000 GB reserved")).toBeTruthy();
    expect(row("fm_s").getByText("8 of 150 GB reserved")).toBeTruthy();
  });

  it("never offers buying places, even when the API says the payer can", () => {
    mockUseFamily.mockReturnValue(ret(reservedFamily()));
    render(<FamilyScreen />);
    expect(screen.queryByText(/Add places|Purchase|Manage places/)).toBeNull();
  });
});

it("the reservation pill and Leave report disabled while an action runs", async () => {
  mockUseFamily.mockReturnValue(ret(reservedFamily()));
  let resolve: (v: { ok: true }) => void = () => {};
  jest.spyOn(api, "removeFamilyMember").mockReturnValue(new Promise((r) => { resolve = r; }));
  render(<FamilyScreen />);
  expect(screen.getByTestId("family-reserve-fm_e").props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  fireEvent.press(screen.getByTestId("family-remove-fm_m"));
  fireEvent.press(screen.getByText("Remove"));
  await waitFor(() => expect(screen.getByTestId("family-reserve-fm_e").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true })));
  await act(async () => { resolve({ ok: true }); });
});

it("member Leave reports disabled while leaving", async () => {
  mockUseFamily.mockReturnValue(ret(memberView()));
  let resolve: (v: { ok: true }) => void = () => {};
  jest.spyOn(api, "leaveFamily").mockReturnValue(new Promise((r) => { resolve = r; }));
  render(<FamilyScreen />);
  expect(screen.getByTestId("family-leave").props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  fireEvent.press(screen.getByTestId("family-leave"));
  fireEvent.press(screen.getByText("Leave"));
  await waitFor(() => expect(screen.getByTestId("family-leave").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true })));
  await act(async () => { resolve({ ok: true }); });
});
