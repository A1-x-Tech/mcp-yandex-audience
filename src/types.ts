/**
 * The server talks to the Yandex Audience Management API
 * (https://api-audience.yandex.ru, /v1/management/*). Auth is a Yandex OAuth
 * token sent as `Authorization: OAuth <token>` with every request; there are
 * read (GET), create (POST), update (PUT) and delete (DELETE) endpoints, so
 * this is a WRITE-capable API — retries and tool annotations must respect that.
 */

/** Content types a file-based (uploading) segment can be confirmed with. */
export type SegmentContentType = "idfa_gaid" | "mac" | "crm";

/**
 * Hashing algorithm for uploaded data. The API schema still lists MD5, but
 * Yandex stopped accepting MD5 on 2025-01-01, so only SHA256 is exposed.
 */
export type HashingAlg = "SHA256";

/** Device-matching mode; IN_DEVICE is only valid for idfa_gaid content. */
export type DeviceMatchingType = "CROSS_DEVICE" | "IN_DEVICE";

/** Comparison for the pixel-segment frequency condition (times_quantity). */
export type TimesQuantityOperation = "lt" | "eq" | "gt";

/** Access level of a segment grant. */
export type GrantPermission = "edit" | "view";

export interface AudienceConfig {
  /**
   * Yandex OAuth token, sent as `Authorization: OAuth …`. Treated as a secret.
   * Absent when YANDEX_AUDIENCE_TOKEN is not set — the server still starts
   * (degraded) and the client raises {@link CredentialsError} at call time.
   */
  token?: string;
  /** API host. Defaults to https://api-audience.yandex.ru (use .com for international accounts). */
  apiHost: string;
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Max retries for transient errors (429 always; 5xx/network only for GET). Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled each retry. Defaults to 500. */
  retryBaseMs?: number;
}

/**
 * What a tool call without a token reads. The first sentence is the historical
 * startup error, verbatim (pinned in client.test.ts) — the rest exists because
 * the token comes only from the environment, so the fix is an operator action
 * plus a restart, never a retry.
 */
export const MISSING_TOKEN_MESSAGE =
  "YANDEX_AUDIENCE_TOKEN is required (Yandex OAuth token; register an app at " +
  "https://oauth.yandex.ru/client/new with the Yandex Audience segment read/write scopes). " +
  "This is not a network failure and retrying will not help: the operator must set this " +
  "environment variable in the MCP client's server config and restart the server — it is " +
  "read only at startup.";

/**
 * Raised when a tool is called while YANDEX_AUDIENCE_TOKEN is missing. The
 * message is the whole point of the class: it is the only text the calling
 * model reads and relays, so it names the fix (which variable, and that a
 * restart is needed) instead of describing the failure. The client throws it
 * while building the auth header — before the request, the retries and fetch —
 * because a missing credential is a configuration problem, not transport
 * trouble, and must never enter the retry/backoff branch.
 */
export class CredentialsError extends Error {
  constructor(message: string = MISSING_TOKEN_MESSAGE) {
    super(message);
    this.name = "CredentialsError";
  }
}

/**
 * The Audience API reports failures as a non-2xx HTTP status with a JSON body
 * ({ errors: [{ error_type, message, location }], code, message }). The parsed
 * body is kept alongside the status and a short readable message is derived.
 */
export class AudienceError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${formatErrorBody(body)}`);
    this.name = "AudienceError";
    this.status = status;
    this.body = body;
  }
}

/** Turns a parsed Audience API error body into a short, readable message. */
function formatErrorBody(body: unknown): string {
  if (body == null) return "(no body)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return String(body);
  const obj = body as Record<string, unknown>;

  const parts: string[] = [];
  if (typeof obj.message === "string" && obj.message) parts.push(obj.message);
  if (Array.isArray(obj.errors)) {
    for (const entry of obj.errors.slice(0, 3)) {
      if (entry === null || typeof entry !== "object") continue;
      const err = entry as Record<string, unknown>;
      const type = typeof err.error_type === "string" ? `[${err.error_type}] ` : "";
      const message = typeof err.message === "string" ? err.message : "";
      if (type || message) parts.push(`${type}${message}`);
    }
  }
  if (parts.length > 0) return parts.join("; ").slice(0, 500);

  return JSON.stringify(obj).slice(0, 500);
}
