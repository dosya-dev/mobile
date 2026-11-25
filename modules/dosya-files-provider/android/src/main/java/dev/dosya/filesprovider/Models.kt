package dev.dosya.filesprovider

import org.json.JSONArray
import org.json.JSONObject

// Wire shapes of the dosya.dev REST API, read leniently: every field the
// provider can live without is optional, so an older or newer server degrades
// to a missing detail instead of a failed listing.

data class WorkspaceDTO(val id: String, val name: String, val slug: String?, val e2eeMode: Int, val createdAt: Double?)

data class FolderDTO(
  val id: String, val name: String, val parentId: String?, val workspaceId: String?,
  val lockMode: String?, val isDeleted: Boolean, val createdAt: Double?, val updatedAt: Double?,
)

data class FileDTO(
  val id: String, val name: String, val sizeBytes: Long, val mimeType: String?,
  val folderId: String?, val workspaceId: String?, val lockMode: String?, val currentVersion: Int,
  val createdAt: Double?, val updatedAt: Double?, val deletedAt: Double?,
)

data class Listing(val folders: List<FolderDTO>, val files: List<FileDTO>, val page: Int, val totalPages: Int)

data class UploadInit(
  val sessionId: String, val uploadUrl: String,
  val partSize: Int?, val totalParts: Int?, val partUploadUrl: String?, val completeUrl: String?,
) {
  val resumable: Boolean get() = partUploadUrl != null && completeUrl != null && partSize != null
}

data class Tokens(val access: String, val refresh: String)

data class ApiErrorBody(val error: String?, val code: String?)

/** Folders under a view-only or full lock are left out: the picker cannot prompt for a passphrase. */
fun isLocked(mode: String?): Boolean = !mode.isNullOrEmpty() && mode != "none"

private fun JSONObject.str(key: String): String? =
  if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

private fun JSONObject.dbl(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

private fun JSONObject.int(key: String): Int? = if (isNull(key)) null else optInt(key)

private inline fun <T> JSONArray?.mapObjects(f: (JSONObject) -> T): List<T> {
  if (this == null) return emptyList()
  val out = ArrayList<T>(length())
  for (i in 0 until length()) optJSONObject(i)?.let { out.add(f(it)) }
  return out
}

object Models {
  fun workspaces(json: String): List<WorkspaceDTO> =
    JSONObject(json).optJSONArray("workspaces").mapObjects(::workspace)

  private fun workspace(o: JSONObject) = WorkspaceDTO(
    id = o.getString("id"), name = o.optString("name"), slug = o.str("slug"),
    e2eeMode = o.int("e2ee_mode") ?: 0, createdAt = o.dbl("created_at"),
  )

  fun folder(json: String): FolderDTO = folderObject(JSONObject(json).getJSONObject("folder"))

  fun folderObject(o: JSONObject) = FolderDTO(
    id = o.getString("id"), name = o.optString("name"), parentId = o.str("parent_id"),
    workspaceId = o.str("workspace_id"), lockMode = o.str("lock_mode"),
    isDeleted = (o.int("is_deleted") ?: 0) == 1, createdAt = o.dbl("created_at"), updatedAt = o.dbl("updated_at"),
  )

  /** POST /api/folders is find-or-create; created_count 0 means the name already existed. */
  fun folderCreatedCount(json: String): Int? = JSONObject(json).int("created_count")

  fun file(json: String): FileDTO = fileObject(JSONObject(json).getJSONObject("file"))

  fun fileObject(o: JSONObject) = FileDTO(
    id = o.getString("id"), name = o.optString("name"), sizeBytes = o.optLong("size_bytes", 0L),
    mimeType = o.str("mime_type"), folderId = o.str("folder_id"), workspaceId = o.str("workspace_id"),
    lockMode = o.str("lock_mode"), currentVersion = o.int("current_version") ?: 1,
    createdAt = o.dbl("created_at"), updatedAt = o.dbl("updated_at"), deletedAt = o.dbl("deleted_at"),
  )

  fun listing(json: String): Listing {
    val o = JSONObject(json)
    val p = o.optJSONObject("pagination")
    return Listing(
      folders = o.optJSONArray("folders").mapObjects(::folderObject),
      files = o.optJSONArray("files").mapObjects(::fileObject),
      page = p?.int("page") ?: 1, totalPages = p?.int("total_pages") ?: 1,
    )
  }

  fun uploadInit(json: String): UploadInit {
    val o = JSONObject(json)
    val r = o.optJSONObject("resumable")
    return UploadInit(
      sessionId = o.getString("session_id"), uploadUrl = o.getString("upload_url"),
      partSize = r?.int("part_size"), totalParts = r?.int("total_parts"),
      partUploadUrl = r?.str("part_upload_url"), completeUrl = r?.str("complete_url"),
    )
  }

  fun uploadedFile(json: String, fallbackSize: Long, fallbackMime: String, workspaceId: String, folderId: String?): FileDTO {
    val o = JSONObject(json).getJSONObject("file")
    val now = System.currentTimeMillis() / 1000.0
    val created = o.dbl("created_at") ?: now
    return FileDTO(
      id = o.getString("id"), name = o.optString("name"),
      sizeBytes = if (o.isNull("size_bytes")) fallbackSize else o.optLong("size_bytes", fallbackSize),
      mimeType = o.str("mime_type") ?: fallbackMime, folderId = folderId, workspaceId = workspaceId,
      lockMode = "none", currentVersion = o.int("version") ?: 1,
      createdAt = created, updatedAt = created, deletedAt = null,
    )
  }

  fun tokens(json: String): Tokens {
    val o = JSONObject(json)
    return Tokens(o.getString("access_token"), o.getString("refresh_token"))
  }

  /** Never throws: error bodies are whatever the server (or a proxy) sent. */
  fun errorBody(json: String): ApiErrorBody = try {
    val o = JSONObject(json)
    ApiErrorBody(error = o.str("error"), code = o.str("error_code") ?: o.str("error"))
  } catch (_: Throwable) {
    ApiErrorBody(null, null)
  }

  fun downloadUrl(json: String): String? {
    val o = JSONObject(json)
    return o.str("url") ?: o.str("download_url")
  }
}
