# CLAUDE.md — mcp-yandex-audience

MCP server for the Yandex Audience API (TypeScript, stdio). **Write-capable**:
tools wrap segment management (file/CRM uploads with two-phase confirm,
lookalike, pixel-based), pixels and access grants; `raw_request` is the escape
hatch. The server talks to the **Yandex Audience Management API**
(`api-audience.yandex.ru`, `/v1/management/*`); auth is a Yandex OAuth token
sent as `Authorization: OAuth <token>` on every request.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests + dist smoke (incl. real stdio MCP handshake), no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY call (needs YANDEX_AUDIENCE_TOKEN)
```

## Architecture

- `src/config.ts` — env → config. A missing `YANDEX_AUDIENCE_TOKEN` is NOT an error: the
  field stays `undefined`, the server starts degraded and the client raises
  `CredentialsError` (types.ts) at call time. `ConfigError` (with a `reason` code) is
  reserved for malformed values, caught by `loadConfigOrDegraded` in `index.ts` (no such
  checks exist today). Optional `YANDEX_AUDIENCE_API_HOST` (default
  `https://api-audience.yandex.ru`), `YANDEX_AUDIENCE_TIMEOUT_MS`, `YANDEX_AUDIENCE_MAX_RETRIES`.
- `src/client.ts` — one typed method per endpoint (`listSegments`, `confirmSegment`,
  `createLookalikeSegment`, `createPixel`, `addSegmentGrant`, …): OAuth header, path/query/body
  assembly (`{segment: …}` / `{pixel: …}` / `{grant: …}` envelopes, `compact()` drops undefined),
  `upload()` for multipart file uploads (no explicit Content-Type — fetch sets the boundary).
  A missing token is rejected with `CredentialsError` while the auth header is built — before
  the request, the retries and fetch; the message is the product: it preserves the historical
  startup text and says to set the variable and restart.
  `request()` resolves the path against the base and rejects any path that escapes to a foreign
  origin (SSRF guard), enforces an AbortController timeout that also covers reading the body,
  and throws `AudienceError(status, body)` parsing the API's
  `{errors: [{error_type, message, location}], code, message}` format.
  **Retries: 429 for any method; 5xx/network only for GET** — repeating a committed write
  would duplicate it.
