package dev.dosya.filesprovider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.FileNotFoundException

class ErrorsTest {
  @Test fun `passes results through`() {
    assertEquals(3, Errors.guard(pendingIntent = null) { 3 })
  }

  @Test fun `not signed in without an intent is not found with the sign-in message`() {
    val e = assertThrows(FileNotFoundException::class.java) { Errors.guard(null) { throw NotSignedInException() } }
    assertEquals("Open the dosya.dev app to sign in.", e.message)
  }

  @Test fun `404 and 401 are not found, unreachable is not found`() {
    assertThrows(FileNotFoundException::class.java) { Errors.guard(null) { throw ApiException("GET", 404, "gone", null) } }
    assertThrows(FileNotFoundException::class.java) { Errors.guard(null) { throw ApiException("GET", 401, "no", null) } }
    val e = assertThrows(FileNotFoundException::class.java) { Errors.guard(null) { throw UnreachableException() } }
    assertEquals("dosya.dev is unreachable.", e.message)
  }

  @Test fun `other refusals keep the server message as an illegal state`() {
    val e = assertThrows(IllegalStateException::class.java) { Errors.guard(null) { throw ApiException("POST", 403, "Read-only member", null) } }
    assertEquals("Read-only member", e.message)
  }

  @Test fun `already mapped exceptions pass unchanged`() {
    assertThrows(UnsupportedOperationException::class.java) { Errors.guard(null) { throw UnsupportedOperationException("x") } }
    assertThrows(IllegalArgumentException::class.java) { Errors.guard(null) { throw IllegalArgumentException("x") } }
  }

  @Test fun `anything else becomes an illegal state`() {
    assertThrows(IllegalStateException::class.java) { Errors.guard(null) { throw RuntimeException("boom") } }
    assertThrows(IllegalStateException::class.java) { Errors.guard(null) { throw NameTakenException("a") } }
  }
}
