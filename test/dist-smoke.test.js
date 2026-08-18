import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AudienceClient } from "../dist/client.js";
import { registerAuthTools } from "../dist/tools/auth.js";
import { registerSegmentTools } from "../dist/tools/segments.js";
import { registerPixelTools } from "../dist/tools/pixels.js";
import { registerGrantTools } from "../dist/tools/grants.js";
import { registerRawTool } from "../dist/tools/raw.js";

const ALL_TOOLS = [
  "add_segment_grant",
  "auth_status",
  "confirm_segment",
  "create_lookalike_segment",
  "create_pixel",
  "create_pixel_segment",
  "delete_pixel",
  "delete_segment",
  "delete_segment_grant",
  "finish_login",
  "list_pixels",
  "list_segment_grants",
  "list_segments",
  "logout",
  "raw_request",
  "rename_segment",
  "start_login",
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

  registerAuthTools(server, client, {});
  registerSegmentTools(server, client);
  registerPixelTools(server, client);
  registerGrantTools(server, client);
  registerRawTool(server, client);

  assert.deepEqual(names.sort(), ALL_TOOLS);
});

test("dist server completes a real MCP handshake over stdio, lists every tool and hands over instructions", async () => {
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

    // The instructions live in the initialize result, so only a live handshake
    // proves they survived the build. Length floor, not a wording match: it
    // catches an empty or placeholder string without pinning the test to prose.
    const instructions = client.getInstructions();
    assert.equal(typeof instructions, "string");
    assert.ok(instructions.trim().length > 200, "instructions must carry real guidance");
  } finally {
    await client.close();
  }
});

test("dist server without a token still answers initialize, tools/list and a call", async () => {
  // The regression this exists for: with no YANDEX_AUDIENCE_TOKEN the server
  // used to exit(1) before the MCP handshake, so the client showed a dead
  // server and the user never learned why. It must now start, list its tools,
  // open the instructions with the fix (the in-chat login), and answer a tool
  // call with the auth error instead of dropping the connection. No network:
  // the token check rejects the call before fetch. XDG_CONFIG_HOME points at a
  // fresh temp dir so a login stored on the developer's machine cannot make
  // this "unconfigured" server connected.
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const env = {
    ...process.env,
    ASKADS_TELEMETRY: "0",
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "mcp-audience-unconfigured-")),
  };
  delete env.YANDEX_AUDIENCE_TOKEN;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    env,
  });
  const client = new Client({ name: "dist-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ALL_TOOLS,
      "an unconfigured server must still list every tool",
    );

    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /start_login/, "instructions must name the in-chat login");
    assert.match(instructions, /YANDEX_AUDIENCE_TOKEN/, "and the env-var alternative");
    assert.match(instructions, /перезапустить сервер/, "which needs a restart");

    const result = await client.callTool({ name: "list_segments", arguments: {} });
    assert.equal(result.isError, true, "the call must fail, not the connection");
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /start_login/, "the error must name the in-chat fix");
    assert.match(text, /YANDEX_AUDIENCE_TOKEN/, "and the env-var alternative");
    assert.match(text, /не сбой сети/, "and must stop the model from retrying");

    // The login can actually start: a PKCE authorize URL, minted locally.
    const login = await client.callTool({ name: "start_login", arguments: {} });
    assert.notEqual(login.isError, true);
    const payload = JSON.parse(login.content[0]?.text ?? "{}");
    const url = new URL(payload.authorizeUrl ?? "");
    assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    // No redirect in this flow, so the URL carries no `state` — PKCE alone binds
    // the exchange to this process.
    assert.equal(url.searchParams.get("state"), null);
    assert.ok(!url.search.includes("client_secret"), "a public client must not leak a secret");
  } finally {
    await client.close();
  }
});
