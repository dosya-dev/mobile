import { apiRequest } from "@/api";

export interface BugReportImage { uri: string; name: string; type: string }

/** The server's own allowlist for a ticket's screenshots; anything else
 *  refuses the whole ticket, so the picker filters to this first. */
export const BUG_REPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** The server's own size cap for a ticket's screenshots. */
export const BUG_REPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/support/tickets as a bug report: no subject (the server derives
 * it), category `bug`, the diagnostics document when the user kept it, and
 * screenshots as React Native file parts ({ uri, name, type }, the shape RN's
 * FormData turns into a multipart file).
 */
export async function createBugReport(input: {
  body: string;
  workspaceId: string | null;
  diagnostics: string | null;
  images: BugReportImage[];
}): Promise<{ id: string }> {
  const form = new FormData();
  form.append("subject", "");
  form.append("category", "bug");
  form.append("body", input.body);
  if (input.workspaceId) form.append("workspace_id", input.workspaceId);
  if (input.diagnostics) form.append("diagnostics", input.diagnostics);
  for (const img of input.images) {
    form.append("images", { uri: img.uri, name: img.name, type: img.type } as unknown as Blob);
  }
  const res = await apiRequest<{ ok: boolean; ticket: { id: string } }>("/api/support/tickets", { method: "POST", body: form });
  return { id: res.ticket.id };
}
