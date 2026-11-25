package dev.dosya.filesprovider

import android.provider.DocumentsContract.Document
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RowsTest {
  private fun has(flags: Int, flag: Int) = flags and flag == flag

  @Test fun `root row`() {
    val r = Rows.root()
    assertEquals("root", r.documentId)
    assertEquals(Document.MIME_TYPE_DIR, r.mimeType)
    assertEquals(0, r.flags)
  }

  @Test fun `workspace rows allow creating only`() {
    val r = Rows.workspace(WorkspaceDTO("w1", "Home", null, 0, 1700000000.0))
    assertEquals("ws:w1", r.documentId)
    assertEquals("Home", r.displayName)
    assertEquals(Document.FLAG_DIR_SUPPORTS_CREATE, r.flags)
    assertEquals(1700000000000L, r.lastModified)
  }

  @Test fun `folder rows are fully editable`() {
    val r = Rows.folder("w1", FolderDTO("f1", "Docs", null, "w1", "none", false, 1.0, 2.0))
    assertEquals("fo:w1:f1", r.documentId)
    assertTrue(has(r.flags, Document.FLAG_DIR_SUPPORTS_CREATE))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_RENAME))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_MOVE))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_DELETE))
    assertEquals(2000L, r.lastModified)
  }

  @Test fun `file rows carry size mime and write flags`() {
    val r = Rows.file("w1", FileDTO("x1", "a.pdf", 123, "application/pdf", "f1", "w1", "none", 3, 1.0, null, null))
    assertEquals("fi:w1:x1", r.documentId)
    assertEquals("application/pdf", r.mimeType)
    assertEquals(123L, r.size)
    assertEquals(1000L, r.lastModified)
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_WRITE))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_RENAME))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_MOVE))
    assertTrue(has(r.flags, Document.FLAG_SUPPORTS_DELETE))
  }

  @Test fun `file without a mime type falls back to octet-stream`() {
    val r = Rows.file("w1", FileDTO("x1", "blob", 0, null, null, "w1", null, 1, null, null, null))
    assertEquals("application/octet-stream", r.mimeType)
    assertNull(r.lastModified)
  }

  @Test fun `locked file is read-only`() {
    val r = Rows.file("w1", FileDTO("x1", "a", 0, "text/plain", null, "w1", "full", 1, null, null, null))
    assertEquals(0, r.flags and Document.FLAG_SUPPORTS_WRITE)
  }
}
