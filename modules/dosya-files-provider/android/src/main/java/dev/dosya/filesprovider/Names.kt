package dev.dosya.filesprovider

object Names {
  private fun split(name: String): Pair<String, String> {
    val dot = name.lastIndexOf('.')
    // A leading dot is a hidden file, not an extension.
    return if (dot <= 0) name to "" else name.substring(0, dot) to name.substring(dot + 1)
  }

  /** "Report.pdf", then "Report 2.pdf" .. "Report 20.pdf": the provider settles name clashes. */
  fun candidates(name: String): List<String> {
    val (stem, ext) = split(name)
    return listOf(name) + (2..20).map { if (ext.isEmpty()) "$stem $it" else "$stem $it.$ext" }
  }

  fun conflictedCopy(name: String): String {
    val (stem, ext) = split(name)
    return if (ext.isEmpty()) "$stem (conflicted copy)" else "$stem (conflicted copy).$ext"
  }

  /** POST /api/folders treats / and \ as path separators and would nest folders. */
  fun isValidFolderName(name: String): Boolean =
    name.isNotBlank() && !name.contains('/') && !name.contains('\\')

  /**
   * Workspaces are siblings in one folder and pickers show them by name;
   * two with the same name are told apart by slug, or by the id's first six
   * characters when there is no slug.
   */
  fun disambiguateWorkspaces(list: List<WorkspaceDTO>): List<WorkspaceDTO> {
    val counts = list.groupingBy { it.name.lowercase() }.eachCount()
    return list.map { ws ->
      if ((counts[ws.name.lowercase()] ?: 0) <= 1) ws
      else ws.copy(name = "${ws.name} (${ws.slug?.takeIf { it.isNotEmpty() } ?: ws.id.take(6)})")
    }
  }
}
