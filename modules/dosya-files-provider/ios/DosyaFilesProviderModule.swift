import ExpoModulesCore
import FileProvider
import Foundation
import Security

// Every constant below must stay identical to targets/files-provider/Session.swift.
// The app and the extension are separate binaries and share nothing but these
// strings: a mismatch builds and runs fine, and the Files location simply says
// "sign in" forever.
private let sharedAccessGroup = "group.dev.dosya.app"
private let sessionService = "dev.dosya.files-provider"
private let sessionAccount = "linked-session"
private let domainIdentifier = NSFileProviderDomainIdentifier("dosya")
private let domainDisplayName = "dosya.dev"

public class DosyaFilesProviderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DosyaFilesProvider")

    // The replicated File Provider API is iOS 16+. On 15.x the app still runs;
    // it just never offers a Files location.
    Function("isSupported") { () -> Bool in
      if #available(iOS 16.0, *) { return true }
      return false
    }

    // Returns the stored session's owner (never its tokens) so JS can tell a
    // missing session from one that belongs to a different account.
    Function("storedUserId") { () -> String? in
      guard let data = keychainRead(),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return nil }
      return obj["userId"] as? String
    }

    // `json` = {access, refresh, apiBaseUrl, userId}. Written with
    // AfterFirstUnlockThisDeviceOnly: readable while the phone is locked (Files
    // uploads keep running then) and never restored onto another device from a
    // backup.
    Function("writeSession") { (json: String) throws in
      guard let data = json.data(using: .utf8) else { throw FilesProviderError("Session is not UTF-8") }
      try keychainWrite(data)
    }

    Function("clearSession") {
      keychainDelete()
    }

    AsyncFunction("registerDomain") { (promise: Promise) in
      guard #available(iOS 16.0, *) else { promise.resolve(false); return }
      let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: domainDisplayName)
      NSFileProviderManager.add(domain) { error in
        if let error = error { promise.reject(FilesProviderError(error.localizedDescription)) } else { promise.resolve(true) }
      }
    }

    // Removing the domain also deletes every file iOS downloaded for it, which is
    // what sign-out and an account switch need: the next account must not find
    // the previous one's files under "On My iPhone > dosya.dev".
    AsyncFunction("removeDomain") { (promise: Promise) in
      guard #available(iOS 16.0, *) else { promise.resolve(false); return }
      let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: domainDisplayName)
      NSFileProviderManager.remove(domain) { error in
        // "No such domain" is the resting state of a signed-out device.
        if let error = error as NSError?, error.domain != NSFileProviderErrorDomain {
          promise.reject(FilesProviderError(error.localizedDescription))
        } else {
          promise.resolve(true)
        }
      }
    }

    // Asks iOS to poll the working set now, e.g. after the app changed files, so
    // Files does not wait for its own schedule.
    AsyncFunction("signalChanges") { (promise: Promise) in
      guard #available(iOS 16.0, *) else { promise.resolve(false); return }
      let domain = NSFileProviderDomain(identifier: domainIdentifier, displayName: domainDisplayName)
      guard let manager = NSFileProviderManager(for: domain) else { promise.resolve(false); return }
      manager.signalEnumerator(for: .workingSet) { _ in promise.resolve(true) }
    }
  }
}

private struct FilesProviderError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

private func baseQuery() -> [String: Any] {
  [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: sessionService,
    kSecAttrAccount as String: sessionAccount,
    kSecAttrAccessGroup as String: sharedAccessGroup,
  ]
}

private func keychainRead() -> Data? {
  var query = baseQuery()
  query[kSecReturnData as String] = true
  query[kSecMatchLimit as String] = kSecMatchLimitOne
  var out: AnyObject?
  guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
  return out as? Data
}

private func keychainWrite(_ data: Data) throws {
  let update: [String: Any] = [
    kSecValueData as String: data,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  ]
  var status = SecItemUpdate(baseQuery() as CFDictionary, update as CFDictionary)
  if status == errSecItemNotFound {
    var add = baseQuery()
    add.merge(update) { _, new in new }
    status = SecItemAdd(add as CFDictionary, nil)
  }
  guard status == errSecSuccess else { throw FilesProviderError("Keychain write failed (\(status))") }
}

private func keychainDelete() {
  SecItemDelete(baseQuery() as CFDictionary)
}
