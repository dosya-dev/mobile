package dev.dosya.filesprovider

import java.io.FileNotFoundException

/**
 * What a document id points at. The framework hands back nothing but the id,
 * and a folder listing needs its workspace, so ids carry both. Server ids never
 * contain ':'.
 */
sealed class DocId {
  object Root : DocId()
  data class Workspace(val id: String) : DocId()
  data class Folder(val workspace: String, val id: String) : DocId()
  data class File(val workspace: String, val id: String) : DocId()

  fun encode(): String = when (this) {
    Root -> "root"
    is Workspace -> "ws:$id"
    is Folder -> "fo:$workspace:$id"
    is File -> "fi:$workspace:$id"
  }

  val workspaceId: String?
    get() = when (this) {
      Root -> null
      is Workspace -> id
      is Folder -> workspace
      is File -> workspace
    }

  /** The folder_id a listing of this container passes: null at a workspace root. */
  val listingFolderId: String?
    get() = (this as? Folder)?.id

  companion object {
    fun parse(raw: String): DocId {
      if (raw == "root") return Root
      val parts = raw.split(":")
      return when {
        parts.size == 2 && parts[0] == "ws" && parts[1].isNotEmpty() -> Workspace(parts[1])
        parts.size == 3 && parts[0] == "fo" && parts[1].isNotEmpty() && parts[2].isNotEmpty() -> Folder(parts[1], parts[2])
        parts.size == 3 && parts[0] == "fi" && parts[1].isNotEmpty() && parts[2].isNotEmpty() -> File(parts[1], parts[2])
        else -> throw FileNotFoundException("Unknown document: $raw")
      }
    }

    /** The container a folder_id lands in: the folder, or the workspace root when null. */
    fun container(workspaceId: String, folderId: String?): DocId =
      if (folderId.isNullOrEmpty()) Workspace(workspaceId) else Folder(workspaceId, folderId)
  }
}
