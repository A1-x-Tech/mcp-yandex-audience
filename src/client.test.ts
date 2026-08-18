import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthRequiredError, NOT_CONNECTED_MESSAGE, TokenStore } from "./auth.js";
import { writeCredentials } from "./credentials.js";
import { AudienceClient } from "./client.js";
import type { AudienceConfig } from "./types.js";

const BASE = "https://api-audience.yandex.ru";

type Call = {
  url: string;
  method: string;
  auth: unknown;
  contentType: unknown;
  body: unknown;
  rawBody: unknown;
};

/** Installs a recording fetch stub and returns a client + the captured calls. */
function harness(extra: Partial<AudienceConfig> = {}) {
  const calls: Call[] = [];
  const config: AudienceConfig = {
    token: "TKN",
    apiHost: BASE,
    maxRetries: 0,
    ...extra,
  };

  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as { method: string; headers: Record<string, string>; body?: unknown };
    calls.push({
      url: String(url),
      method: i.method,
      auth: i.headers.Authorization,
      contentType: i.headers["Content-Type"],
      body: typeof i.body === "string" ? JSON.parse(i.body) : undefined,
      rawBody: i.body,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  return { client: new AudienceClient(config), calls, restore: () => { globalThis.fetch = orig; } };
}

// --- Segments ---

test("listSegments: GET /v1/management/segments with OAuth header and query params", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.listSegments({ limit: 50, offset: 10, pixel: 7 });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments?limit=50&offset=10&pixel=7`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].auth, "OAuth TKN");
  assert.equal(calls[0].rawBody, undefined);
});

test("listSegments without params sends no query string and no body", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.listSegments();
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments`);
  assert.equal(calls[0].rawBody, undefined);
});

test("confirmSegment: POST /segment/{id}/confirm with check_size query and compacted body", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.confirmSegment({
      segment_id: 77,
      name: "CRM клиенты",
      content_type: "crm",
      hashed: true,
      hashing_alg: "SHA256",
      check_size: false,
    });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segment/77/confirm?check_size=false`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].contentType, "application/json");
  assert.deepEqual(calls[0].body, {
    segment: { id: 77, name: "CRM клиенты", content_type: "crm", hashed: true, hashing_alg: "SHA256" },
  });
});

test("renameSegment: PUT /segment/{id} with {segment:{name}}", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.renameSegment(42, "Новое имя");
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segment/42`);
  assert.equal(calls[0].method, "PUT");
  assert.deepEqual(calls[0].body, { segment: { name: "Новое имя" } });
});

test("deleteSegment: DELETE /segment/{id} without a body", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.deleteSegment(42);
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segment/42`);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].rawBody, undefined);
});

test("createLookalikeSegment posts the compacted segment body", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.createLookalikeSegment({
      name: "LAL",
      lookalike_link: 100,
      lookalike_value: 2,
      maintain_geo_distribution: false,
    });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments/create_lookalike`);
  assert.deepEqual(calls[0].body, {
    segment: { name: "LAL", lookalike_link: 100, lookalike_value: 2, maintain_geo_distribution: false },
  });
});

test("createPixelSegment posts the compacted segment body", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.createPixelSegment({
      name: "Видевшие баннер",
      pixel_id: 5,
      period_length: 30,
      times_quantity: 3,
      times_quantity_operation: "gt",
      utm_campaign: "spring",
    });
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments/create_pixel`);
  assert.deepEqual(calls[0].body, {
    segment: {
      name: "Видевшие баннер",
      pixel_id: 5,
      period_length: 30,
      times_quantity: 3,
      times_quantity_operation: "gt",
      utm_campaign: "spring",
    },
  });
});

test("uploadSegmentCsvFile sends multipart form-data with the file and no explicit Content-Type", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.uploadSegmentCsvFile("crm.csv", new TextEncoder().encode("email\na@b.c"));
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments/upload_csv_file`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].auth, "OAuth TKN");
  // fetch must set the multipart boundary itself.
  assert.equal(calls[0].contentType, undefined);
  const form = calls[0].rawBody as FormData;
  assert.ok(form instanceof FormData, "body must be FormData");
  const file = form.get("file") as File;
  assert.equal(file.name, "crm.csv");
  assert.equal(await file.text(), "email\na@b.c");
});

