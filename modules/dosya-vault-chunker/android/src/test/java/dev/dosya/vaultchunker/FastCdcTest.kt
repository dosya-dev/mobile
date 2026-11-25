package dev.dosya.vaultchunker

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer

class FastCdcTest {
  /** Deterministic bytes: xorshift32 from seed 0x12345678, low byte - e2ee-core's chunkerVectorBytes. */
  private fun vectorBytes(n: Int): ByteArray {
    val a = ByteArray(n)
    var s = 0x12345678
    for (i in 0 until n) {
      s = s xor (s shl 13); s = s xor (s ushr 17); s = s xor (s shl 5)
      a[i] = (s and 0xff).toByte()
    }
    return a
  }

  @Test
  fun gearTableMatchesE2eeCore() {
    assertEquals("316e3aaf9142a51ab230212ecd96e71b4ff23ea1fd3d3e56f43b6a8759b04d0c", FastCdc.gearTableSha256Hex())
  }

  @Test
  fun emptyAndSingleByteInputs() {
    assertEquals(emptyList<FastCdc.Boundary>(), FastCdc.boundaries(ByteBuffer.wrap(ByteArray(0)), 262144, 1048576, 4194304))
    assertEquals(listOf(FastCdc.Boundary(0, 1)), FastCdc.boundaries(ByteBuffer.wrap(ByteArray(1)), 262144, 1048576, 4194304))
  }

  @Test
  fun oneMiBPlusOneMatchesFrozenVector() {
    // The size-1048577 entry of e2ee-core's frozen CHUNKER_VECTORS.
    val expected = listOf(FastCdc.Boundary(0, 1048577))
    val actual = FastCdc.boundaries(ByteBuffer.wrap(vectorBytes(1048577)), 262144, 1048576, 4194304)
    assertEquals(expected, actual)
  }

  @Test
  fun fourMiBMatchesFrozenVector() {
    // The size-4194304 entry of e2ee-core's frozen CHUNKER_VECTORS. The 1 MiB+1
    // vector cuts nowhere, so this is the one that pins maskS/maskL and the
    // rolling hash: four content-defined cuts, none of them at min or max.
    val expected = listOf(
      FastCdc.Boundary(0, 1335617),
      FastCdc.Boundary(1335617, 1083963),
      FastCdc.Boundary(2419580, 1471063),
      FastCdc.Boundary(3890643, 303661),
    )
    val actual = FastCdc.boundaries(ByteBuffer.wrap(vectorBytes(4194304)), 262144, 1048576, 4194304)
    assertEquals(expected, actual)
  }
}
