package dev.dosya.filesprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
  @Test fun `parses workspaces leniently`() {
    val list = Models.workspaces("""{"workspaces":[{"id":"w1","name":"Home"},{"id":"w2","name":"Vault","slug":"v","e2ee_mode":1,"created_at":1.5}]}""")
    assertEquals(2, list.size)
    assertEquals(0, list[0].e2eeMode)
    assertNull(list[0].slug)
    assertEquals(1, list[1].e2eeMode)
    assertEquals(1.5, list[1].createdAt!!, 0.0)
  }

  @Test fun `parses a folder with null parent`() {
    val f = Models.folder("""{"folder":{"id":"f1","name":"Docs","parent_id":null,"workspace_id":"w1","is_deleted":0}}""")
    assertNull(f.parentId)
    assertEquals("w1", f.workspaceId)
    assertFalse(f.isDeleted)
  }

  @Test fun `parses a file with defaults`() {
    val f = Models.file("""{"file":{"id":"x1","name":"a.pdf","folder_id":"f1","workspace_id":"w1"}}""")
    assertEquals(0L, f.sizeBytes)
    assertEquals(1, f.currentVersion)
    assertNull(f.mimeType)
    assertNull(f.deletedAt)
  }

  @Test fun `parses a listing with pagination`() {
    val l = Models.listing("""{"folders":[{"id":"f1","name":"A","lock_mode":"none"}],"files":[{"id":"x1","name":"a"}],"pagination":{"page":2,"total_pages":3}}""")
    assertEquals(1, l.folders.size)
    assertEquals(1, l.files.size)
    assertEquals(2, l.page)
    assertEquals(3, l.totalPages)
    val bare = Models.listing("""{}""")
    assertEquals(1, bare.totalPages)
    assertTrue(bare.files.isEmpty())
  }

  @Test fun `parses upload init in both shapes`() {
    val single = Models.uploadInit("""{"session_id":"s","upload_url":"https://u"}""")
    assertFalse(single.resumable)
    val parts = Models.uploadInit("""{"session_id":"s","upload_url":"https://u","resumable":{"part_size":10,"total_parts":3,"part_upload_url":"https://p","complete_url":"https://c"}}""")
    assertTrue(parts.resumable)
    assertEquals(3, parts.totalParts)
  }

  @Test fun `builds a FileDTO from an upload result`() {
    val f = Models.uploadedFile("""{"file":{"id":"x9","name":"b.txt","version":4}}""", fallbackSize = 12, fallbackMime = "text/plain", workspaceId = "w1", folderId = null)
    assertEquals("x9", f.id)
    assertEquals(12L, f.sizeBytes)
    assertEquals("text/plain", f.mimeType)
    assertEquals(4, f.currentVersion)
    assertEquals("w1", f.workspaceId)
    assertNull(f.folderId)
  }

  @Test fun `reads error bodies and tokens`() {
    val e = Models.errorBody("""{"error":"File already exists","error_code":"conflict"}""")
    assertEquals("File already exists", e.error)
    assertEquals("conflict", e.code)
    assertEquals("conflict", Models.errorBody("""{"error":"conflict"}""").code)
    assertNull(Models.errorBody("not json").error)
    val t = Models.tokens("""{"access_token":"a","refresh_token":"r"}""")
    assertEquals("a", t.access)
  }

  @Test fun `lock detection`() {
    assertFalse(isLocked(null)); assertFalse(isLocked("")); assertFalse(isLocked("none"))
    assertTrue(isLocked("view_only")); assertTrue(isLocked("full"))
  }
}
