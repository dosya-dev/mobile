package dev.dosya.filesprovider

import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okio.BufferedSink
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

class NameTakenException(name: String) : IOException("Every name from \"$name\" to its 20th copy is taken.")

sealed class EditOutcome {
  data class Saved(val file: FileDTO) : EditOutcome()
  /** The edit was kept as a separate copy because someone else changed the file meanwhile. */
  data class Conflicted(val copy: FileDTO) : EditOutcome()
}

/**
 * POST /api/upload/init, then one presigned PUT or numbered parts plus a
 * complete call. Bytes stream from disk one part at a time: the picker may
 * hand over files far larger than the app process should buffer.
 */
class Uploader(private val api: ApiClient) {
  private val octet = "application/octet-stream".toMediaTypeOrNull()

  /** A brand-new file. expected_version 0 makes the server refuse a taken name instead of versioning over it. */
  fun uploadNew(source: File, name: String, mime: String, workspaceId: String, folderId: String?): FileDTO {
    for (candidate in Names.candidates(name)) {
      try {
        return upload(source, candidate, mime, workspaceId, folderId, JSONObject().put("expected_version", 0))
      } catch (e: ApiException) {
        if (!e.isNameCollision) throw e
      }
    }
    throw NameTakenException(name)
  }

  /**
   * An edited file, uploaded as a new version only on top of the version it was
   * opened at. If the server moved on, the bytes are saved next to it as a
   * "conflicted copy" rather than overwriting someone else's work.
   */
  fun uploadEdit(source: File, file: FileDTO, name: String, mime: String, baseVersion: Int): EditOutcome {
    val ws = file.workspaceId ?: ""
    val extra = JSONObject().put("file_id", file.id).put("expected_version", baseVersion)
    return try {
      EditOutcome.Saved(upload(source, name, mime, ws, file.folderId, extra))
    } catch (e: ApiException) {
      if (!e.isVersionConflict) throw e
      EditOutcome.Conflicted(uploadNew(source, Names.conflictedCopy(name), mime, ws, file.folderId))
    }
  }

  private fun upload(source: File, name: String, mime: String, workspaceId: String, folderId: String?, extra: JSONObject): FileDTO {
    val size = source.length()
    val body = JSONObject()
      .put("workspace_id", workspaceId)
      .put("file_name", name)
      .put("file_size", size)
      .put("mime_type", mime)
      .put("folder_id", folderId ?: JSONObject.NULL)
    for (key in extra.keys()) body.put(key, extra.get(key))
    val init = Models.uploadInit(api.send("POST", "/api/upload/init", json = body))

    val result = if (init.resumable) {
      val partSize = init.partSize!!.toLong()
      val total = maxOf(init.totalParts ?: 1, 1)
      for (part in 1..total) {
        val offset = (part - 1) * partSize
        val length = minOf(partSize, maxOf(size - offset, 0L))
        api.send("PUT", "${init.partUploadUrl}/$part", body = RangeBody(source, offset, length, octet))
      }
      api.send("POST", init.completeUrl!!, json = JSONObject())
    } else {
      api.send("PUT", init.uploadUrl, body = source.asRequestBody(mime.toMediaTypeOrNull() ?: octet))
    }
    return Models.uploadedFile(result, fallbackSize = size, fallbackMime = mime, workspaceId = workspaceId, folderId = folderId)
  }
}

/** One slice of a file as a request body, read straight from disk. */
private class RangeBody(private val file: File, private val offset: Long, private val length: Long, private val type: MediaType?) : RequestBody() {
  override fun contentType(): MediaType? = type
  override fun contentLength(): Long = length
  override fun writeTo(sink: BufferedSink) {
    RandomAccessFile(file, "r").use { raf ->
      raf.seek(offset)
      var remaining = length
      val buf = ByteArray(64 * 1024)
      while (remaining > 0) {
        val n = raf.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
        if (n < 0) break
        sink.write(buf, 0, n)
        remaining -= n
      }
    }
  }
}
