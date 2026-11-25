package dev.dosya.filesprovider

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A refused API call, with the server's own message. */
class ApiException(val method: String, val status: Int, message: String, val code: String?) : IOException(message) {
  val isVersionConflict: Boolean get() = status == 409 && code == "version_conflict"

  /** "That name is taken": a same-name 409 on create/rename/complete, or version_conflict from upload init. */
  val isNameCollision: Boolean
    get() = status == 409 && (isVersionConflict || (message ?: "").contains("already exists", ignoreCase = true))
}

class NotSignedInException : IOException("Open the dosya.dev app to sign in.")

class UnreachableException(cause: Throwable? = null) : IOException("dosya.dev is unreachable.", cause)

private val JSON = "application/json; charset=utf-8".toMediaType()

/**
 * Talks to the dosya.dev API with the provider's linked session. Refreshes it
 * on a 401 (single-flight, re-reading the store first in case the app replaced
 * it) and retries the failed call once. Synchronous: every provider entry
 * point runs on a binder thread that may block.
 */
class ApiClient(private val store: SessionStore, http: OkHttpClient) {
  private val http: OkHttpClient = http.newBuilder()
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .writeTimeout(60, TimeUnit.SECONDS)
    .build()

  private val refreshLock = Any()
  @Volatile private var workspaceCache: Pair<Long, List<WorkspaceDTO>>? = null
  /** Whose session the caches were filled for; an account switch empties them. */
  @Volatile private var cachedFor: String? = null

  /**
   * Always the store's copy, never a memory copy. The provider outlives sign-out
   * and account switches inside the app process (unlike the iOS extension,
   * which is torn down), so a cached session would keep serving an account
   * the user has left. The store is a decrypt of one preferences entry: cheap.
   */
  private fun current(): LinkedSession {
    val stored = store.load()
    if (stored == null) {
      workspaceCache = null
      cachedFor = null
      throw NotSignedInException()
    }
    if (cachedFor != stored.userId) {
      workspaceCache = null
      cachedFor = stored.userId
    }
    return stored
  }

  /** Absolute URLs (presigned uploads and downloads) are used as-is. */
  private fun resolve(session: LinkedSession, path: String): String {
    if (path.startsWith("http")) return path
    return session.apiBaseUrl.trimEnd('/') + path
  }

  private fun url(session: LinkedSession, path: String, query: Map<String, String?>): String {
    val base = resolve(session, path).toHttpUrlOrNull() ?: throw UnreachableException()
    val b = base.newBuilder()
    for ((k, v) in query.entries.sortedBy { it.key }) if (v != null) b.addQueryParameter(k, v)
    return b.build().toString()
  }

  /** One authenticated call; returns the body text. */
  fun send(
    method: String,
    path: String,
    query: Map<String, String?> = emptyMap(),
    json: JSONObject? = null,
    body: RequestBody? = null,
  ): String {
    var retried = false
    while (true) {
      val s = current()
      val request = Request.Builder()
        .url(url(s, path, query))
        .header("Authorization", "Bearer ${s.access}")
        .method(method, json?.toString()?.toRequestBody(JSON) ?: body ?: emptyBodyFor(method))
        .build()
      val response = try {
        http.newCall(request).execute()
      } catch (e: IOException) {
        throw UnreachableException(e)
      }
      response.use { r ->
        val text = r.body?.string() ?: ""
        if (r.code == 401 && !retried) {
          retried = true
          refresh(after = s.access)
          return@use
        }
        if (r.isSuccessful) return text
        val parsed = Models.errorBody(text)
        throw ApiException(method, r.code, parsed.error ?: "Request failed (${r.code})", parsed.code)
      }
    }
  }

  private fun emptyBodyFor(method: String): RequestBody? =
    if (method == "POST" || method == "PUT" || method == "PATCH") ByteArray(0).toRequestBody(null) else null

  fun getJson(path: String, query: Map<String, String?> = emptyMap()): String = send("GET", path, query)

  private fun refresh(after: String) {
    synchronized(refreshLock) {
      // Another thread may have refreshed, the app may have minted a fresh
      // session, or the user signed out: the store decides, never memory.
      val s = current()
      if (s.access != after) return
      var attempt = 0
      while (true) {
        val request = Request.Builder()
          .url(url(s, "/api/auth/mobile/refresh", emptyMap()))
          .post(JSONObject().put("refresh_token", s.refresh).toString().toRequestBody(JSON))
          .build()
        val response = try {
          http.newCall(request).execute()
        } catch (e: IOException) {
          throw UnreachableException(e)
        }
        response.use { r ->
          val text = r.body?.string() ?: ""
          when {
            r.isSuccessful -> {
              val t = Models.tokens(text)
              store.save(LinkedSession(t.access, t.refresh, s.apiBaseUrl, s.userId))
              return
            }
            r.code == 401 -> {
              // Dead, unless the app replaced it meanwhile.
              val disk = store.load()
              if (disk != null && disk.refresh != s.refresh) return
              store.clear()
              throw NotSignedInException()
            }
            r.code == 503 && attempt == 0 -> {
              // The server is finishing a concurrent rotation of this token.
              attempt++
              Thread.sleep(2000)
            }
            else -> throw UnreachableException()
          }
        }
      }
    }
  }

  /** Presigned URLs carry their own authorization: fetched without the bearer, streamed to disk. */
  fun download(url: String, dest: File) {
    val response = try {
      http.newCall(Request.Builder().url(url).build()).execute()
    } catch (e: IOException) {
      throw UnreachableException(e)
    }
    response.use { r ->
      if (!r.isSuccessful) throw ApiException("GET", r.code, "Download failed (${r.code})", null)
      // A private temp per call: two binder threads fetching the same file must
      // not share one .part, or the slower writer corrupts the faster one's bytes.
      val part = File(dest.path + ".part-" + System.nanoTime() + "-" + Thread.currentThread().id)
      part.parentFile?.mkdirs()
      try {
        r.body!!.byteStream().use { input -> part.outputStream().use { out -> input.copyTo(out) } }
        dest.delete()
        if (!part.renameTo(dest)) throw IOException("Could not place download")
      } finally {
        part.delete()
      }
    }
  }

  /** Every membership except Vault ones, names made unique; cached for a minute. */
  fun workspaces(fresh: Boolean = false): List<WorkspaceDTO> {
    current() // notices a sign-out or account switch before the cache is consulted
    val now = System.currentTimeMillis()
    if (!fresh) workspaceCache?.let { (at, list) -> if (now - at < 60_000) return list }
    val list = Names.disambiguateWorkspaces(Models.workspaces(getJson("/api/workspaces")).filter { it.e2eeMode == 0 })
    workspaceCache = now to list
    return list
  }

}
