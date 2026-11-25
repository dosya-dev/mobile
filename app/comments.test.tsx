import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { Keyboard, StyleSheet } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CommentsScreen from "./comments";
import { listComments, postComment, editComment, deleteComment } from "@/comments/api";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ fileId: "f1", name: "report.pdf" }),
}));
jest.mock("@/comments/api", () => ({
  MAX_COMMENT_LENGTH: 5000,
  listComments: jest.fn(),
  postComment: jest.fn(),
  editComment: jest.fn(),
  deleteComment: jest.fn(),
}));
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [{ id: "w1" }] }) }));

const mockRole = { current: "member" as string | null };
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ userId: "u1", roleName: mockRole.current, can: () => true }),
}));

const mockList = listComments as jest.MockedFunction<typeof listComments>;
const mockPost = postComment as jest.MockedFunction<typeof postComment>;
const mockEdit = editComment as jest.MockedFunction<typeof editComment>;
const mockDelete = deleteComment as jest.MockedFunction<typeof deleteComment>;

const now = Math.floor(Date.now() / 1000);

function c(over: Record<string, unknown> = {}) {
  return {
    id: "c1", file_id: "f1", folder_id: null, workspace_id: "w1",
    user_id: "u1", parent_id: null, body: "hello", is_edited: 0,
    created_at: now, updated_at: now,
    user_name: "Ada", user_email: "a@b.c", user_avatar: null,
    ...over,
  } as any;
}

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CommentsScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole.current = "member";
  mockList.mockResolvedValue([c()]);
  mockPost.mockResolvedValue(c({ id: "c2" }));
  mockEdit.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

describe("CommentsScreen", () => {
  it("keeps the composer above the keyboard on Android and iOS alike", async () => {
    const listeners: Record<string, (e: { endCoordinates: { height: number } }) => void> = {};
    const spy = jest.spyOn(Keyboard, "addListener").mockImplementation(((name: string, fn: (e: { endCoordinates: { height: number } }) => void) => {
      listeners[name] = fn;
      return { remove: () => {} };
    }) as never);
    renderScreen();
    const lift = () => StyleSheet.flatten(screen.getByTestId("comments-body").props.style).paddingBottom;
    expect(lift()).toBe(0);
    act(() => (listeners.keyboardDidShow ?? listeners.keyboardWillShow)({ endCoordinates: { height: 300 } }));
    expect(lift()).toBeGreaterThan(0);
    act(() => (listeners.keyboardDidHide ?? listeners.keyboardWillHide)({ endCoordinates: { height: 0 } }));
    expect(lift()).toBe(0);
    spy.mockRestore();
  });

  it("renders the thread", async () => {
    mockList.mockResolvedValue([c({ id: "c1" }), c({ id: "c2", user_id: "u2", user_name: "Grace" })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    expect(screen.getByTestId("comment-c2")).toBeTruthy();
  });

  it("invites the first comment instead of showing a blank screen", async () => {
    mockList.mockResolvedValue([]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comments-empty")).toBeTruthy());
  });

  it("distinguishes a failed load from an empty thread", async () => {
    mockList.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comments-error")).toBeTruthy());
    expect(screen.queryByTestId("comments-empty")).toBeNull();
    expect(screen.getByTestId("comments-retry")).toBeTruthy();
  });

  it("posts a comment and clears the composer", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("comments-input"), "nice work");
    fireEvent.press(screen.getByTestId("comments-send"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", fileId: "f1", body: "nice work" }),
    ));
    await waitFor(() => expect(screen.getByTestId("comments-input").props.value).toBe(""));
  });

  it("keeps the typed text when the post fails", async () => {
    mockPost.mockRejectedValue(new Error("offline"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("comments-input"), "do not lose me");
    fireEvent.press(screen.getByTestId("comments-send"));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    // Losing a typed message to a dropped connection is the worst thing this
    // screen could do.
    expect(screen.getByTestId("comments-input").props.value).toBe("do not lose me");
  });

  it("sends parent_id after tapping reply", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c1-reply"));
    expect(screen.getByTestId("comments-reply-strip")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("comments-input"), "agreed");
    fireEvent.press(screen.getByTestId("comments-send"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "c1" }),
    ));
  });

  it("drops the reply target after cancelling it", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c1-reply"));
    fireEvent.press(screen.getByTestId("comments-reply-cancel"));
    expect(screen.queryByTestId("comments-reply-strip")).toBeNull();
    fireEvent.changeText(screen.getByTestId("comments-input"), "standalone");
    fireEvent.press(screen.getByTestId("comments-send"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      expect.not.objectContaining({ parentId: "c1" }),
    ));
  });

  it("shows a quoted parent on a reply", async () => {
    mockList.mockResolvedValue([
      c({ id: "p", user_name: "Grace", user_id: "u2", body: "the original" }),
      c({ id: "r", parent_id: "p" }),
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-r-quote")).toBeTruthy());
  });

  it("edits own comment", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c1-edit"));
    fireEvent.changeText(screen.getByTestId("comments-edit-input"), "reworded");
    fireEvent.press(screen.getByTestId("comments-edit-save"));
    await waitFor(() => expect(mockEdit).toHaveBeenCalledWith("c1", "reworded"));
  });

  it("offers no edit on someone else's comment", async () => {
    mockList.mockResolvedValue([c({ id: "c9", user_id: "u2", user_name: "Grace" })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c9")).toBeTruthy());
    expect(screen.queryByTestId("comment-c9-edit")).toBeNull();
  });

  it("offers no delete on someone else's comment to a member", async () => {
    mockList.mockResolvedValue([c({ id: "c9", user_id: "u2", user_name: "Grace" })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c9")).toBeTruthy());
    expect(screen.queryByTestId("comment-c9-delete")).toBeNull();
  });

  it("lets an admin delete someone else's comment, after confirming", async () => {
    mockRole.current = "admin";
    mockList.mockResolvedValue([c({ id: "c9", user_id: "u2", user_name: "Grace" })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c9")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c9-delete"));
    // Deleting a comment takes its replies with it, so it asks first - the same
    // rule the rest of this app follows for anything irreversible.
    fireEvent.press(screen.getByTestId("confirm"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("c9"));
  });

  it("does not delete when the confirmation is dismissed", async () => {
    mockRole.current = "admin";
    mockList.mockResolvedValue([c({ id: "c9", user_id: "u2", user_name: "Grace" })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c9")).toBeTruthy());
    fireEvent.press(screen.getByTestId("comment-c9-delete"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("marks an edited comment as edited", async () => {
    mockList.mockResolvedValue([c({ is_edited: 1 })]);
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1-edited")).toBeTruthy());
  });

  it("refuses to send an over-long body", async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("comment-c1")).toBeTruthy());
    fireEvent.changeText(screen.getByTestId("comments-input"), "x".repeat(5001));
    expect(screen.getByTestId("comments-counter")).toBeTruthy();
    fireEvent.press(screen.getByTestId("comments-send"));
    expect(mockPost).not.toHaveBeenCalled();
  });
});
