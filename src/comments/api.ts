import { translateExternal } from "@/lib/external-text";
import { apiRequest } from "@/api/client";
import { LIMITS, validateCommentBody } from "@/lib/validationPolicy.generated";

/**
 * The API rejects anything longer.
 *
 * This was a hand-written `5000` whose comment claimed it was "mirrored so the
 * client can disable Send" - and nothing in the app referenced it, so a 6000-
 * character comment was uploaded in full and refused. Now it comes from the
 * shared policy and `createComment`/`editComment` below actually enforce it.
 */
export const MAX_COMMENT_LENGTH = LIMITS.COMMENT_BODY_MAX;

export interface CommentRow {
  id: string;
  file_id: string | null;
  folder_id: string | null;
  workspace_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  is_edited: number;
  created_at: number;
  updated_at: number;
  user_name: string;
  user_email: string;
  user_avatar: string | null;
}

/**
 * The comment thread on one file, oldest first (the API orders it).
 *
 * Takes a file id rather than a discriminated target: folder comments exist
 * server-side and no client exposes them, so adding folder threads to mobile
 * alone would be new divergence rather than parity.
 */
export async function listComments(workspaceId: string, fileId: string): Promise<CommentRow[]> {
  const qs = new URLSearchParams({ file_id: fileId, workspace_id: workspaceId });
  const res = await apiRequest<{ ok: true; comments?: CommentRow[] }>(`/api/comments?${qs.toString()}`);
  return res.comments ?? [];
}

export async function postComment(input: {
  workspaceId: string;
  fileId: string;
  body: string;
  parentId?: string | null;
}): Promise<CommentRow> {
  const problem = validateCommentBody(input.body);
  if (problem) throw new Error(translateExternal(problem));
  const body: Record<string, string> = {
    workspace_id: input.workspaceId,
    file_id: input.fileId,
    body: input.body.trim(),
  };
  // Absence is what means "top level". Sending parent_id: null would be a value
  // the server then looks up, and it answers a parent it cannot find with a 404.
  if (input.parentId) body.parent_id = input.parentId;
  const res = await apiRequest<{ ok: true; comment: CommentRow }>("/api/comments", {
    method: "POST",
    body,
  });
  return res.comment;
}

export async function editComment(id: string, body: string): Promise<void> {
  const problem = validateCommentBody(body);
  if (problem) throw new Error(translateExternal(problem));
  await apiRequest(`/api/comments/${id}`, { method: "PUT", body: { body: body.trim() } });
}

export async function deleteComment(id: string): Promise<void> {
  await apiRequest(`/api/comments/${id}`, { method: "DELETE" });
}
