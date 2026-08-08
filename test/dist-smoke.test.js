import assert from "node:assert/strict";
import test from "node:test";

import { AudienceClient } from "../dist/client.js";
import { registerSegmentTools } from "../dist/tools/segments.js";
import { registerPixelTools } from "../dist/tools/pixels.js";
import { registerGrantTools } from "../dist/tools/grants.js";
import { registerRawTool } from "../dist/tools/raw.js";

const ALL_TOOLS = [
  "add_segment_grant",
  "confirm_segment",
  "create_lookalike_segment",
  "create_pixel",
  "create_pixel_segment",
  "delete_pixel",
  "delete_segment",
  "delete_segment_grant",
  "list_pixels",
  "list_segment_grants",
  "list_segments",
  "raw_request",
  "rename_segment",
  "update_pixel",
  "upload_segment_csv_file",
  "upload_segment_file",
];

test("dist client rejects foreign-origin paths before sending the OAuth token", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const client = new AudienceClient({
    token: "SECRET",
    apiHost: "https://api-audience.yandex.ru",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  await assert.rejects(() => client.request("GET", "https://example.invalid/steal"), /foreign origin/);
  assert.equal(called, false);
});

test("dist client sends the OAuth Authorization header on every request", async () => {
  let auth;
  globalThis.fetch = async (_url, init) => {
    auth = init.headers.Authorization;
    return new Response('{"segments":[]}', { status: 200 });
  };

  const client = new AudienceClient({
    token: "SECRET",
    apiHost: "https://api-audience.yandex.ru",
    timeoutMs: 1000,
    maxRetries: 0,
  });

  await client.listSegments({ limit: 1 });
  assert.equal(auth, "OAuth SECRET");
});

test("dist registers the expected tools", () => {
  const names = [];
  const server = {
    registerTool(name) {
      names.push(name);
    },
  };
  const client = {};

  registerSegmentTools(server, client);
  registerPixelTools(server, client);
  registerGrantTools(server, client);
  registerRawTool(server, client);

  assert.deepEqual(names.sort(), ALL_TOOLS);
});

test("dist server completes a real MCP handshake over stdio and lists every tool", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    env: {
      ...process.env,
      YANDEX_AUDIENCE_TOKEN: "test-token",
      ASKADS_TELEMETRY: "0",
    },
  });
  const client = new Client({ name: "dist-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);
  } finally {
    await client.close();
  }
});
