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
  /** Yandex OAuth token, sent as `Authorization: OAuth …`. Treated as a secret. */
  token: string;
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
