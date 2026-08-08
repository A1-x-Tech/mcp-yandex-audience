import type { AudienceConfig } from "./types.js";

/** Default Yandex Audience API host (the English docs use api-audience.yandex.com). */
const DEFAULT_HOST = "https://api-audience.yandex.ru";

/**
 * A missing or malformed environment variable. Thrown instead of exiting on the
 * spot so index.ts can report the drop-off before the process dies; `reason` is
 * the machine-readable code that ships with that ping (never a variable's value).
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

function die(message: string, reason: string): never {
  throw new ConfigError(message, reason);
}

/**
 * Builds the client config from environment variables, throwing ConfigError if
 * a required one is missing.
 *
 *   YANDEX_AUDIENCE_TOKEN        Yandex OAuth token (required)
 *   YANDEX_AUDIENCE_API_HOST     API host override (default https://api-audience.yandex.ru)
 *   YANDEX_AUDIENCE_TIMEOUT_MS   per-request timeout, ms (default 60000)
 *   YANDEX_AUDIENCE_MAX_RETRIES  retries for transient errors (default 3)
 */
export function loadConfig(): AudienceConfig {
  const token = process.env.YANDEX_AUDIENCE_TOKEN;
  if (!token) {
    die(
      "YANDEX_AUDIENCE_TOKEN is required (Yandex OAuth token; register an app at https://oauth.yandex.ru/client/new with the Yandex Audience segment read/write scopes).",
      "missing_token",
    );
  }

  const timeoutMs = Number(process.env.YANDEX_AUDIENCE_TIMEOUT_MS);
  const maxRetries = Number(process.env.YANDEX_AUDIENCE_MAX_RETRIES);

  return {
    token,
    apiHost: process.env.YANDEX_AUDIENCE_API_HOST || DEFAULT_HOST,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}
