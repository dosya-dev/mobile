/**
 * How long a finger rests on a row or card before the drag is armed. Shorter
 * than Pressable's 500 ms default: the hold is the only way to start a move,
 * and half a second reads as "nothing is happening". Long enough that a
 * scroll that starts late is still a scroll.
 */
export const LONG_PRESS_MS = 300;
