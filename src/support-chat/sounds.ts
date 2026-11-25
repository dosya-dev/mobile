// Mobile stand-in for the web/desktop chat sounds. The phone has no chat sounds:
// a reply on screen is visible, and away from the screen the push makes its own
// sound. There is no mute control on mobile, so isMuted is constant.
export function isMuted(): boolean {
  return false;
}
export function setMuted(_muted: boolean): void {}
export function playSend(): void {}
export function playReceive(): void {}
