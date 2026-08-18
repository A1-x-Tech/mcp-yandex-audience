import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAuthTools } from "./auth.js";
import { registerSegmentTools } from "./segments.js";
import { registerPixelTools } from "./pixels.js";
import { registerGrantTools } from "./grants.js";
import { registerRawTool } from "./raw.js";

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Registers every tool against a fake server, capturing each tool's annotations. */
function collectAnnotations(): Record<string, Annotations | undefined> {
  const annotations: Record<string, Annotations | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Annotations }) => {
      annotations[name] = cfg.annotations;
    },
  };
  // Registration reads the client/store only inside handlers, so stubs are fine here.
  registerAuthTools(server as never, {} as never, {} as never);
  registerSegmentTools(server as never, {} as never);
  registerPixelTools(server as never, {} as never);
  registerGrantTools(server as never, {} as never);
  registerRawTool(server as never, {} as never);
  return annotations;
}

const ANN = collectAnnotations();

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
const RAW = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/**
 * The Audience API is a write API, so the tool → hints map is pinned
 * explicitly: GETs are read-only, POSTs/uploads create, PUTs update
 * idempotently, DELETEs are destructive, and raw_request assumes the worst.
 */
const EXPECTED: Record<string, Annotations> = {
  // The in-chat login, mirroring the Metrica sibling's choices: the two steps
  // that only read or mint local state are read-only (start_login mutates
  // nothing outside this process), finish_login writes the credentials file
  // idempotently (same code → same stored token), logout deletes it.
  auth_status: READ_ONLY,
  start_login: READ_ONLY,
  finish_login: WRITE_IDEMPOTENT,
  logout: DESTRUCTIVE,

  list_segments: READ_ONLY,
  list_pixels: READ_ONLY,
  list_segment_grants: READ_ONLY,

  upload_segment_file: WRITE,
  upload_segment_csv_file: WRITE,
  confirm_segment: WRITE,
  create_lookalike_segment: WRITE,
  create_pixel_segment: WRITE,
  create_pixel: WRITE,

  rename_segment: WRITE_IDEMPOTENT,
  update_pixel: WRITE_IDEMPOTENT,
  add_segment_grant: WRITE_IDEMPOTENT,

  delete_segment: DESTRUCTIVE,
  delete_pixel: DESTRUCTIVE,
  delete_segment_grant: DESTRUCTIVE,

  raw_request: RAW,
};

test("registers all twenty tools with annotations", () => {
  assert.deepEqual(Object.keys(ANN).sort(), Object.keys(EXPECTED).sort());
  for (const [name, a] of Object.entries(ANN)) {
    assert.ok(a, `${name} is missing annotations`);
  }
});

test("every tool carries exactly its expected hints (all four set)", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(ANN[name], expected, `${name} annotations mismatch`);
  }
});
