// The live chat REST surface and socket, as the web/desktop api modules but over
// the mobile api client (Bearer session). The socket sends the same bearer in
// its handshake headers (React Native's WebSocket takes headers; browsers cannot).
import { apiRequest, API_BASE_URL } from "@/api";
import { getAccessToken } from "@/auth/authStore";
import type { ChatAttachment, ChatMessage, ChatSummary, Conversation, Rating } from "./types";

export interface ChatSummaryResult {
  available: boolean;
  chat: ChatSummary | null;
  conversation: Conversation | null;
  persona_online: boolean;
  staff_online: boolean;
  unread: number;
}

export function fetchChatSummary(): Promise<ChatSummaryResult> {
  return apiRequest<{
    ok: boolean; available?: boolean; chat: ChatSummary | null; conversation?: Conversation | null;
    persona_online?: boolean; staff_online: boolean; unread: number;
  }>("/api/support/chat").then((r) => ({
    available: r.available !== false,
    chat: r.chat,
    conversation: r.conversation ?? null,
    persona_online: !!r.persona_online,
    staff_online: !!r.staff_online,
    unread: r.unread ?? 0,
  }));
}

export function fetchChatMessages(after?: number): Promise<ChatMessage[]> {
  const q = after ? `?after=${after}` : "";
  return apiRequest<{ ok: boolean; messages: ChatMessage[] }>(`/api/support/chat/messages${q}`).then((r) => r.messages);
}

export function postChatMessage(input: { id: string; body: string; attachment_ids?: string[] }): Promise<ChatMessage> {
  return apiRequest<{ ok: boolean; message: ChatMessage }>("/api/support/chat/messages", { method: "POST", body: input }).then((r) => r.message);
}

export function postChatSeen(): Promise<void> {
  return apiRequest("/api/support/chat/seen", { method: "POST" }).then(() => undefined);
}

/** A past or current conversation as the history list shows it. */
export type ConversationListItem = Conversation & { title: string | null; last_message_at: number };

export function fetchConversations(): Promise<ConversationListItem[]> {
  return apiRequest<{ ok: boolean; conversations: ConversationListItem[] }>("/api/support/chat/conversations").then((r) => r.conversations);
}

export function fetchConversationMessages(id: string): Promise<ChatMessage[]> {
  return apiRequest<{ ok: boolean; messages: ChatMessage[] }>(`/api/support/chat/messages?conversation=${encodeURIComponent(id)}`)
    .then((r) => r.messages);
}

export function endConversation(): Promise<Conversation> {
  return apiRequest<{ ok: boolean; conversation: Conversation }>("/api/support/chat/end", { method: "POST" }).then((r) => r.conversation);
}

export function startConversation(): Promise<Conversation> {
  return apiRequest<{ ok: boolean; conversation: Conversation }>("/api/support/chat/start", { method: "POST" }).then((r) => r.conversation);
}

export function postRating(input: { stars: number; solved: boolean; comment?: string; conversation_id?: string }): Promise<Rating> {
  return apiRequest<{ ok: boolean; rating: Rating }>("/api/support/chat/rating", { method: "POST", body: input }).then((r) => r.rating);
}

/** A screenshot picked from Photos, ready for a multipart part. */
export interface ChatImage { uri: string; name: string; type: string }

export async function uploadChatImages(images: ChatImage[]): Promise<ChatAttachment[]> {
  const form = new FormData();
  // React Native turns { uri, name, type } into a file part.
  for (const img of images) form.append("images", img as unknown as Blob);
  const res = await apiRequest<{ ok: boolean; attachments: ChatAttachment[] }>("/api/support/chat/attachments", { method: "POST", body: form });
  return res.attachments;
}

/** An attachment image source: the route is private, so it carries the bearer. */
export function chatAttachmentSource(id: string): { uri: string; headers?: Record<string, string> } {
  const token = getAccessToken();
  return { uri: `${API_BASE_URL}/api/support/chat/attachments/${id}`, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) };
}

/** Persona pictures are served publicly. */
export function personaAvatarUri(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function chatSocketUrl(): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/api/support/chat/socket`;
}

type HeaderSocket = new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => WebSocket;

/**
 * A WebSocket constructor that authenticates its handshake with the current
 * session bearer, read at connect time so a refreshed token is picked up on
 * reconnect. React Native's WebSocket takes headers as a third argument.
 */
export const AuthedChatSocket = function AuthedChatSocket(url: string): WebSocket {
  const token = getAccessToken();
  return new (WebSocket as unknown as HeaderSocket)(url, undefined, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
} as unknown as typeof WebSocket;