test("uploadSegmentFile targets upload_file", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.uploadSegmentFile("ids.tsv", new TextEncoder().encode("aaa\nbbb"));
  } finally {
    restore();
  }
  assert.equal(calls[0].url, `${BASE}/v1/management/segments/upload_file`);
});

// --- Pixels ---

test("pixel methods hit the documented paths with the documented bodies", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.listPixels();
    await client.createPixel("Мой пиксель");
    await client.updatePixel(9, "Переименован");
    await client.deletePixel(9);
  } finally {
    restore();
  }
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", `${BASE}/v1/management/pixels`],
      ["POST", `${BASE}/v1/management/pixels`],
      ["PUT", `${BASE}/v1/management/pixel/9`],
      ["DELETE", `${BASE}/v1/management/pixel/9`],
    ],
  );
  assert.deepEqual(calls[1].body, { pixel: { name: "Мой пиксель" } });
  assert.deepEqual(calls[2].body, { pixel: { name: "Переименован" } });
});

// --- Grants ---

test("grant methods: list, add (PUT {grant}), delete with user_login query", async () => {
  const { client, calls, restore } = harness();
  try {
    await client.listSegmentGrants(3);
    await client.addSegmentGrant({ segment_id: 3, user_login: "agency-login", permission: "view" });
    await client.deleteSegmentGrant(3, "agency-login");
  } finally {
    restore();
  }
  assert.deepEqual(
    calls.map((c) => [c.method, c.url]),
    [
      ["GET", `${BASE}/v1/management/segment/3/grants`],
      ["PUT", `${BASE}/v1/management/segment/3/grant`],
      ["DELETE", `${BASE}/v1/management/segment/3/grant?user_login=agency-login`],
    ],
  );
  // comment is optional and absent — compact() must have dropped it.
  assert.deepEqual(calls[1].body, { grant: { user_login: "agency-login", permission: "view" } });
});

test("non-2xx throws AudienceError with the Audience error format", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        errors: [{ error_type: "missing_parameter", message: "name is required", location: "name" }],
        code: 400,
        message: "Bad Request",
      }),
      { status: 400 },
    )) as typeof fetch;
  const client = new AudienceClient({ token: "bad", apiHost: BASE, maxRetries: 0 });
  try {
    await assert.rejects(
      () => client.createPixel(""),
      /HTTP 400: Bad Request; \[missing_parameter\] name is required/,
    );
  } finally {
    globalThis.fetch = orig;
  }
});

// --- Retry / timeout / SSRF behavior ---

