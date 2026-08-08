import { test } from "node:test";
import assert from "node:assert/strict";
import { AudienceClient } from "../client.js";
import { registerRawTool } from "./raw.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Registers raw_request against a real client with a recording fetch stub. */
function harness() {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as { method: string; body?: string };
    calls.push({ url: String(url), method: i.method, body: i.body ? JSON.parse(i.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const client = new AudienceClient({
    token: "TKN",
    apiHost: "https://api-audience.yandex.ru",
    maxRetries: 0,
  });
  const tools: Record<string, Handler> = {};
  const server = { registerTool: (name: string, _cfg: unknown, h: Handler) => { tools[name] = h; } };
  registerRawTool(server as never, client);
  return { tools, calls, restore: () => { globalThis.fetch = original; } };
}

test("raw_request defaults to GET and keeps an inline query string", async () => {
  const { tools, calls, restore } = harness();
  try {
    const res = await tools.raw_request({ path: "v1/management/segments?limit=5" });
    assert.equal(res.isError, undefined);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url, "https://api-audience.yandex.ru/v1/management/segments?limit=5");
    assert.equal(calls[0].body, undefined);
  } finally {
    restore();
  }
});

test("raw_request sends the body as JSON for POST/PUT", async () => {
  const { tools, calls, restore } = harness();
  try {
    await tools.raw_request({ path: "v1/management/pixels", method: "POST", body: { pixel: { name: "x" } } });
    await tools.raw_request({ path: "v1/management/segment/1/reprocess", method: "PUT", body: {} });
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body, { pixel: { name: "x" } });
    assert.equal(calls[1].method, "PUT");
    assert.deepEqual(calls[1].body, {});
  } finally {
    restore();
  }
});

test("raw_request rejects an absolute path as an isError result, without fetching", async () => {
  for (const evil of ["https://evil.example/steal", "http://evil.example/x", "\\\\evil.example/x"]) {
    const { tools, calls, restore } = harness();
    try {
      const res = await tools.raw_request({ path: evil });
      assert.equal(res.isError, true, `${JSON.stringify(evil)} should be isError`);
      assert.match(res.content[0].text, /foreign origin/);
      assert.equal(calls.length, 0, `must not fetch for ${JSON.stringify(evil)}`);
    } finally {
      restore();
    }
  }
});
