package dev.dosya.filesprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.FileNotFoundException

class DocIdTest {
  @Test fun `round trips every kind`() {
    val ids = listOf(DocId.Root, DocId.Workspace("w1"), DocId.Folder("w1", "f1"), DocId.File("w1", "x1"))
    for (id in ids) assertEquals(id, DocId.parse(id.encode()))
  }

  @Test fun `encodes with kind prefixes`() {
    assertEquals("root", DocId.Root.encode())
    assertEquals("ws:w1", DocId.Workspace("w1").encode())
    assertEquals("fo:w1:f1", DocId.Folder("w1", "f1").encode())
    assertEquals("fi:w1:x1", DocId.File("w1", "x1").encode())
  }

  @Test fun `rejects unknown and truncated ids`() {
    for (raw in listOf("", "zz:1", "fo:abc", "fi:w1:", "ws:", "fo::f1", "root:x")) {
      assertThrows(FileNotFoundException::class.java) { DocId.parse(raw) }
    }
  }

  @Test fun `container is the workspace when the folder is null or blank`() {
    assertEquals(DocId.Workspace("w1"), DocId.container("w1", null))
    assertEquals(DocId.Workspace("w1"), DocId.container("w1", ""))
    assertEquals(DocId.Folder("w1", "f1"), DocId.container("w1", "f1"))
  }

  @Test fun `exposes the workspace and listing folder`() {
    assertNull(DocId.Root.workspaceId)
    assertEquals("w1", DocId.Workspace("w1").workspaceId)
    assertNull(DocId.Workspace("w1").listingFolderId)
    assertEquals("f1", DocId.Folder("w1", "f1").listingFolderId)
  }
}
