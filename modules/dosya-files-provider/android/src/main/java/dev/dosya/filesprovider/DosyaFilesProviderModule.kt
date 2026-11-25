package dev.dosya.filesprovider

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Android half of the `DosyaFilesProvider` native module that
 * src/filesProvider/link.ts drives. Same surface as the iOS module: the JS
 * side minted a linked session and hands it over here; the provider reads it
 * from the Keystore-encrypted store.
 */
class DosyaFilesProviderModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  private fun store() = KeystoreSessionStore(context)

  override fun definition() = ModuleDefinition {
    Name("DosyaFilesProvider")

    Function("isSupported") { true }

    // Owner only, never the tokens: JS tells a missing session from another account's.
    Function("storedUserId") { store().load()?.userId }

    Function("writeSession") { json: String ->
      val session = LinkedSession.fromJson(json) ?: throw IllegalArgumentException("Session JSON is incomplete")
      store().save(session)
    }

    Function("clearSession") {
      store().clear()
      DosyaDocumentsProvider.clearCache(context)
    }

    // No domain to register on Android: the provider is declared in the
    // manifest. Pickers are told to re-read roots so "sign in" turns into the
    // account's workspaces without reopening them.
    AsyncFunction("registerDomain") {
      DosyaDocumentsProvider.notifyRoots(context)
      true
    }

    AsyncFunction("removeDomain") {
      DosyaDocumentsProvider.clearCache(context)
      DosyaDocumentsProvider.notifyRoots(context)
      true
    }

    AsyncFunction("signalChanges") {
      DosyaDocumentsProvider.notifyRoots(context)
      true
    }
  }
}
