package dev.dosya.backupstatus

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SnapshotStoreTest {
  private val full = """
    {"phase":"uploading","done":3,"total":10,"bytesPerSec":1048576,
     "updatedAt":1786000000,"workspaceName":"onedrivetest",
     "storageUsed":590558003,"storageTotal":5368709120,
     "lastRunAt":1785990000,"lastRunCount":42,"lastSpeedBps":2097152,
     "theme":{"light":{"bg":"#ffffff","ink":"#000000","mut":"#666666",
                        "track":"#eeeeee","go":"#0a7cff","bad":"#d33"},
              "dark":{"bg":"#000000","ink":"#ffffff","mut":"#999999",
                       "track":"#222222","go":"#0a7cff","bad":"#d33"}}}
  """

  @Test fun `parses a complete snapshot`() {
    val s = SnapshotStore.parse(full)!!
    assertEquals("uploading", s.phase)
    assertEquals(3, s.done)
    assertEquals(10, s.total)
    assertEquals("onedrivetest", s.workspaceName)
    assertEquals(5368709120L, s.storageTotal)
    assertEquals(42, s.lastRunCount)
  }

  @Test fun `treats JSON null as absent for optional fields`() {
    val s = SnapshotStore.parse(
      """{"phase":"idle","done":0,"total":0,"bytesPerSec":0,"updatedAt":1,
          "workspaceName":null,"storageUsed":null,"storageTotal":null,
          "lastRunAt":null,"lastRunCount":null,"lastSpeedBps":null,
          "theme":{"light":{},"dark":{}}}"""
    )!!
    assertNull(s.workspaceName)
    assertNull(s.storageTotal)
    assertNull(s.lastRunAt)
  }

  // The widget renders inside the launcher's process - a throw here would be
  // reported to the user as dosya crashing their home screen.
  @Test fun `returns null instead of throwing on malformed json`() {
    assertNull(SnapshotStore.parse("not json at all"))
    assertNull(SnapshotStore.parse("{"))
    assertNull(SnapshotStore.parse(null))
    assertNull(SnapshotStore.parse(""))
  }

  @Test fun `falls back to safe palette values when theme keys are missing`() {
    val s = SnapshotStore.parse(
      """{"phase":"idle","done":0,"total":0,"bytesPerSec":0,"updatedAt":1,
          "theme":{"light":{},"dark":{}}}"""
    )!!
    // Unparseable colour -> opaque fallback, never a crash and never transparent.
    assertEquals(0xFF000000.toInt(), s.theme.light.ink)
  }
}
