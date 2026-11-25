/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "file-provider",
  name: "FilesProvider",
  displayName: "dosya.dev",
  // Must match the FilesProvider entry in app.config.ts extra.eas...appExtensions,
  // which is what EAS provisions.
  bundleIdentifier: ".files-provider",
  // NSFileProviderReplicatedExtension is iOS 16+. The app keeps 15.1; on older
  // devices the extension is simply never loaded.
  deploymentTarget: "16.0",
  frameworks: ["FileProvider", "UniformTypeIdentifiers"],
  entitlements: {
    // Shared container AND keychain access group for the linked session.
    "com.apple.security.application-groups": ["group.dev.dosya.app"],
  },
};
