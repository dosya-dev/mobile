package dev.dosya.filesprovider

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The provider's own mobile session, minted by the app through
 * POST /api/auth/mobile/linked-session and handed over by
 * src/filesProvider/link.ts as {access, refresh, apiBaseUrl, userId}. It
 * rotates independently of the app's session so the two never race over one
 * refresh token.
 */
data class LinkedSession(val access: String, val refresh: String, val apiBaseUrl: String, val userId: String) {
  fun toJson(): String = JSONObject()
    .put("access", access).put("refresh", refresh).put("apiBaseUrl", apiBaseUrl).put("userId", userId)
    .toString()

  companion object {
    fun fromJson(json: String?): LinkedSession? {
      if (json.isNullOrBlank()) return null
      return try {
        val o = JSONObject(json)
        val fields = listOf("access", "refresh", "apiBaseUrl", "userId").map { key ->
          if (o.isNull(key)) return null
          o.getString(key).also { if (it.isEmpty()) return null }
        }
        LinkedSession(fields[0], fields[1], fields[2], fields[3])
      } catch (_: Throwable) {
        null
      }
    }
  }
}

interface SessionStore {
  fun load(): LinkedSession?
  fun save(session: LinkedSession)
  fun clear()
}

class MemorySessionStore(private var current: LinkedSession? = null) : SessionStore {
  override fun load(): LinkedSession? = current
  override fun save(session: LinkedSession) { current = session }
  override fun clear() { current = null }
}

/**
 * SharedPreferences, with the value AES-GCM encrypted under a key that lives in
 * the Android Keystore and never leaves it. When the Keystore refuses (vendor
 * bugs exist), nothing is stored and the provider reports signed-out rather
 * than keeping tokens in plaintext.
 */
class KeystoreSessionStore(context: Context) : SessionStore {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  override fun load(): LinkedSession? {
    val blob = prefs.getString(KEY, null) ?: return null
    return try {
      val raw = Base64.decode(blob, Base64.NO_WRAP)
      val iv = raw.copyOfRange(0, IV_BYTES)
      val body = raw.copyOfRange(IV_BYTES, raw.size)
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
      LinkedSession.fromJson(String(cipher.doFinal(body), Charsets.UTF_8))
    } catch (e: Throwable) {
      Log.w(TAG, "session unreadable, treating as signed out: ${e.message}")
      null
    }
  }

  override fun save(session: LinkedSession) {
    try {
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.ENCRYPT_MODE, key())
      val body = cipher.doFinal(session.toJson().toByteArray(Charsets.UTF_8))
      val blob = Base64.encodeToString(cipher.iv + body, Base64.NO_WRAP)
      prefs.edit().putString(KEY, blob).apply()
    } catch (e: Throwable) {
      Log.w(TAG, "session not stored: ${e.message}")
      prefs.edit().remove(KEY).apply()
    }
  }

  override fun clear() {
    prefs.edit().remove(KEY).apply()
  }

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  companion object {
    const val TAG = "DosyaFilesProvider"
    private const val PREFS = "dosya.filesprovider"
    private const val KEY = "linked-session"
    private const val ALIAS = "dosya.files-provider"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}
