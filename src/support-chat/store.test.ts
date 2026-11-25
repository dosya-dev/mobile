jest.mock("./api", () => ({
  fetchChatSummary: jest.fn(),
  fetchChatMessages: jest.fn(async () => []),
  postChatMessage: jest.fn(),
  postChatSeen: jest.fn(async () => undefined),
  uploadChatImages: jest.fn(),
  chatSocketUrl: () => "wss://x/socket",
  fetchConversations: jest.fn(async () => []),
  fetchConversationMessages: jest.fn(async () => []),
  endConversation: jest.fn(),
  startConversation: jest.fn(),
  postRating: jest.fn(),
  AuthedChatSocket: function AuthedChatSocket() {},
}));

import { AppState } from "react-native";
import * as rest from "./api";
import { ApiError } from "@/api";
import { useAuthStore } from "@/auth/authStore";
import { restErrorCode, type ClientEvent } from "./client";
import { __setClientFactory, useSupportChat } from "./store";
import type { ClientFrame, Conversation, LiveMessage, ServerFrame } from "./types";

class FakeClient {
  connects = 0; closes = 0; sent: ClientFrame[] = []; discarded: string[] = [];
  messages: { id: string; body: string; ids?: string[] }[] = [];
  constructor(public onEvent: (e: ClientEvent) => void) {}
  connect() { this.connects++; }
  close() { this.closes++; }
  send(f: ClientFrame) { this.sent.push(f); }
  sendMessage(body: string, ids?: string[], id = "msg_fixed") { this.messages.push({ id, body, ids }); return id; }
  discard(id: string) { this.discarded.push(id); }
  frame(frame: ServerFrame) { this.onEvent({ type: "frame", frame }); }
}

let fake: FakeClient | null;
let created = 0;
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({ id, status: "answered", persona: null, ended_by: null, ended_at: null, rating: null, started_at: 1, ...over });
const staffMsg = (id: string, body = "hello"): LiveMessage => ({
  id, chat_id: "c1", author_type: "staff", author_id: "s", author_name: "Carl", kind: "text",
  persona_id: null, body, meta: null, attachments: [], created_at: 10, persona: null,
});

beforeEach(() => {
  created = 0;
  fake = null;
  jest.clearAllMocks();
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
  __setClientFactory((onEvent) => { created++; fake = new FakeClient(onEvent); return fake as never; });
  useSupportChat.getState().__reset();
});
afterEach(() => __setClientFactory(null));

describe("mobile support chat store", () => {
  it("opens the socket only while the chat screen shows", () => {
    expect(created).toBe(0);
    useSupportChat.getState().showChat(true);
    expect(created).toBe(1);
    useSupportChat.getState().showChat(false);
    expect(fake!.closes).toBe(1);
    expect(useSupportChat.getState().conn).toBe("idle");
  });

  it("the summary fills the unread count for the Settings row without connecting", async () => {
    (rest.fetchChatSummary as jest.Mock).mockResolvedValue({
      available: true, chat: null, conversation: conv("c1"), persona_online: false, staff_online: false, unread: 2,
    });
    await useSupportChat.getState().refreshSummary();
    expect(useSupportChat.getState().unread).toBe(2);
    expect(created).toBe(0);
  });

  it("a reply on screen in the foreground is seen at once; in the background it counts unread", () => {
    useSupportChat.getState().showChat(true);
    fake!.frame({ v: 1, type: "message", message: staffMsg("m1") });
    expect(useSupportChat.getState().unread).toBe(0);
    expect(fake!.sent).toContainEqual({ v: 1, type: "seen", last_message_id: "m1" });
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
    fake!.frame({ v: 1, type: "message", message: staffMsg("m2") });
    expect(useSupportChat.getState().unread).toBe(1);
  });

  it("image sends show at once from the picked uri, then go out with the uploaded ids", async () => {
    let finish!: (a: unknown) => void;
    (rest.uploadChatImages as jest.Mock).mockReturnValue(new Promise((r) => { finish = r; }));
    useSupportChat.getState().showChat(true);
    const done = useSupportChat.getState().send("pic", [{ uri: "file:///a.png", name: "a.png", type: "image/png" }]);
    const row = useSupportChat.getState().messages.at(-1)!;
    expect(row.previews).toEqual([{ key: expect.any(String), url: "file:///a.png", name: "a.png" }]);
    expect(useSupportChat.getState().pending[row.id]).toBe("uploading");
    finish([{ id: "att1", file_name: "a.png", content_type: "image/png", size_bytes: 1 }]);
    await done;
    expect(fake!.messages[0]).toMatchObject({ id: row.id, body: "pic", ids: ["att1"] });
  });

  it("a failed upload removes the row and returns the text", async () => {
    (rest.uploadChatImages as jest.Mock).mockRejectedValue(new ApiError("boom", 500));
    useSupportChat.getState().showChat(true);
    await useSupportChat.getState().send("pic", [{ uri: "file:///a.png", name: "a.png", type: "image/png" }]);
    expect(useSupportChat.getState().messages).toHaveLength(0);
    expect(useSupportChat.getState().lastFailedDraft).toBe("pic");
  });

  it("signing out drops the socket and the thread", () => {
    useAuthStore.setState({ user: { id: "u1", email: "a@b.c", name: "A", created_at: 1 } } as never);
    useSupportChat.getState().showChat(true);
    fake!.frame({ v: 1, type: "message", message: staffMsg("m1") });
    useAuthStore.setState({ user: null } as never);
    expect(useSupportChat.getState().messages).toHaveLength(0);
    expect(useSupportChat.getState().chatOpen).toBe(false);
  });

  it("restErrorCode reads the chat code from the mobile ApiError", () => {
    expect(restErrorCode(new ApiError("conversation_empty", 409))).toBe("conversation_empty");
    expect(restErrorCode(new ApiError("Something else", 409))).toBeNull();
  });
});
