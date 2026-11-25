package dev.dosya.filesprovider

import android.database.MatrixCursor
import android.provider.DocumentsContract.Document

data class Row(
  val documentId: String,
  val displayName: String,
  val mimeType: String,
  val flags: Int,
  val size: Long?,
  val lastModified: Long?,
)

object Rows {
  private const val OCTET = "application/octet-stream"
  private fun millis(seconds: Double?): Long? = seconds?.let { (it * 1000).toLong() }

  fun root(): Row = Row(DocId.Root.encode(), "dosya.dev", Document.MIME_TYPE_DIR, 0, null, null)

  /** Workspaces are top-level folders that cannot be renamed, moved or deleted from the picker. */
  fun workspace(ws: WorkspaceDTO): Row =
    Row(DocId.Workspace(ws.id).encode(), ws.name, Document.MIME_TYPE_DIR, Document.FLAG_DIR_SUPPORTS_CREATE, null, millis(ws.createdAt))

  fun folder(workspaceId: String, f: FolderDTO): Row = Row(
    DocId.Folder(workspaceId, f.id).encode(), f.name, Document.MIME_TYPE_DIR,
    Document.FLAG_DIR_SUPPORTS_CREATE or Document.FLAG_SUPPORTS_RENAME or Document.FLAG_SUPPORTS_MOVE or Document.FLAG_SUPPORTS_DELETE,
    null, millis(f.updatedAt ?: f.createdAt),
  )

  fun file(workspaceId: String, f: FileDTO): Row {
    var flags = Document.FLAG_SUPPORTS_RENAME or Document.FLAG_SUPPORTS_MOVE or Document.FLAG_SUPPORTS_DELETE
    if (!isLocked(f.lockMode)) flags = flags or Document.FLAG_SUPPORTS_WRITE
    return Row(
      DocId.File(workspaceId, f.id).encode(), f.name, f.mimeType?.takeIf { it.isNotEmpty() } ?: OCTET,
      flags, f.sizeBytes, millis(f.updatedAt ?: f.createdAt),
    )
  }

  val DEFAULT_DOCUMENT_PROJECTION = arrayOf(
    Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
    Document.COLUMN_FLAGS, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
  )

  /** Fills only the columns the cursor was created with; unknown columns are left null. */
  fun addTo(cursor: MatrixCursor, row: Row) {
    val r = cursor.newRow()
    for (column in cursor.columnNames) {
      when (column) {
        Document.COLUMN_DOCUMENT_ID -> r.add(column, row.documentId)
        Document.COLUMN_DISPLAY_NAME -> r.add(column, row.displayName)
        Document.COLUMN_MIME_TYPE -> r.add(column, row.mimeType)
        Document.COLUMN_FLAGS -> r.add(column, row.flags)
        Document.COLUMN_SIZE -> r.add(column, row.size)
        Document.COLUMN_LAST_MODIFIED -> r.add(column, row.lastModified)
      }
    }
  }
}
