/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "widget",
  name: "BackupWidget",
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  entitlements: {
    "com.apple.security.application-groups": ["group.dev.dosya.app"],
  },
};
