package dev.dosya.filesprovider

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.database.MatrixCursor
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import android.util.Log
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException

/**
 * dosya.dev in the Android system file picker.
 *
 * Every method runs on a binder thread and may block; the API client is
 * synchronous. Reads download to the app cache and hand back a descriptor on
 * that file. Writes hand back a descriptor on a scratch file and upload it when
 * the writer closes it.
 */
class DosyaDocumentsProvider : DocumentsProvider() {
  private lateinit var store: SessionStore
  private lateinit var api: ApiClient
  private lateinit var catalog: Catalog
  private lateinit var uploader: Uploader
  private lateinit var uploads: Handler

  override fun onCreate(): Boolean {
    val ctx = context ?: return false
    store = KeystoreSessionStore(ctx)
    api = ApiClient(store, OkHttpClient())
    catalog = Catalog(api)
    uploader = Uploader(api)
    uploads = Handler(HandlerThread("dosya-files-provider-uploads").apply { start() }.looper)
    return true
  }

  private val ctx: Context get() = requireNotNull(context)

  private fun signInIntent(): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getActivity(ctx, 0, launch, flags)
  }

  private fun <T> guarded(block: () -> T): T = Errors.guard(signInIntent(), block)

  // Roots

  override fun queryRoots(projection: Array<String>?): Cursor {
    val cursor = MatrixCursor(projection ?: DEFAULT_ROOT_PROJECTION)
    val signedIn = store.load() != null
    val row = cursor.newRow()
    for (column in cursor.columnNames) {
      when (column) {
        Root.COLUMN_ROOT_ID -> row.add(column, ROOT_ID)
        Root.COLUMN_DOCUMENT_ID -> row.add(column, DocId.Root.encode())
        Root.COLUMN_TITLE -> row.add(column, "dosya.dev")
        Root.COLUMN_SUMMARY -> row.add(column, if (signedIn) null else "Open the dosya.dev app to sign in")
        // The provider's own bitmap, not applicationInfo.icon: the picker loads a
        // root icon through PackageManager.getDrawable, which hands back nothing
        // for this app's adaptive launcher icon, and the row then falls back to
        // the system's generic yellow folder.
        Root.COLUMN_ICON -> row.add(column, R.drawable.ic_dosya_root)
        Root.COLUMN_FLAGS -> row.add(column, Root.FLAG_SUPPORTS_CREATE)
        Root.COLUMN_MIME_TYPES -> row.add(column, "*/*")
      }
    }
    return cursor
  }

  // Reads

  override fun queryDocument(documentId: String, projection: Array<String>?): Cursor = guarded {
    val cursor = MatrixCursor(projection ?: Rows.DEFAULT_DOCUMENT_PROJECTION)
    Rows.addTo(cursor, catalog.row(DocId.parse(documentId)))
    cursor
  }

  override fun queryChildDocuments(parentDocumentId: String, projection: Array<String>?, sortOrder: String?): Cursor = guarded {
    val id = DocId.parse(parentDocumentId)
    val cursor = MatrixCursor(projection ?: Rows.DEFAULT_DOCUMENT_PROJECTION)
    catalog.children(id).forEach { Rows.addTo(cursor, it) }
    cursor.setNotificationUri(ctx.contentResolver, DocumentsContract.buildChildDocumentsUri(AUTHORITY, parentDocumentId))
    cursor
  }

  override fun getDocumentType(documentId: String): String = guarded { catalog.row(DocId.parse(documentId)).mimeType }

  override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor = guarded {
    val id = DocId.parse(documentId) as? DocId.File ?: throw FileNotFoundException("Not a file: $documentId")
    val file = catalog.file(id)
    if (isLocked(file.lockMode)) throw FileNotFoundException("${file.name} is locked. Open it in the dosya.dev app.")
    val writing = mode.contains('w') || mode.contains('a')
    if (!writing) {
      return@guarded ParcelFileDescriptor.open(cached(file), ParcelFileDescriptor.MODE_READ_ONLY)
    }
    // Writers get a scratch copy, seeded with the current bytes unless the mode truncates.
    val scratch = File(cacheDir(ctx), "edit-${file.id}-${System.nanoTime()}")
    if (mode.contains('t') || mode == "w") scratch.writeBytes(ByteArray(0)) else cached(file).copyTo(scratch, overwrite = true)
    val mime = file.mimeType?.takeIf { it.isNotEmpty() } ?: "application/octet-stream"
    ParcelFileDescriptor.open(scratch, ParcelFileDescriptor.parseMode(mode), uploads) { error ->
      try {
        if (error == null) {
          when (val out = uploader.uploadEdit(scratch, file, file.name, mime, baseVersion = file.currentVersion)) {
            is EditOutcome.Saved -> scratch.copyTo(cachedPath(out.file), overwrite = true)
            is EditOutcome.Conflicted -> Log.i(TAG, "saved ${file.name} as a conflicted copy")
          }
          notifyChildren(DocId.container(id.workspace, file.folderId))
        }
      } catch (e: Throwable) {
        Log.w(TAG, "upload of ${file.name} failed: ${e.message}")
        UploadFailureNotice.show(ctx, file.name, e.message)
      } finally {
        scratch.delete()
      }
    }
  }

  private fun cachedPath(file: FileDTO) = File(cacheDir(ctx), "${file.id}-${file.currentVersion}")

  /** One lock per file id: two apps opening the same document download it once, not twice into each other. */
  private val downloadLocks = java.util.concurrent.ConcurrentHashMap<String, Any>()

  /** The file's bytes on disk, downloaded once per version. */
  private fun cached(file: FileDTO): File {
    val dest = cachedPath(file)
    synchronized(downloadLocks.getOrPut(file.id) { Any() }) {
      if (dest.exists() && dest.length() == file.sizeBytes) return dest
      val url = Models.downloadUrl(api.getJson("/api/files/${file.id}/download-url")) ?: throw UnreachableException()
      api.download(url, dest)
      return dest
    }
  }

  // Writes

  override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String = guarded {
    val parent = DocId.parse(parentDocumentId)
    val ws = parent.workspaceId ?: throw UnsupportedOperationException("Workspaces can be created only in the dosya.dev app.")
    if (parent is DocId.File) throw FileNotFoundException("Not a folder: $parentDocumentId")
    val folderId = parent.listingFolderId
    val id = if (mimeType == Document.MIME_TYPE_DIR) {
      DocId.Folder(ws, catalog.createFolder(displayName, ws, folderId).id)
    } else {
      val empty = File(cacheDir(ctx), "new-${System.nanoTime()}").apply { writeBytes(ByteArray(0)) }
      try {
        DocId.File(ws, uploader.uploadNew(empty, displayName, mimeType, ws, folderId).id)
      } finally {
        empty.delete()
      }
    }
    notifyChildren(parent)
    id.encode()
  }

  override fun renameDocument(documentId: String, displayName: String): String? = guarded {
    val id = DocId.parse(documentId)
    // Read the container BEFORE renaming: the framework hands a rename no parent,
    // and without notifying that container the picker shows the old name until
    // the user navigates away and back.
    val parent = catalog.parentOf(id)
    when (id) {
      is DocId.File -> api.send("PUT", "/api/files/${id.id}/rename", json = JSONObject().put("name", displayName))
      is DocId.Folder -> {
        require(Names.isValidFolderName(displayName)) { "Folder names on dosya.dev can't contain / or \\." }
        api.send("PUT", "/api/folders/${id.id}/rename", json = JSONObject().put("name", displayName))
      }
      else -> throw UnsupportedOperationException(WORKSPACES_READ_ONLY)
    }
    notifyChildren(parent)
    null // ids are server ids and do not change
  }

  override fun moveDocument(sourceDocumentId: String, sourceParentDocumentId: String?, targetParentDocumentId: String): String = guarded {
    val source = DocId.parse(sourceDocumentId)
    val target = DocId.parse(targetParentDocumentId)
    val ws = source.workspaceId
    if (ws == null || target.workspaceId == null || target is DocId.File) throw UnsupportedOperationException(WORKSPACES_READ_ONLY)
    if (target.workspaceId != ws) throw UnsupportedOperationException("Moving between workspaces isn't supported yet. Copy it instead.")
    val folderId: Any = target.listingFolderId ?: JSONObject.NULL
    when (source) {
      is DocId.File -> api.send("PUT", "/api/files/${source.id}/move", json = JSONObject().put("folder_id", folderId))
      is DocId.Folder -> api.send("PUT", "/api/folders/${source.id}/move", json = JSONObject().put("parent_id", folderId))
      else -> throw UnsupportedOperationException(WORKSPACES_READ_ONLY)
    }
    sourceParentDocumentId?.let { notifyChildren(DocId.parse(it)) }
    notifyChildren(target)
    sourceDocumentId
  }

  /**
   * Moves the item to the dosya.dev trash. A SECOND delete of a trashed item is
   * a permanent purge on the server, so the state is read first and
   * trash_only=1 makes the server refuse to purge on a resend.
   */
  override fun deleteDocument(documentId: String) = guarded {
    when (val id = DocId.parse(documentId)) {
      is DocId.File -> {
        val file = try { catalog.file(id) } catch (_: FileNotFoundException) { return@guarded }
        api.send("DELETE", "/api/files/${id.id}", query = mapOf("trash_only" to "1"))
        notifyChildren(DocId.container(id.workspace, file.folderId))
      }
      is DocId.Folder -> {
        val folder = try { catalog.folder(id) } catch (_: FileNotFoundException) { return@guarded }
        api.send("DELETE", "/api/folders/${id.id}", query = mapOf("trash_only" to "1"))
        notifyChildren(DocId.container(id.workspace, folder.parentId))
      }
      else -> throw UnsupportedOperationException(WORKSPACES_READ_ONLY)
    }
  }

  private fun notifyChildren(parent: DocId) {
    ctx.contentResolver.notifyChange(DocumentsContract.buildChildDocumentsUri(AUTHORITY, parent.encode()), null)
  }

  companion object {
    const val TAG = "DosyaFilesProvider"
    const val AUTHORITY = "dev.dosya.documents"
    private const val ROOT_ID = "dosya"
    private const val WORKSPACES_READ_ONLY = "Workspaces can be renamed or removed only in the dosya.dev app."

    private val DEFAULT_ROOT_PROJECTION = arrayOf(
      Root.COLUMN_ROOT_ID, Root.COLUMN_DOCUMENT_ID, Root.COLUMN_TITLE, Root.COLUMN_SUMMARY,
      Root.COLUMN_ICON, Root.COLUMN_FLAGS, Root.COLUMN_MIME_TYPES,
    )

    fun cacheDir(context: Context): File = File(context.cacheDir, "files-provider").apply { mkdirs() }

    /** Sign-out and account switch: the next account must not find this one's files in the cache. */
    fun clearCache(context: Context) {
      cacheDir(context).deleteRecursively()
    }

    /** Pickers re-query roots (signed in or not) and listings. */
    fun notifyRoots(context: Context) {
      context.contentResolver.notifyChange(DocumentsContract.buildRootsUri(AUTHORITY), null)
    }
  }
}
