import type {
  AudienceConfig,
  DeviceMatchingType,
  GrantPermission,
  HashingAlg,
  SegmentContentType,
  TimesQuantityOperation,
} from "./types.js";
import { AudienceError } from "./types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** Query-string parameters; undefined values are dropped. */
export type Query = Record<string, string | number | boolean | undefined>;

/** Inputs for the segment list (the only paginated endpoint). */
export interface ListSegmentsParams {
  /** How many segments to return (API default 10000). */
  limit?: number;
  /** Index of the first segment to return (0-based, API default 0). */
  offset?: number;
  /** Only segments built on this pixel id. */
  pixel?: number;
}

/** Inputs for confirming (saving) an uploaded file segment. */
export interface ConfirmSegmentParams {
  segment_id: number;
  name: string;
  content_type: SegmentContentType;
  hashed?: boolean;
  hashing_alg?: HashingAlg;
  device_matching_type?: DeviceMatchingType;
  /** false allows saving segments smaller than 100 records. */
  check_size?: boolean;
}

/** Inputs for creating a lookalike segment. */
export interface CreateLookalikeSegmentParams {
  name: string;
  /** Id of the source segment the lookalike is built from. */
  lookalike_link: number;
  /** Similarity degree, 1 (most similar) .. 5 (widest reach). */
  lookalike_value: number;
  maintain_device_distribution?: boolean;
  maintain_geo_distribution?: boolean;
}

/** Inputs for creating a pixel-based segment (conditions are AND-ed). */
export interface CreatePixelSegmentParams {
  name: string;
  pixel_id: number;
  /** Days (1..90) within which the pixel saw the user. */
  period_length?: number;
  times_quantity?: number;
  times_quantity_operation?: TimesQuantityOperation;
  utm_source?: string;
  utm_content?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_medium?: string;
  /** Present in the API request example but undocumented — experimental. */
  device_matching_type?: DeviceMatchingType;
}

/** Inputs for granting segment access to a user. */
export interface AddSegmentGrantParams {
  segment_id: number;
  user_login: string;
  permission: GrantPermission;
  comment?: string;
}

interface SendOptions {
  headers: Record<string, string>;
  /** Rebuilt per attempt so a retried multipart body is never a spent stream. */
  makeBody: () => RequestInit["body"];
  /**
   * Whether the request is safe to repeat after a 5xx or a network error.
   * Only GET is: a 502 after a committed POST/PUT/DELETE would duplicate the
   * write. A 429 never reached the handler, so it is retried for any method.
   */
  idempotent: boolean;
}

