import { test } from "node:test";
import assert from "node:assert/strict";
import { DESTRUCTIVE, fail, ok, RAW, READ_ONLY, segmentIdField, WRITE, WRITE_IDEMPOTENT } from "./util.js";

test("field factories return independent schemas (no $ref dedup)", () => {
  assert.notEqual(segmentIdField(), segmentIdField());
  assert.equal(segmentIdField().safeParse(42).success, true);
  assert.equal(segmentIdField().safeParse(0).success, false);
  assert.equal(segmentIdField().safeParse("42").success, false);
});

test("ok emits compact JSON; fail flags isError", () => {
  assert.equal((ok({ a: 1 }).content[0] as { text: string }).text, '{"a":1}');
  const f = fail(new Error("boom"));
  assert.equal(f.isError, true);
  assert.match((f.content[0] as { text: string }).text, /boom/);
});

test("fail appends the underlying cause when present", () => {
  const err = new Error("timeout", { cause: new Error("ECONNRESET") });
  const f = fail(err);
  assert.match((f.content[0] as { text: string }).text, /timeout \(ECONNRESET\)/);
});

test("annotation constants set all four hints each, with the intended values", () => {
  assert.deepEqual(READ_ONLY, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(WRITE, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  assert.deepEqual(WRITE_IDEMPOTENT, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(DESTRUCTIVE, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(RAW, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});