- `src/tools/segments.ts` — `list_segments`, `upload_segment_file`, `upload_segment_csv_file`,
  `confirm_segment`, `rename_segment`, `delete_segment`, `create_lookalike_segment`,
  `create_pixel_segment`. Upload tools accept `file_path` XOR `content` (checked in the
  handler — cross-field rules can't live in a plain-object inputSchema).
  `src/tools/pixels.ts` — `list_pixels`, `create_pixel`, `update_pixel`, `delete_pixel`.
  `src/tools/grants.ts` — `list_segment_grants`, `add_segment_grant`, `delete_segment_grant`.
  `src/tools/raw.ts` — `raw_request` (GET/POST/PUT/DELETE, defaults to GET).
  `src/tools/util.ts` — `ok`/`fail`, the annotation constants
  (`READ_ONLY`/`WRITE`/`WRITE_IDEMPOTENT`/`DESTRUCTIVE`/`RAW`) and shared zod field factories.
- `src/index.ts` — wires every `register*` into the McpServer. `loadConfigOrDegraded` starts
  the server even on a config problem; without a token the initialize `instructions` open
  with the unconfigured prefix (set `YANDEX_AUDIENCE_TOKEN` and restart).
- `src/telemetry.ts` — anonymous usage pings (ids/names/versions only, never data or
  arguments; fire-and-forget, must never block or throw; opt-out `ASKADS_TELEMETRY=0`).
  `server_start` means "a usable install started"; an install without a token sends
  `unconfigured_start` instead. The `reason` is a closed vocabulary (`missing_token`) —
  never a variable's name or value. `startup_failed` remains for a config unusable at
  load time (malformed values; no such checks exist today), also fire-and-forget.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a dead server and no reason — the sibling Metrica server's telemetry showed
  that state accounted for nearly every unconfigured install. A missing token is a survivable
  state: start, answer `initialize`/`tools/list` (with the unconfigured prefix in the
  instructions), and reject tool calls with `CredentialsError`. There are no login tools:
  the token comes only from the environment, so the fix is the operator setting
  `YANDEX_AUDIENCE_TOKEN` and restarting the server. `config.test.ts`, `client.test.ts` and
  `test/dist-smoke.test.js` pin this.
- **Credential failures are not transport failures.** `CredentialsError` is thrown while the
  auth header is built (in `headers()`, before `send()`'s retry/backoff loop and before
  fetch) — retrying it burns seconds of backoff before the user sees the one message that
  helps. Pinned by "fetch must not be called" assertions in `client.test.ts`.
- **This is a write API — annotate deliberately.** Every tool carries one of the five
  annotation constants; `annotations.test.ts` pins the full tool → hints map. New GETs are
  `READ_ONLY`, POSTs/uploads `WRITE`, PUTs `WRITE_IDEMPOTENT`, DELETEs `DESTRUCTIVE`.
- **Never retry a non-GET on 5xx/network.** Only 429 is safe for writes (the request was
  throttled before the handler ran). The `idempotent` flag in `client.send()` is the gate.
- **HTTP mechanics live in the client, not the tools.** Tools pass validated fields; the
  client owns paths, query strings, the `{segment|pixel|grant}` body envelopes and `compact()`.
  Tool/wire field names are the API's snake_case on purpose — responses and Yandex docs
  line up 1:1 for the consuming LLM.
- **Validate inputs with zod** in `inputSchema` (plain object of fields, not `z.object()`).
  Use the shared schema **factories** in `util.ts` (a fresh schema per field avoids `$ref`
  dedup in the JSON schema). `hashing_alg` accepts only `SHA256` — the API schema still
  lists MD5, but the API rejects it since 2025-01-01.
- **Output compact JSON via `ok`** — the consumer is an LLM; pretty-printing burns tokens.
  Responses pass through verbatim (describe the fields in the tool `description`, the only
  place the external model reads). Tool descriptions are in Russian — the audience is
  RU-speaking advertisers; keep it that way.
- **Two-phase uploads.** upload_* returns an `uploaded` segment; it is not real until
  `confirm_segment`. Don't collapse the phases into one tool — confirm needs user-visible
  choices (name, content_type, hashing).
- **There is no single-segment GET** in the API — after a mutation, read state from the
  mutation response or `list_segments`.

## Adding a tool

Before changing the tool registry, read [the MCP capability documentation contract](docs/CAPABILITY-DOCUMENTATION.md). Every registered tool must have exactly one task-oriented page in `docs/capabilities/`; update that page, the index, and the coverage test in the same change.

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. If it hits a new endpoint, add a typed method to `src/client.ts`.
3. Import and call the register fn in `src/index.ts`.
4. Pick the annotation constant deliberately and extend the pinned map in
   `annotations.test.ts` plus the tool list in `test/dist-smoke.test.js`.
5. Add a `*.test.ts` using the mock-fetch (client) / fake-client (tools) harness — no network.
6. `npm run typecheck && npm test`.

## Releasing

Keep the version in sync across **all** channels in one go — publishing to npm alone silently
drifts from the rest (`git push --follow-tags` pushes the tag but does **not** create a GitHub
Release; the registry is immutable per version, so even a metadata-only change needs a bump):

1. Bump `version` in **three places, identically**: `package.json`, and in `server.json`
   **both** the root `version` **and** `packages[0].version`. `mcpName` in `package.json` must
   match `name` in `server.json` (`io.github.A1-x-Tech/mcp-yandex-audience`). Verify before
   publishing — all three must print the same X.Y.Z:
   `grep -n '"version"' package.json server.json`.
   > ⚠️ `mcp-publisher` publishes the **root** `server.json.version`. If you bump npm +
   > `packages[0].version` but leave the root stale, `npm publish` still succeeds (it reads
   > `package.json`), yet `mcp-publisher publish` fails with a misleading
   > `400 cannot publish duplicate version` — it is re-publishing the old root version.
2. `npm publish` (runs typecheck + tests + build via `prepublishOnly` / `prepare`).
3. `git commit`, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push origin main --follow-tags`.
4. **GitHub Release:** `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`.
5. **Official MCP registry:** `mcp-publisher publish` (login with
   `mcp-publisher login github --token "$(gh auth token)"` — device-flow can't see the org).
