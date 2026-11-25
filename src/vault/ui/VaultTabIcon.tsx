import { Icon } from "@/ui/Icon";
import { useVaultLocked } from "@/vault/status";

/**
 * The Vault tab's icon: a closed padlock while the Vault is locked, an open
 * one once it is unlocked, so the bar answers "is it open?" at a glance.
 *
 * It reads that one boolean from `@/vault/status` and nothing else. The tab
 * bar renders on the first frame of the app, and `@/vault/store` would drag
 * the 3 MB e2ee bundle onto the boot path behind it; the flag costs nothing
 * and is `true` until the store says otherwise, which is the truth for a
 * process that has never opened the Vault.
 */
export function VaultTabIcon({ color, size }: { color: string; size: number }) {
  const locked = useVaultLocked();
  return <Icon name={locked ? "lock-closed" : "lock-open-outline"} color={color} size={size} />;
}
