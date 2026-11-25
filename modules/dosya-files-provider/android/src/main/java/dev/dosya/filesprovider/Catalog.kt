package dev.dosya.filesprovider

import org.json.JSONObject
import java.io.FileNotFoundException

private const val PAGE_SIZE = 500

/** Read-side lookups and the one create that is not an upload. Everything else lives in the provider. */
class Catalog(private val api: ApiClient) {
  fun row(id: DocId): Row = when (id) {
    DocId.Root -> Rows.root()
    is DocId.Workspace -> Rows.workspace(workspace(id.id))
    is DocId.Folder -> Rows.folder(id.workspace, folder(id))
    is DocId.File -> Rows.file(id.workspace, file(id))
  }

  fun workspace(id: String): WorkspaceDTO =
    api.workspaces().firstOrNull { it.id == id } ?: throw FileNotFoundException("Workspace $id")

  fun folder(id: DocId.Folder): FolderDTO {
    val f = Models.folder(api.getJson("/api/folders/${id.id}"))
    if (f.isDeleted) throw FileNotFoundException("Folder ${id.id} is in the trash")
    return f
  }

  fun file(id: DocId.File): FileDTO {
    val f = Models.file(api.getJson("/api/files/${id.id}"))
    if (f.deletedAt != null) throw FileNotFoundException("File ${id.id} is in the trash")
    return f
  }

  /**
   * The container a document sits in. Used after a rename, which changes what a
   * listing should show but tells the framework nothing about where: without
   * notifying that container, the picker keeps showing the old name until the
   * user navigates away and back.
   */
  fun parentOf(id: DocId): DocId = when (id) {
    DocId.Root, is DocId.Workspace -> DocId.Root
    is DocId.File -> file(id).let { DocId.container(id.workspace, it.folderId) }
    is DocId.Folder -> folder(id).let { DocId.container(id.workspace, it.parentId) }
  }

  /** Unlocked child folders first (reported once, though they ride along on every page), then files, all pages. */
  fun children(id: DocId): List<Row> {
    val ws = id.workspaceId ?: return api.workspaces(fresh = true).map(Rows::workspace)
    if (id is DocId.File) throw FileNotFoundException("Not a folder")
    val folders = ArrayList<Row>()
    val files = ArrayList<Row>()
    var page = 1
    while (true) {
      val listing = Models.listing(api.getJson("/api/files", mapOf(
        "workspace_id" to ws, "folder_id" to id.listingFolderId,
        "page" to page.toString(), "per_page" to PAGE_SIZE.toString(), "sort" to "name_asc",
      )))
      if (page == 1) listing.folders.filter { !isLocked(it.lockMode) }.forEach { folders.add(Rows.folder(ws, it)) }
      listing.files.forEach { files.add(Rows.file(ws, it)) }
      if (page >= listing.totalPages) break
      page++
    }
    return folders + files
  }

  /** POST /api/folders is find-or-create; a created_count of 0 means the name was taken, so the next candidate is tried. */
  fun createFolder(name: String, workspaceId: String, folderId: String?): FolderDTO {
    require(Names.isValidFolderName(name)) { "Folder names on dosya.dev can't contain / or \\." }
    for (candidate in Names.candidates(name)) {
      val text = try {
        api.send("POST", "/api/folders", json = JSONObject()
          .put("workspace_id", workspaceId)
          .put("parent_id", folderId ?: JSONObject.NULL)
          .put("name", candidate))
      } catch (e: ApiException) {
        if (e.isNameCollision) continue else throw e
      }
      if (Models.folderCreatedCount(text) == 0) continue
      return Models.folder(text)
    }
    throw NameTakenException(name)
  }
}