function makeClient(overrides: Partial<AudienceConfig> = {}) {
  return new AudienceClient({
    token: "T",
    apiHost: BASE,
    retryBaseMs: 0, // no real backoff delay in tests
    ...overrides,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: String(url), init: i });
    return handler(String(url), i);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("a 429 is retried for any method, including POST (write)", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("quota", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().createPixel("p");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("a 5xx is retried for GET (read is safe to repeat)", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().listPixels();
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("a 5xx is NOT retried for POST — a committed write must not be duplicated", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("bad gateway", { status: 502 });
  });
  try {
    await assert.rejects(() => makeClient().createPixel("p"), /HTTP 502/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }
});

test("a network error is retried for GET but rethrown immediately for POST", async () => {
  let getCalls = 0;
  const mockGet = mockFetch(() => {
    getCalls++;
    if (getCalls === 1) throw new Error("ECONNRESET");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().listSegments();
    assert.deepEqual(result, { ok: true });
    assert.equal(getCalls, 2);
  } finally {
    mockGet.restore();
  }

  let postCalls = 0;
  const mockPost = mockFetch(() => {
    postCalls++;
    throw new Error("ECONNRESET");
  });
  try {
    await assert.rejects(() => makeClient().createPixel("p"), /ECONNRESET/);
    assert.equal(postCalls, 1);
  } finally {
    mockPost.restore();
  }
});

test("a 400 is not retried, and a persistent 429 gives up after maxRetries", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("nope", { status: 400 });
  });
  try {
    await assert.rejects(() => makeClient().listSegments(), /HTTP 400/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }

  calls = 0;
  const mock2 = mockFetch(() => {
    calls++;
    return new Response("slow down", { status: 429 });
  });
  try {
    await assert.rejects(() => makeClient({ maxRetries: 2 }).listSegments(), /HTTP 429/);
    assert.equal(calls, 3); // initial + 2 retries
  } finally {
    mock2.restore();
  }
});

test("request() aborts and reports a timeout when the request hangs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init: unknown) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    const client = makeClient({ timeoutMs: 10, maxRetries: 0 });
    await assert.rejects(() => client.createPixel("p"), /timed out after 10ms/);
  } finally {
    globalThis.fetch = original;
  }
});

test("request() rejects an absolute path (SSRF) and never fetches a foreign origin", async () => {
  for (const evil of ["https://evil.example/steal", "http://evil.example/x", "\\\\evil.example/x"]) {
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      await assert.rejects(() => makeClient().request("GET", evil), /foreign origin/);
      assert.equal(mock.calls.length, 0, `must not fetch for ${JSON.stringify(evil)}`);
    } finally {
      mock.restore();
    }
  }
});

test("upload() is covered by the SSRF guard too", async () => {
  const mock = mockFetch(() => new Response("{}", { status: 200 }));
  try {
    await assert.rejects(
      () => makeClient().upload("https://evil.example/steal", "a.csv", new Uint8Array()),
      /foreign origin/,
    );
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("request() still accepts a relative API path (with an inline query string)", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    const result = await makeClient().request("GET", "v1/management/segments?limit=5");
    assert.deepEqual(result, { ok: true });
    assert.equal(mock.calls[0].url, `${BASE}/v1/management/segments?limit=5`);
  } finally {
    mock.restore();
  }
});

// --- Missing credentials (no env token, nothing stored) ---

/**
 * Runs `fn` with XDG_CONFIG_HOME pointed at a fresh temp dir, so "no token"
 * tests never read the developer's real credentials.json (which would make
 * them pass or fail depending on whose machine runs them).
 */
async function withTempConfig<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-audience-client-"));
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

/** Asserts the rejection is an AuthRequiredError carrying the pinned text verbatim. */
function isAuthRequiredError(err: unknown): boolean {
  assert.ok(err instanceof AuthRequiredError, "must be an AuthRequiredError");
  assert.equal((err as Error).name, "AuthRequiredError");
  // The exact literal is pinned in auth.test.ts; here it is enough that the
  // client surfaces that same message, with both fixes named.
  assert.equal((err as Error).message, NOT_CONNECTED_MESSAGE);
  return true;
}

test("request() without a token fails immediately — no retries, no backoff, no request", async () => {
  await withTempConfig(async () => {
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      // maxRetries is deliberately high: if the auth error were treated as a
      // transport failure this would sit in backoff for seconds before answering.
      const client = new AudienceClient({ apiHost: BASE, maxRetries: 5, retryBaseMs: 1000 });
      const started = Date.now();
      await assert.rejects(() => client.listSegments(), isAuthRequiredError);
      assert.ok(Date.now() - started < 500, "the answer must be immediate, not backed off");
      assert.equal(mock.calls.length, 0, "fetch must not be called without credentials");
    } finally {
      mock.restore();
    }
  });
});

