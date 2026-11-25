import Foundation
import Security

// Must stay identical to modules/dosya-files-provider/ios/DosyaFilesProviderModule.swift.
// The app writes the linked session under these names and this extension is the
// only reader; a mismatch builds fine and Files just asks to sign in forever.
enum SharedConstants {
  static let appGroup = "group.dev.dosya.app"
  static let keychainService = "dev.dosya.files-provider"
  static let keychainAccount = "linked-session"
}

/// The extension's own mobile session, minted by the app through
/// POST /api/auth/mobile/linked-session. It rotates independently of the app's
/// session, so the two processes never race over one refresh token.
struct LinkedSession: Codable, Equatable {
  var access: String
  var refresh: String
  var apiBaseUrl: String
  var userId: String
}

enum SessionKeychain {
  private static var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: SharedConstants.keychainService,
      kSecAttrAccount as String: SharedConstants.keychainAccount,
      kSecAttrAccessGroup as String: SharedConstants.appGroup,
    ]
  }

  static func load() -> LinkedSession? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
          let data = out as? Data
    else { return nil }
    return try? JSONDecoder().decode(LinkedSession.self, from: data)
  }

  @discardableResult
  static func save(_ session: LinkedSession) -> Bool {
    guard let data = try? JSONEncoder().encode(session) else { return false }
    let update: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var add = baseQuery
      add.merge(update) { _, new in new }
      status = SecItemAdd(add as CFDictionary, nil)
    }
    return status == errSecSuccess
  }

  static func clear() {
    SecItemDelete(baseQuery as CFDictionary)
  }
}
