import type { AudienceConfig } from "./types.js";

/** Default Yandex Audience API host (the English docs use api-audience.yandex.com). */
export const DEFAULT_HOST = "https://api-audience.yandex.ru";

/**
 * A malformed environment variable. Thrown instead of exiting on the spot so
 * index.ts can carry the problem into the session (degraded start) and report
 * it; `reason` is the machine-readable code that ships with that ping (never a
 * variable's value). A *missing* variable is NOT a ConfigError — see loadConfig.
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

/**
 * Builds the client config from environment variables.
 *
 * A missing token is NOT an error here: the server starts anyway and the token
 * is resolved per request (env → stored credentials, TokenStore in auth.ts), so
 * an unconfigured install can log in from the chat (`start_login`) instead of
 * dying before the MCP handshake — which is where it used to leave the user
 * with a dead server and no reason. (No malformed-value checks exist today —
 * bad numeric overrides fall back to their defaults — so loadConfig currently
 * never throws; ConfigError is kept for future checks.)
 *
 *   YANDEX_AUDIENCE_TOKEN            Yandex OAuth token (optional — in-chat login otherwise)
 *   YANDEX_AUDIENCE_OAUTH_CLIENT_ID  own OAuth app for the in-chat login (read in oauth.ts)
 *   YANDEX_AUDIENCE_API_HOST         API host override (default https://api-audience.yandex.ru)
 *   YANDEX_AUDIENCE_TIMEOUT_MS       per-request timeout, ms (default 60000)
 *   YANDEX_AUDIENCE_MAX_RETRIES      retries for transient errors (default 3)
 */
export function loadConfig(): AudienceConfig {
  const timeoutMs = Number(process.env.YANDEX_AUDIENCE_TIMEOUT_MS);
  const maxRetries = Number(process.env.YANDEX_AUDIENCE_MAX_RETRIES);

  return {
    // An empty string reads as absent, never as an empty credential.
    token: process.env.YANDEX_AUDIENCE_TOKEN || undefined,
    apiHost: process.env.YANDEX_AUDIENCE_API_HOST || DEFAULT_HOST,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}
