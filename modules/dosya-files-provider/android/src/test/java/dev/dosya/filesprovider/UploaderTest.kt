package dev.dosya.filesprovider

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class UploaderTest {
  private val server = MockWebServer()
  private lateinit var uploader: Uploader
  private lateinit var src: File

  @Before fun start() {
    server.start()
    val base = server.url("/").toString().trimEnd('/')
    uploader = Uploader(ApiClient(MemorySessionStore(LinkedSession("a", "r", base, "u")), OkHttpClient()))
    src = File.createTempFile("upload", ".txt").apply { writeText("0123456789abcdef") }
  }

  @After fun stop() { server.shutdown(); src.delete() }

  private fun initSingle() = MockResponse().setBody("""{"session_id":"s","upload_url":"${server.url("/put")}"}""")
  private fun initParts(size: Int, n: Int) = MockResponse().setBody(
    """{"session_id":"s","upload_url":"${server.url("/put")}","resumable":{"part_size":$size,"total_parts":$n,"part_upload_url":"${server.url("/part")}","complete_url":"${server.url("/complete")}"}}"""
  )
  private fun done(name: String, version: Int = 1) = MockResponse().setBody("""{"file":{"id":"x1","name":"$name","version":$version}}""")

  @Test fun `single put upload`() {
    server.enqueue(initSingle()); server.enqueue(done("a.txt"))
    val f = uploader.uploadNew(src, "a.txt", "text/plain", "w1", "f1")
    val init = JSONObject(server.takeRequest().body.readUtf8())
    assertEquals("a.txt", init.getString("file_name"))
    assertEquals(16, init.getInt("file_size"))
    assertEquals("f1", init.getString("folder_id"))
    assertEquals(0, init.getInt("expected_version"))
    val put = server.takeRequest()
    assertEquals("PUT", put.method)
    assertEquals("0123456789abcdef", put.body.readUtf8())
    assertEquals("text/plain", put.getHeader("Content-Type"))
    assertEquals("x1", f.id); assertEquals(16L, f.sizeBytes); assertEquals("w1", f.workspaceId)
  }

  @Test fun `part upload sends numbered parts then completes`() {
    server.enqueue(initParts(size = 6, n = 3))
    repeat(3) { server.enqueue(MockResponse().setBody("{}")) }
    server.enqueue(done("a.txt"))
    uploader.uploadNew(src, "a.txt", "text/plain", "w1", null)
    val init = JSONObject(server.takeRequest().body.readUtf8())
    assertTrue(init.isNull("folder_id"))
    val bodies = (1..3).map { i -> server.takeRequest().let { assertEquals("/part/$i", it.path); it.body.readUtf8() } }
    assertEquals(listOf("012345", "6789ab", "cdef"), bodies)
    assertEquals("/complete", server.takeRequest().path)
  }

  @Test fun `a taken name tries the next candidate`() {
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"x","error_code":"version_conflict"}"""))
    server.enqueue(initSingle()); server.enqueue(done("a 2.txt"))
    val f = uploader.uploadNew(src, "a.txt", "text/plain", "w1", null)
    assertEquals("a.txt", JSONObject(server.takeRequest().body.readUtf8()).getString("file_name"))
    assertEquals("a 2.txt", JSONObject(server.takeRequest().body.readUtf8()).getString("file_name"))
    assertEquals("a 2.txt", f.name)
  }

  @Test fun `a name collision on completion also tries the next candidate`() {
    server.enqueue(initSingle())
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"A file named a.txt already exists"}"""))
    server.enqueue(initSingle()); server.enqueue(done("a 2.txt"))
    assertEquals("a 2.txt", uploader.uploadNew(src, "a.txt", "text/plain", "w1", null).name)
  }

  @Test fun `all candidates taken`() {
    repeat(20) { server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error_code":"version_conflict","error":"x"}""")) }
    assertThrows(NameTakenException::class.java) { uploader.uploadNew(src, "a.txt", "text/plain", "w1", null) }
  }

  @Test fun `edit uploads on top of the base version`() {
    server.enqueue(initSingle()); server.enqueue(done("a.txt", version = 4))
    val file = FileDTO("x1", "a.txt", 3, "text/plain", "f1", "w1", "none", 3, null, null, null)
    val out = uploader.uploadEdit(src, file, "a.txt", "text/plain", baseVersion = 3)
    val init = JSONObject(server.takeRequest().body.readUtf8())
    assertEquals("x1", init.getString("file_id"))
    assertEquals(3, init.getInt("expected_version"))
    assertTrue(out is EditOutcome.Saved)
    assertEquals(4, (out as EditOutcome.Saved).file.currentVersion)
  }

  @Test fun `edit on a stale version becomes a conflicted copy`() {
    server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"stale","error_code":"version_conflict","current_version":5}"""))
    server.enqueue(initSingle()); server.enqueue(done("a (conflicted copy).txt"))
    val file = FileDTO("x1", "a.txt", 3, "text/plain", null, "w1", "none", 3, null, null, null)
    val out = uploader.uploadEdit(src, file, "a.txt", "text/plain", baseVersion = 3)
    server.takeRequest()
    assertEquals("a (conflicted copy).txt", JSONObject(server.takeRequest().body.readUtf8()).getString("file_name"))
    assertTrue(out is EditOutcome.Conflicted)
  }
}
