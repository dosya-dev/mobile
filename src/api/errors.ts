export class ApiError extends Error {
  status: number;
  code?: string;
  /** The Retry-After header of a 429, in seconds, when the server sent one. */
  retryAfterS?: number;
  /** The error response body, for refusals that carry more than a code (a 409's `max_gb`). */
  data?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, retryAfterS?: number, data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterS = retryAfterS;
    this.data = data;
  }
}
