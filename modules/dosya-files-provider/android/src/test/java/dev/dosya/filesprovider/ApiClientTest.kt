package dev.dosya.filesprovider

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class ApiClientTest {
  private val server = MockWebServer()
  private lateinit var store: MemorySessionStore
  private lateinit var api: ApiClient

  @Before fun start() {
    server.start()
    store = MemorySessionStore(LinkedSession("acc1", "ref1", server.url("/").toString().trimEnd('/'), "u1"))
    api = ApiClient(store, OkHttpClient())
  }

  @After fun stop() = server.shutdown()

  @Test fun `sends the bearer and sorted query`() {
    server.enqueue(MockResponse().setBody("""{"ok":true}"""))
    api.send("GET", "/api/files", query = mapOf("workspace_id" to "w1", "folder_id" to null, "page" to "1"))
    val req = server.takeRequest()
    assertEquals("Bearer acc1", req.getHeader("Authorization"))
    assertEquals("/api/files?page=1&workspace_id=w1", req.path)
  }

  @Test fun `refreshes once on 401 and retries`() {
    server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"expired"}"""))
    server.enqueue(MockResponse().setBody("""{"access_token":"acc2","refresh_token":"ref2"}"""))
    server.enqueue(MockResponse().setBody("""{"ok":true}"""))
    assertEquals("""{"ok":true}""", api.send("GET", "/api/workspaces"))
    server.takeRequest()
    val refresh = server.takeRequest()
    assertEquals("/api/auth/mobile/refresh", refresh.path)
    assertEquals("ref1", JSONObject(refresh.body.readUtf8()).getString("refresh_token"))
    assertEquals("Bearer acc2", server.takeRequest().getHeader("Authorization"))
    assertEquals("acc2", store.load()!!.access)
  }

  @Test fun `a rejected refresh clears the session`() {
    server.enqueue(MockResponse().setResponseCode(401))
    server.enqueue(MockResponse().setResponseCode(401))
    assertThrows(NotSignedInException::class.java) { api.send("GET", "/api/workspaces") }
    assertNull(store.load())
  }

  @Test fun `a session replaced by the app mid-refresh is adopted, not cleared`() {
    server.enqueue(MockResponse().setResponseCode(401))
    server.enqueue(MockResponse().setBody("""{"ok":true}"""))
    val replaced = LinkedSession("acc9", "ref9", store.load()!!.apiBaseUrl, "u1")
    val spy = object : SessionStore {
      var reads = 0
      override fun load(): LinkedSession? = if (reads++ == 0) LinkedSession("acc1", "ref1", replaced.apiBaseUrl, "u1") else replaced
      override fun save(session: LinkedSession) {}
      override fun clear() { throw AssertionError("must not clear") }
    }
    val client = ApiClient(spy, OkHttpClient())
    client.send("GET", "/api/workspaces")
    server.takeRequest()
    assertEquals("Bearer acc9", server.takeRequest().getHeader("Authorization"))
  }

  @Test fun `maps refused calls`() {
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"A file named a.txt already exists"}"""))
    val e = assertThrows(ApiException::class.java) { api.send("POST", "/api/folders", json = JSONObject()) }
    assertEquals(409, e.status)
    assertTrue(e.isNameCollision)
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"stale","error_code":"version_conflict"}"""))
    val v = assertThrows(ApiException::class.java) { api.send("POST", "/api/upload/init", json = JSONObject()) }
    assertTrue(v.isVersionConflict)
    assertTrue(v.isNameCollision)
  }

  @Test fun `no session means not signed in without a request`() {
    store.clear()
    assertThrows(NotSignedInException::class.java) { api.send("GET", "/api/workspaces") }
    assertEquals(0, server.requestCount)
  }

  @Test fun `network failure is unreachable`() {
    val dead = ApiClient(MemorySessionStore(LinkedSession("a", "r", "http://127.0.0.1:1", "u")), OkHttpClient())
    assertThrows(UnreachableException::class.java) { dead.send("GET", "/x") }
  }

  @Test fun `absolute urls are sent as-is`() {
    server.enqueue(MockResponse().setBody("{}"))
    api.send("PUT", server.url("/presigned/1").toString())
    assertEquals("/presigned/1", server.takeRequest().path)
  }

  @Test fun `workspaces hide vault and cache for a minute`() {
    server.enqueue(MockResponse().setBody("""{"workspaces":[{"id":"w1","name":"A"},{"id":"w2","name":"V","e2ee_mode":1},{"id":"w3","name":"a"}]}"""))
    val list = api.workspaces()
    assertEquals(listOf("A (w1)", "a (w3)"), list.map { it.name })
    api.workspaces()
    assertEquals(1, server.requestCount)
    server.enqueue(MockResponse().setBody("""{"workspaces":[]}"""))
    assertTrue(api.workspaces(fresh = true).isEmpty())
  }

  @Test fun `an emptied store means signed out at the next call, with no request`() {
    server.enqueue(MockResponse().setBody("{}"))
    api.send("GET", "/api/workspaces")
    store.clear()
    assertThrows(NotSignedInException::class.java) { api.send("GET", "/api/workspaces") }
    assertEquals(1, server.requestCount)
  }

  @Test fun `a 401 with an emptied store does not refresh or resurrect the session`() {
    server.enqueue(MockResponse().setResponseCode(401))
    var saves = 0
    var reads = 0
    val spy = object : SessionStore {
      override fun load(): LinkedSession? = if (reads++ == 0) LinkedSession("acc1", "ref1", store.load()!!.apiBaseUrl, "u1") else null
      override fun save(session: LinkedSession) { saves++ }
      override fun clear() {}
    }
    val client = ApiClient(spy, OkHttpClient())
    assertThrows(NotSignedInException::class.java) { client.send("GET", "/api/workspaces") }
    assertEquals(1, server.requestCount)
    assertEquals(0, saves)
  }

  @Test fun `a store switched to another account drops the workspace cache`() {
    server.enqueue(MockResponse().setBody("""{"workspaces":[{"id":"w1","name":"A"}]}"""))
    assertEquals(listOf("w1"), api.workspaces().map { it.id })
    store.save(LinkedSession("acc2", "ref2", store.load()!!.apiBaseUrl, "u2"))
    server.enqueue(MockResponse().setBody("""{"workspaces":[{"id":"w2","name":"B"}]}"""))
    assertEquals(listOf("w2"), api.workspaces().map { it.id })
    assertEquals(2, server.requestCount)
  }

  @Test fun `concurrent downloads of one file never interleave`() {
    val a = "a".repeat(200_000)
    val b = "b".repeat(200_000)
    server.enqueue(MockResponse().setBody(a).throttleBody(16_384, 5, java.util.concurrent.TimeUnit.MILLISECONDS))
    server.enqueue(MockResponse().setBody(b).throttleBody(16_384, 5, java.util.concurrent.TimeUnit.MILLISECONDS))
    val dest = File.createTempFile("download", ".bin").also { it.delete() }
    val url = server.url("/blob").toString()
    val errors = java.util.concurrent.CopyOnWriteArrayList<Throwable>()
    val threads = (1..2).map { Thread { try { api.download(url, dest) } catch (e: Throwable) { errors.add(e) } } }
    threads.forEach { it.start() }; threads.forEach { it.join() }
    assertTrue(errors.toString(), errors.isEmpty())
    val text = dest.readText()
    assertTrue("length ${'$'}{text.length}", text == a || text == b)
    dest.delete()
  }

  @Test fun `downloads to a file`() {
    server.enqueue(MockResponse().setBody("hello"))
    val dest = File.createTempFile("download", ".bin").also { it.delete() }
    api.download(server.url("/blob").toString(), dest)
    assertEquals("hello", dest.readText())
    assertNull(server.takeRequest().getHeader("Authorization"))
    dest.delete()
  }
}