export class AudienceClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly config: AudienceConfig) {
    this.base = config.apiHost.endsWith("/") ? config.apiHost : config.apiHost + "/";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  /** OAuth header on every request; Content-Type only when we serialize JSON ourselves. */
  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `OAuth ${this.config.token}`,
    };
    if (contentType) h["Content-Type"] = contentType;
    return h;
  }

  /** Backoff before a retry: honors Retry-After when present, else exponential (capped at 30s). */
  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = res ? Number(res.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30_000);
  }

  /**
   * fetch with an AbortController timeout. Reads the response body inside the
   * guarded zone so the timeout also covers a slow or drip-feeding body, not just
   * the initial headers, and returns the text alongside the response.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request to "${label}" timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolves a path against the API base and rejects anything that escaped to a
   * foreign origin (an absolute "https://evil/x" or a "\\evil/x" slipped through
   * raw_request) so the OAuth token can never leak to another host.
   */
  private resolveUrl(path: string, query?: Query): string {
    const url = new URL(path.replace(/^\//, ""), this.base);
    if (url.origin !== new URL(this.base).origin) {
      throw new Error(`raw_request path must be a relative API path (resolved to foreign origin ${url.origin})`);
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Low-level JSON request to an Audience Management path (e.g.
   * "v1/management/segments"). Retries with backoff: 429 for any method, 5xx and
   * network errors/timeouts only for GET (this is a write API — repeating a
   * committed write would duplicate it). Any other non-2xx throws an
   * {@link AudienceError}.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown>,
    query?: Query,
  ): Promise<T> {
    // Guard method !== "GET" keeps undici from crashing on a GET-with-body.
    const hasBody = body !== undefined && method !== "GET";
    return this.send<T>(method, this.resolveUrl(path, query), path, {
      headers: this.headers(hasBody ? "application/json" : undefined),
      makeBody: () => (hasBody ? JSON.stringify(body) : undefined),
      idempotent: method === "GET",
    });
  }

  /**
   * multipart/form-data upload (segment files). No explicit Content-Type — fetch
   * sets the multipart boundary itself. Non-idempotent: only 429 is retried.
   */
  async upload<T = unknown>(path: string, fileName: string, data: Uint8Array): Promise<T> {
    return this.send<T>("POST", this.resolveUrl(path), path, {
      headers: this.headers(),
      makeBody: () => {
        const form = new FormData();
        // The cast narrows ArrayBufferLike to ArrayBuffer for BlobPart; segment
        // data never lives in a SharedArrayBuffer.
        form.append("file", new Blob([data as Uint8Array<ArrayBuffer>]), fileName);
        return form;
      },
      idempotent: false,
    });
  }

  private async send<T>(method: HttpMethod, target: string, label: string, opts: SendOptions): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(
          target,
          { method, headers: opts.headers, body: opts.makeBody() },
          label,
        ));
      } catch (err) {
        // Network error or timeout: retry idempotent requests with backoff; on the
        // last attempt (or a non-idempotent method) rethrow the original error.
        if (opts.idempotent && attempt < this.maxRetries) {
          await delay(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      const transient = res.status === 429 || (opts.idempotent && res.status >= 500 && res.status < 600);
      if (transient && attempt < this.maxRetries) {
        await delay(this.backoffMs(attempt, res));
        continue;
      }

      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) throw new AudienceError(res.status, data);
      return data as T;
    }
  }

  // --- Segments ---

  /** Segments available to the user (all 7 types), paginated with limit/offset. */
  async listSegments(p: ListSegmentsParams = {}): Promise<unknown> {
    return this.request("GET", "v1/management/segments", undefined, {
      limit: p.limit,
      offset: p.offset,
      pixel: p.pixel,
    });
  }

  /** Uploads a TSV/TXT file (device ids / MACs / hashes) — step 1 of 2, confirm next. */
  async uploadSegmentFile(fileName: string, data: Uint8Array): Promise<unknown> {
    return this.upload("v1/management/segments/upload_file", fileName, data);
  }

  /** Uploads a CSV file with CRM data (email/phone/ext_id header) — step 1 of 2, confirm next. */
  async uploadSegmentCsvFile(fileName: string, data: Uint8Array): Promise<unknown> {
    return this.upload("v1/management/segments/upload_csv_file", fileName, data);
  }

  /** Saves an uploaded segment (step 2 of 2): name, content type and hashing. */
  async confirmSegment(p: ConfirmSegmentParams): Promise<unknown> {
    return this.request(
      "POST",
      `v1/management/segment/${p.segment_id}/confirm`,
      {
        segment: compact({
          id: p.segment_id,
          name: p.name,
          content_type: p.content_type,
          hashed: p.hashed,
          hashing_alg: p.hashing_alg,
          device_matching_type: p.device_matching_type,
        }),
      },
      { check_size: p.check_size },
    );
  }

  /** Renames a segment (the edit schema only exposes `name`). */
  async renameSegment(segmentId: number, name: string): Promise<unknown> {
    return this.request("PUT", `v1/management/segment/${segmentId}`, { segment: { name } });
  }

  /** Deletes a segment. Returns {"success": true}. */
  async deleteSegment(segmentId: number): Promise<unknown> {
    return this.request("DELETE", `v1/management/segment/${segmentId}`);
  }

  /** Creates a lookalike segment from an existing one. */
  async createLookalikeSegment(p: CreateLookalikeSegmentParams): Promise<unknown> {
    return this.request("POST", "v1/management/segments/create_lookalike", {
      segment: compact({
        name: p.name,
        lookalike_link: p.lookalike_link,
        lookalike_value: p.lookalike_value,
        maintain_device_distribution: p.maintain_device_distribution,
        maintain_geo_distribution: p.maintain_geo_distribution,
      }),
    });
  }

  /** Creates a pixel-based segment (period/frequency/UTM conditions are AND-ed). */
  async createPixelSegment(p: CreatePixelSegmentParams): Promise<unknown> {
    return this.request("POST", "v1/management/segments/create_pixel", {
      segment: compact({
        name: p.name,
        pixel_id: p.pixel_id,
        period_length: p.period_length,
        times_quantity: p.times_quantity,
        times_quantity_operation: p.times_quantity_operation,
        utm_source: p.utm_source,
        utm_content: p.utm_content,
        utm_campaign: p.utm_campaign,
        utm_term: p.utm_term,
        utm_medium: p.utm_medium,
        device_matching_type: p.device_matching_type,
      }),
    });
  }

  // --- Pixels ---

  /** All pixels with their segments and 7/30/90-day reach. */
  async listPixels(): Promise<unknown> {
    return this.request("GET", "v1/management/pixels");
  }

  /** Creates a pixel; the response carries the code/URL to embed in ads. */
  async createPixel(name: string): Promise<unknown> {
    return this.request("POST", "v1/management/pixels", { pixel: { name } });
  }

  /** Renames a pixel. */
  async updatePixel(pixelId: number, name: string): Promise<unknown> {
    return this.request("PUT", `v1/management/pixel/${pixelId}`, { pixel: { name } });
  }

  /** Deletes a pixel. Returns {"success": true}. */
  async deletePixel(pixelId: number): Promise<unknown> {
    return this.request("DELETE", `v1/management/pixel/${pixelId}`);
  }

  // --- Grants ---

  /** Permissions granted on a segment. */
  async listSegmentGrants(segmentId: number): Promise<unknown> {
    return this.request("GET", `v1/management/segment/${segmentId}/grants`);
  }

  /** Grants a user edit/view access to a segment. */
  async addSegmentGrant(p: AddSegmentGrantParams): Promise<unknown> {
    return this.request("PUT", `v1/management/segment/${p.segment_id}/grant`, {
      grant: compact({
        user_login: p.user_login,
        permission: p.permission,
        comment: p.comment,
      }),
    });
  }

  /** Revokes a user's access to a segment. Returns {"success": true}. */
  async deleteSegmentGrant(segmentId: number, userLogin: string): Promise<unknown> {
    return this.request("DELETE", `v1/management/segment/${segmentId}/grant`, undefined, {
      user_login: userLogin,
    });
  }
}

/** Drops keys whose value is `undefined` so they are not sent to the API. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