test("upload() without a token throws AuthRequiredError too; fetch is never called", async () => {
  await withTempConfig(async () => {
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      const client = new AudienceClient({ apiHost: BASE, maxRetries: 0 });
      await assert.rejects(
        () => client.uploadSegmentFile("ids.tsv", new Uint8Array([1])),
        isAuthRequiredError,
      );
      assert.equal(mock.calls.length, 0, "fetch must not be called without credentials");
    } finally {
      mock.restore();
    }
  });
});

test("an empty-string token counts as missing, not as an empty credential", async () => {
  await withTempConfig(async () => {
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      const client = new AudienceClient({ token: "", apiHost: BASE, maxRetries: 0 });
      await assert.rejects(() => client.listPixels(), isAuthRequiredError);
      assert.equal(mock.calls.length, 0, "fetch must not be called without credentials");
    } finally {
      mock.restore();
    }
  });
});

// --- In-chat login: per-request token resolution ---

test("a token stored mid-session is picked up by the very next call — no restart", async () => {
  await withTempConfig(async () => {
    const mock = mockFetch(() => new Response(JSON.stringify({ segments: [] }), { status: 200 }));
    try {
      const client = new AudienceClient({ apiHost: BASE, maxRetries: 0 });
      // Before the login: not connected, nothing fetched.
      await assert.rejects(() => client.listSegments(), AuthRequiredError);
      assert.equal(mock.calls.length, 0);

      // What finish_login does: write the credentials file. Same process, same client.
      new TokenStore(undefined).save({ access_token: "fresh-token" });

      // The next call must succeed with the new token: it is resolved per
      // request, never cached on the client instance.
      await client.listSegments();
      assert.equal(mock.calls.length, 1);
      assert.equal(
        (mock.calls[0].init.headers as Record<string, string>).Authorization,
        "OAuth fresh-token",
      );
    } finally {
      mock.restore();
    }
  });
});

test("an env token beats the stored one", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "stored", obtained_at: Date.now() });
    const mock = mockFetch(() => new Response("{}", { status: 200 }));
    try {
      await new AudienceClient({ token: "from-env", apiHost: BASE, maxRetries: 0 }).listPixels();
      assert.equal(
        (mock.calls[0].init.headers as Record<string, string>).Authorization,
        "OAuth from-env",
      );
    } finally {
      mock.restore();
    }
  });
});

test("a 401 on a stored token triggers one silent refresh and a replay", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "revoked", refresh_token: "rt", obtained_at: Date.now() });
    const seen: string[] = [];
    const mock = mockFetch((url, init) => {
      if (url.startsWith("https://oauth.yandex.ru/token")) {
        return new Response(
          JSON.stringify({ access_token: "re-minted", refresh_token: "rt2", expires_in: 3600 }),
          { status: 200 },
        );
      }
      seen.push((init.headers as Record<string, string>).Authorization);
      if (seen.length === 1) return new Response("dead token", { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    try {
      // No env token: the client must be running on the stored credentials.
      const client = new AudienceClient({ apiHost: BASE, retryBaseMs: 0, maxRetries: 0 });
      const result = await client.listSegments();
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(seen, ["OAuth revoked", "OAuth re-minted"], "one replay with the fresh token");
    } finally {
      mock.restore();
    }
  });
});

test("a plain 403 (permissions, not a dead token) is NOT retried with a refresh", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "t", refresh_token: "rt", obtained_at: Date.now() });
    const mock = mockFetch(() =>
      new Response(JSON.stringify({ errors: [{ error_type: "access_denied" }] }), { status: 403 }),
    );
    try {
      const client = new AudienceClient({ apiHost: BASE, retryBaseMs: 0, maxRetries: 0 });
      await assert.rejects(() => client.listSegments(), /HTTP 403/);
      assert.equal(mock.calls.length, 1, "re-minting cannot fix a permission problem");
    } finally {
      mock.restore();
    }
  });
});
