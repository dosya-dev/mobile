/**
 * The folder a phone backs up into: Mobile Backup/<this>/Camera Roll/...
 *
 * iOS 16 and later hand every app without the user-assigned-device-name
 * entitlement the bare word "iPhone"; Android often gives the model. Two
 * phones with the same generic name backing up to one workspace would share
 * a folder, and the server turns a same-named upload into a new VERSION of
 * the other phone's photo - with delete-after-backup on, both originals go.
 *
 * A user-chosen name is kept exactly (existing backups stay where they are).
 * A generic one gets the first six characters of this installation's id,
 * which is stable until a reinstall; a reinstall starts a new folder, and the
 * fingerprint check keeps it from re-uploading anything.
 */
const GENERIC = /^(iphone|ipad|ipod|android|my phone|phone)$/i;

export function chooseDeviceFolderName(input: {
  deviceName: string | null;
  modelName: string | null;
  installationId: string;
}): string {
  const clean = (s: string) => s.replace(/[\\/]/g, "-").trim();
  const name = input.deviceName ? clean(input.deviceName) : "";
  const model = input.modelName ? clean(input.modelName) : "";
  const generic = name === "" || GENERIC.test(name) || (model !== "" && name.toLowerCase() === model.toLowerCase());
  if (!generic) return name;
  const base = model || name || "My Phone";
  return `${base} ${input.installationId.replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}`;
}
