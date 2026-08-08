import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Shared zod field FACTORIES (not shared consts): reusing one zod object across
 * two fields of the same inputSchema makes zod-to-json-schema dedupe them into a
 * `$ref`, which some tool-schema consumers (OpenAI Apps review) don't dereference
 * and flag as `any`. A fresh object per field keeps each one inlined.
 */
export const segmentIdField = () =>
  z.number().int().positive().describe("Идентификатор сегмента (id из list_segments или из ответа создания).");

export const pixelIdField = () =>
  z.number().int().positive().describe("Идентификатор пикселя (id из list_pixels).");

/** Wraps a value as a compact-JSON tool result (compact: the consumer is an LLM). */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: text ?? "null" }] };
}

export function fail(err: unknown): CallToolResult {
  let message = err instanceof Error ? err.message : String(err);
  // Surface the underlying cause (e.g. the network error behind a timeout) — no
  // secrets live in cause, and it makes failures far easier to diagnose.
  if (err instanceof Error && err.cause instanceof Error) message += ` (${err.cause.message})`;
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool. The Audience API is a write API, so every tool picks its annotation
 * deliberately; annotations.test.ts pins the tool → hints map.
 */
// All four hints set explicitly: some clients (OpenAI Apps review) require
// readOnlyHint, destructiveHint and openWorldHint on every tool.

/** GET endpoints: never mutate, safe to repeat. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Creating writes (POST, uploads): a repeat creates another object. */
export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** PUT updates: mutate, but repeating with the same args converges. */
export const WRITE_IDEMPOTENT = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** DELETE endpoints: destructive; repeating a delete stays deleted. */
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** raw_request can reach any endpoint, including DELETE — worst case assumed. */
export const RAW = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
