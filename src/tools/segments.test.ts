import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSegmentTools } from "./segments.js";

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
    listSegments: make("listSegments"),
    uploadSegmentFile: make("uploadSegmentFile"),
    uploadSegmentCsvFile: make("uploadSegmentCsvFile"),
    confirmSegment: make("confirmSegment"),
    renameSegment: make("renameSegment"),
    deleteSegment: make("deleteSegment"),
    createLookalikeSegment: make("createLookalikeSegment"),
    createPixelSegment: make("createPixelSegment"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerSegmentTools(server as never, client as never);
  return { calls, tools };
}

test("registers the eight segment tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), [
    "confirm_segment",
    "create_lookalike_segment",
    "create_pixel_segment",
    "delete_segment",
    "list_segments",
    "rename_segment",
    "upload_segment_csv_file",
    "upload_segment_file",
  ]);
});

test("list_segments forwards limit/offset/pixel to client.listSegments", async () => {
  const { calls, tools } = harness();
  await tools.list_segments({ limit: 100, offset: 5, pixel: 2 });
  assert.equal(calls[0].method, "listSegments");
  assert.deepEqual(calls[0].args, [{ limit: 100, offset: 5, pixel: 2 }]);
});

test("confirm_segment forwards the full normalized param set", async () => {
  const { calls, tools } = harness();
  await tools.confirm_segment({
    segment_id: 7,
    name: "CRM",
    content_type: "crm",
    hashed: false,
    check_size: false,
  });
  assert.equal(calls[0].method, "confirmSegment");
  assert.deepEqual(calls[0].args, [
    {
      segment_id: 7,
      name: "CRM",
      content_type: "crm",
      hashed: false,
      hashing_alg: undefined,
      device_matching_type: undefined,
      check_size: false,
    },
  ]);
});

test("rename_segment and delete_segment forward positional args", async () => {
  const { calls, tools } = harness();
  await tools.rename_segment({ segment_id: 8, name: "Новое" });
  await tools.delete_segment({ segment_id: 9 });
  assert.deepEqual(calls[0], { method: "renameSegment", args: [8, "Новое"] });
  assert.deepEqual(calls[1], { method: "deleteSegment", args: [9] });
});

test("create_lookalike_segment and create_pixel_segment forward their params", async () => {
  const { calls, tools } = harness();
  await tools.create_lookalike_segment({ name: "LAL", lookalike_link: 1, lookalike_value: 3 });
  await tools.create_pixel_segment({ name: "P", pixel_id: 4, period_length: 7, utm_source: "yandex" });
  assert.equal(calls[0].method, "createLookalikeSegment");
  assert.deepEqual(calls[0].args, [
    {
      name: "LAL",
      lookalike_link: 1,
      lookalike_value: 3,
      maintain_device_distribution: undefined,
      maintain_geo_distribution: undefined,
    },
  ]);
  assert.equal(calls[1].method, "createPixelSegment");
  assert.deepEqual(calls[1].args, [
    {
      name: "P",
      pixel_id: 4,
      period_length: 7,
      times_quantity: undefined,
      times_quantity_operation: undefined,
      utm_source: "yandex",
      utm_medium: undefined,
      utm_campaign: undefined,
      utm_content: undefined,
      utm_term: undefined,
      device_matching_type: undefined,
    },
  ]);
});

test("upload tools: inline content becomes bytes with the default file name", async () => {
  const { calls, tools } = harness();
  await tools.upload_segment_file({ content: "id1\nid2" });
  await tools.upload_segment_csv_file({ content: "email\na@b.c" });

  assert.equal(calls[0].method, "uploadSegmentFile");
  assert.equal(calls[0].args[0], "segment.tsv");
  assert.equal(new TextDecoder().decode(calls[0].args[1] as Uint8Array), "id1\nid2");

  assert.equal(calls[1].method, "uploadSegmentCsvFile");
  assert.equal(calls[1].args[0], "segment.csv");
  assert.equal(new TextDecoder().decode(calls[1].args[1] as Uint8Array), "email\na@b.c");
});

test("upload tools: file_path reads the local file and uses its basename", async () => {
  const dir = mkdtempSync(join(tmpdir(), "audience-upload-"));
  const path = join(dir, "clients.csv");
  writeFileSync(path, "email\nx@y.z");

  const { calls, tools } = harness();
  const res = await tools.upload_segment_csv_file({ file_path: path });
  assert.equal(res.isError, undefined);
  assert.equal(calls[0].args[0], "clients.csv");
  assert.equal(new TextDecoder().decode(calls[0].args[1] as Uint8Array), "email\nx@y.z");
});

test("upload tools: both or neither source is an isError result, client not called", async () => {
  const { calls, tools } = harness();
  const both = await tools.upload_segment_file({ file_path: "/tmp/a.tsv", content: "x" });
  assert.equal(both.isError, true);
  assert.match(both.content[0].text, /ровно один источник/);

  const neither = await tools.upload_segment_csv_file({});
  assert.equal(neither.isError, true);

  assert.equal(calls.length, 0);
});

test("a missing local file is an isError result, not a crash", async () => {
  const { tools } = harness();
  const res = await tools.upload_segment_file({ file_path: "/definitely/not/there.tsv" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /ENOENT|no such file/i);
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "deleteSegment" });
  const res = await tools.delete_segment({ segment_id: 1 });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
