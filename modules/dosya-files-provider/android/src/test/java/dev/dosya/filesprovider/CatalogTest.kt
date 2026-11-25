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
import java.io.FileNotFoundException

class CatalogTest {
  private val server = MockWebServer()
  private lateinit var catalog: Catalog

  @Before fun start() {
    server.start()
    val base = server.url("/").toString().trimEnd('/')
    catalog = Catalog(ApiClient(MemorySessionStore(LinkedSession("a", "r", base, "u")), OkHttpClient()))
  }

  @After fun stop() = server.shutdown()

  @Test fun `root lists workspaces`() {
    server.enqueue(MockResponse().setBody("""{"workspaces":[{"id":"w1","name":"A"}]}"""))
    val rows = catalog.children(DocId.Root)
    assertEquals(listOf("ws:w1"), rows.map { it.documentId })
    assertEquals("root", catalog.row(DocId.Root).documentId)
  }

  @Test fun `a folder listing walks every page and reports child folders once`() {
    server.enqueue(MockResponse().setBody("""{"folders":[{"id":"f2","name":"Sub"},{"id":"f3","name":"Locked","lock_mode":"full"}],"files":[{"id":"x1","name":"a"}],"pagination":{"page":1,"total_pages":2}}"""))
    server.enqueue(MockResponse().setBody("""{"folders":[{"id":"f2","name":"Sub"}],"files":[{"id":"x2","name":"b"}],"pagination":{"page":2,"total_pages":2}}"""))
    val rows = catalog.children(DocId.Folder("w1", "f1"))
    assertEquals(listOf("fo:w1:f2", "fi:w1:x1", "fi:w1:x2"), rows.map { it.documentId })
    val q1 = server.takeRequest().path!!
    assertTrue(q1, q1.contains("folder_id=f1") && q1.contains("page=1") && q1.contains("per_page=500") && q1.contains("sort=name_asc"))
    assertTrue(server.takeRequest().path!!.contains("page=2"))
  }

  @Test fun `a workspace listing passes no folder id`() {
    server.enqueue(MockResponse().setBody("""{"files":[]}"""))
    catalog.children(DocId.Workspace("w1"))
    val path = server.takeRequest().path!!
    assertTrue(path, !path.contains("folder_id"))
  }

  @Test fun `rows for single items`() {
    server.enqueue(MockResponse().setBody("""{"workspaces":[{"id":"w1","name":"A"}]}"""))
    assertEquals("A", catalog.row(DocId.Workspace("w1")).displayName)
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f1","name":"Docs","workspace_id":"w1"}}"""))
    assertEquals("Docs", catalog.row(DocId.Folder("w1", "f1")).displayName)
    server.enqueue(MockResponse().setBody("""{"file":{"id":"x1","name":"a.pdf","workspace_id":"w1"}}"""))
    assertEquals("a.pdf", catalog.row(DocId.File("w1", "x1")).displayName)
  }

  @Test fun `an unknown workspace or a trashed folder is not found`() {
    server.enqueue(MockResponse().setBody("""{"workspaces":[]}"""))
    assertThrows(FileNotFoundException::class.java) { catalog.row(DocId.Workspace("w9")) }
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f1","name":"Docs","is_deleted":1}}"""))
    assertThrows(FileNotFoundException::class.java) { catalog.folder(DocId.Folder("w1", "f1")) }
  }

  @Test fun `parentOf finds the container to refresh after a rename`() {
    // A file inside a folder.
    server.enqueue(MockResponse().setBody("""{"file":{"id":"x1","name":"a.txt","workspace_id":"w1","folder_id":"f1"}}"""))
    assertEquals(DocId.Folder("w1", "f1"), catalog.parentOf(DocId.File("w1", "x1")))
    // A file at the workspace root.
    server.enqueue(MockResponse().setBody("""{"file":{"id":"x2","name":"b.txt","workspace_id":"w1","folder_id":null}}"""))
    assertEquals(DocId.Workspace("w1"), catalog.parentOf(DocId.File("w1", "x2")))
    // A folder nested under another folder.
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f2","name":"Sub","workspace_id":"w1","parent_id":"f1"}}"""))
    assertEquals(DocId.Folder("w1", "f1"), catalog.parentOf(DocId.Folder("w1", "f2")))
    // A folder at the workspace root.
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f3","name":"Top","workspace_id":"w1","parent_id":null}}"""))
    assertEquals(DocId.Workspace("w1"), catalog.parentOf(DocId.Folder("w1", "f3")))
  }

  @Test fun `parentOf a workspace or the root is the root`() {
    assertEquals(DocId.Root, catalog.parentOf(DocId.Workspace("w1")))
    assertEquals(DocId.Root, catalog.parentOf(DocId.Root))
    assertEquals(0, server.requestCount)
  }

  @Test fun `creating a folder skips taken names`() {
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f1","name":"New"},"created_count":0}"""))
    server.enqueue(MockResponse().setBody("""{"folder":{"id":"f2","name":"New 2"},"created_count":1}"""))
    val f = catalog.createFolder("New", "w1", null)
    assertEquals("f2", f.id)
    assertEquals("New", JSONObject(server.takeRequest().body.readUtf8()).getString("name"))
    val second = JSONObject(server.takeRequest().body.readUtf8())
    assertEquals("New 2", second.getString("name"))
    assertTrue(second.isNull("parent_id"))
  }

  @Test fun `folder names with separators are refused before any request`() {
    assertThrows(IllegalArgumentException::class.java) { catalog.createFolder("a/b", "w1", null) }
    assertEquals(0, server.requestCount)
  }
}
