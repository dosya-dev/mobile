package dev.dosya.vaultchunker

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileChannel

/** Native chunk boundaries for the Vault (see ../../../../../index.ts). */
class DosyaVaultChunkerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DosyaVaultChunker")

    Function("gearTableSha256Hex") { FastCdc.gearTableSha256Hex() }

    AsyncFunction("chunkBoundaries") { path: String, min: Int, avg: Int, max: Int ->
      if (!(min > 0 && avg >= min && max >= avg)) throw ChunkerException("EINVAL", "params must satisfy 0 < min <= avg <= max")
      val file = File(path)
      if (!file.isFile) throw ChunkerException("ENOENT", "no such file: $path")
      if (!file.canRead()) throw ChunkerException("EACCES", "file not readable: $path")
      val size = file.length()
      if (size > Int.MAX_VALUE) throw ChunkerException("EINVAL", "file too large to map: $size bytes")
      RandomAccessFile(file, "r").use { raf ->
        val map = raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, size)
        FastCdc.boundaries(map, min, avg, max).map { mapOf("offset" to it.offset, "size" to it.size) }
      }
    }
  }
}

class ChunkerException(code: String, message: String) : CodedException(code, message, null)
