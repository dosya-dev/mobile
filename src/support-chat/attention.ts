// Mobile stand-in for the desktop attention cues. Away from the chat screen the
// socket is closed, so a reply reaches the phone as the server's
// support_chat_reply push; the Settings row reads the unread count from the
// summary. Nothing to draw here.
export function setAttention(_count: number): void {}
export function clearAttention(): void {}
export function notifyReply(_title: string, _body: string): void {}
