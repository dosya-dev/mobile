/**
 * One file handed to the app by the OS's "Open with" chooser or share sheet:
 * on Android resolved by modules/dosya-share-intent (a content:// URI), on iOS
 * by src/share-intent/incoming.ts (a file:// URL under Documents/Inbox).
 *
 * Either way `uri` is borrowed, not owned: the content:// grant dies with the
 * granting task, and the Inbox original is the app's to delete. Both are
 * copied into the cache before they reach the upload queue - the queue
 * survives app restarts and would otherwise retry a dead URI forever. See
 * src/share-intent/copy.ts.
 */
export interface SharedFile {
  uri: string;
  name: string;
  size: number;
  mime: string;
}
