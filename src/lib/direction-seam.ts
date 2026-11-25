/** Test seam for the layout direction (see direction.ts). No imports on purpose. */
let override: boolean | null = null;

export const getLayoutOverride = (): boolean | null => override;

export function setLayoutOverride(rtl: boolean | null): void {
  override = rtl;
}
