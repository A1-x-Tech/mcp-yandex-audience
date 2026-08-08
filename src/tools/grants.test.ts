import { test } from "node:test";
import assert from "node:assert/strict";
import { registerGrantTools } from "./grants.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake server + fake client so the tool handlers run without network. */
function harness(opts: { throwOn?: string } = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const make =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      if (opts.throwOn === method) throw new Error("boom");
      return { ok: true };
    };
  const client = {
    listSegmentGrants: make("listSegmentGrants"),
    addSegmentGrant: make("addSegmentGrant"),
    deleteSegmentGrant: make("deleteSegmentGrant"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerGrantTools(server as never, client as never);
  return { calls, tools };
}

test("registers the three grant tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), [
    "add_segment_grant",
    "delete_segment_grant",
    "list_segment_grants",
  ]);
});

test("grant tools forward their params to the client", async () => {
  const { calls, tools } = harness();
  await tools.list_segment_grants({ segment_id: 3 });
  await tools.add_segment_grant({ segment_id: 3, user_login: "login", permission: "edit", comment: "агентство" });
  await tools.delete_segment_grant({ segment_id: 3, user_login: "login" });
  assert.deepEqual(calls, [
    { method: "listSegmentGrants", args: [3] },
    { method: "addSegmentGrant", args: [{ segment_id: 3, user_login: "login", permission: "edit", comment: "агентство" }] },
    { method: "deleteSegmentGrant", args: [3, "login"] },
  ]);
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "addSegmentGrant" });
  const res = await tools.add_segment_grant({ segment_id: 1, user_login: "u", permission: "view" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
