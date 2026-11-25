package dev.dosya.filesprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionStoreTest {
  @Test fun `round trips the JS shape`() {
    val json = """{"access":"a","refresh":"r","apiBaseUrl":"https://api.test","userId":"u1"}"""
    val s = LinkedSession.fromJson(json)!!
    assertEquals(LinkedSession("a", "r", "https://api.test", "u1"), s)
    assertEquals(s, LinkedSession.fromJson(s.toJson()))
  }

  @Test fun `rejects incomplete or malformed json`() {
    assertNull(LinkedSession.fromJson("""{"access":"a"}"""))
    assertNull(LinkedSession.fromJson("nope"))
    assertNull(LinkedSession.fromJson(""))
  }

  @Test fun `memory store`() {
    val store = MemorySessionStore()
    assertNull(store.load())
    store.save(LinkedSession("a", "r", "b", "u"))
    assertEquals("u", store.load()!!.userId)
    store.clear()
    assertNull(store.load())
  }
}
