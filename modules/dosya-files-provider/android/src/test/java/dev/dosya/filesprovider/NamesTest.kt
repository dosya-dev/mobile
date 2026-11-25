package dev.dosya.filesprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NamesTest {
  @Test fun `candidates keep the extension`() {
    val c = Names.candidates("Report.pdf")
    assertEquals("Report.pdf", c[0])
    assertEquals("Report 2.pdf", c[1])
    assertEquals("Report 20.pdf", c.last())
    assertEquals(20, c.size)
  }

  @Test fun `candidates without an extension`() {
    assertEquals(listOf("notes", "notes 2"), Names.candidates("notes").take(2))
    assertEquals(listOf(".env", ".env 2"), Names.candidates(".env").take(2))
  }

  @Test fun `conflicted copy naming`() {
    assertEquals("a (conflicted copy).txt", Names.conflictedCopy("a.txt"))
    assertEquals("a (conflicted copy)", Names.conflictedCopy("a"))
  }

  @Test fun `folder names may not contain separators`() {
    assertTrue(Names.isValidFolderName("Tax 2026"))
    assertFalse(Names.isValidFolderName("a/b"))
    assertFalse(Names.isValidFolderName("a\\b"))
    assertFalse(Names.isValidFolderName(""))
  }

  @Test fun `duplicate workspace names get a suffix`() {
    val a = WorkspaceDTO("w1", "Home", "home", 0, null)
    val b = WorkspaceDTO("w2", "home", null, 0, null)
    val c = WorkspaceDTO("w3", "Work", null, 0, null)
    val out = Names.disambiguateWorkspaces(listOf(a, b, c))
    assertEquals("Home (home)", out[0].name)
    assertEquals("home (w2)", out[1].name)
    assertEquals("Work", out[2].name)
  }
}
