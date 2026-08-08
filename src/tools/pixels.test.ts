import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPixelTools } from "./pixels.js";

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
    listPixels: make("listPixels"),
    createPixel: make("createPixel"),
    updatePixel: make("updatePixel"),
    deletePixel: make("deletePixel"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerPixelTools(server as never, client as never);
  return { calls, tools };
}

test("registers the four pixel tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), [
    "create_pixel",
    "delete_pixel",
    "list_pixels",
    "update_pixel",
  ]);
});

test("pixel tools forward their params to the client", async () => {
  const { calls, tools } = harness();
  await tools.list_pixels({});
  await tools.create_pixel({ name: "Баннер осень" });
  await tools.update_pixel({ pixel_id: 5, name: "Баннер зима" });
  await tools.delete_pixel({ pixel_id: 5 });
  assert.deepEqual(calls, [
    { method: "listPixels", args: [] },
    { method: "createPixel", args: ["Баннер осень"] },
    { method: "updatePixel", args: [5, "Баннер зима"] },
    { method: "deletePixel", args: [5] },
  ]);
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "createPixel" });
  const res = await tools.create_pixel({ name: "x" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
