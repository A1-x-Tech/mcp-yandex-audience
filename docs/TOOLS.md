# Tools

For task-oriented guidance, open the [MCP capability catalog](./capabilities/index.md). This page remains the technical reference for schemas and API responses.

The Yandex Audience Management API (`api-audience.yandex.ru`, `/v1/management/*`)
is a **write API**: tools create, update and delete segments, pixels and grants.
Auth is a Yandex OAuth token (`Authorization: OAuth <token>`), attached by the
client to every request. Field names match the API's wire vocabulary
(snake_case) so responses and Yandex docs line up 1:1; body/query assembly and
path building live in the client, not the tools.

Every tool carries explicit MCP annotations: GETs are read-only, POSTs/uploads
create, PUTs update idempotently, DELETEs are destructive.

## Connection — OAuth with PKCE

The connection tools (`finish_login`, `logout`) write only to the local disk;
the single Audience API call `finish_login` makes is a read that verifies the
fresh token.

| Tool | Description |
|---|---|
| `auth_status` | Whether a token exists, where it came from (`env` / `stored`), when it expires and where the credentials file lives. Touches no network, never shows the token itself. |
| `start_login` | Step 1 of the in-chat login: returns a Yandex OAuth URL. The user signs in and gets a confirmation code (valid for 10 minutes). |
| `finish_login` | Step 2: exchanges the code for a token, stores it in `~/.config/mcp-yandex-audience/credentials.json` (mode `0600`) and immediately verifies it with a live read. Takes effect without restarting the client. |
| `logout` | Deletes the stored token. Leaves `YANDEX_AUDIENCE_TOKEN` alone and does not revoke the app's access on Yandex's side (that lives in [Yandex ID](https://id.yandex.ru/security)). |

Notes:
- **The secret never leaves the machine.** PKCE: the `code_verifier` stays in the
  process; only the one-shot confirmation code passes through the chat, and it is
  useless without the verifier.
- **Source priority:** `YANDEX_AUDIENCE_TOKEN` beats the stored login. An env
  token is never refreshed or deleted by the server.
- **Renewal is automatic:** the refresh token is stored alongside the access
  token; an expired (or revoked — the API answers 401/403 `invalid_token`)
  access token is re-minted silently.
- **Scope is explicit:** the login asks for `audience:read audience:write` — the
  Audience segment read/write rights and nothing else — with `force_confirm=yes`.

## Segments

| Tool | Description |
|---|---|
| `list_segments` | Segments available to the user, all types (uploading / metrika / appmetrica / lookalike / geo / pixel) with `status`, `create_time` and type-specific fields. Pagination: `limit` (default 10000) + `offset`; `pixel` filters to segments built on that pixel. The API has no single-segment GET — filter this list by id. |
| `upload_segment_file` | Creates a segment from a TSV/TXT file (device ids / MACs / SHA256 hashes, ≥100 records, ≤1 GB). Step 1 of 2 — the response is an `uploaded` segment whose id goes to `confirm_segment`. Source: `file_path` (local file) or `content` (inline string), exactly one. |
| `upload_segment_csv_file` | Same, but for a CSV file with CRM data (header row: `email`, `phone`, `ext_id`/`external_id`, extra columns allowed). Confirm with `content_type: crm`. |
| `confirm_segment` | Step 2 of 2: saves an uploaded segment — `name`, `content_type` (`idfa_gaid` \| `mac` \| `crm`), `hashed` + `hashing_alg` (only `SHA256`; MD5 is rejected by the API since 2025-01-01), `device_matching_type` (`CROSS_DEVICE` default \| `IN_DEVICE`, idfa_gaid only). `check_size=false` allows segments under 100 records. |
| `rename_segment` | Renames a segment of any type (the edit schema only exposes `name`). |
| `delete_segment` | Deletes a segment. Irreversible — there is no undelete for segments. Returns `{"success": true}`. |
| `create_lookalike_segment` | Lookalike segment from a source segment (`lookalike_link`): `lookalike_value` 1 (closest) .. 5 (widest), optional `maintain_device_distribution` / `maintain_geo_distribution` (default true). |
| `create_pixel_segment` | Pixel-based segment: users the pixel saw within `period_length` days (1..90); optional frequency condition (`times_quantity` + `times_quantity_operation`: `lt`/`eq`/`gt`) and UTM filters — all conditions AND-ed. |

## Pixels

| Tool | Description |
|---|---|
| `list_pixels` | All pixels with `url` (embed code), reach counters `user_quantity_7/30/90` and the segments built on each. |
| `create_pixel` | Creates a pixel; the response carries the code/URL to embed into ads. |
| `update_pixel` | Renames a pixel. |
| `delete_pixel` | Deletes a pixel. Returns `{"success": true}`. The API has an undelete (`POST /v1/management/pixel/{id}/undelete`) reachable via `raw_request`. |

## Grants

| Tool | Description |
|---|---|
| `list_segment_grants` | Permissions on a segment: `user_login`, `permission` (`edit`/`view`), `comment`, `created_at`. |
| `add_segment_grant` | Grants a Yandex login `edit` or `view` access to a segment (optional `comment`, ≤255 chars). |
| `delete_segment_grant` | Revokes a user's access to a segment. Returns `{"success": true}`. |

Notes:
- **Two-phase file segments.** `upload_segment_file`/`upload_segment_csv_file` return a
  segment in status `uploaded`; it only becomes real after `confirm_segment`. Processing
  is asynchronous — poll `list_segments` for `processed` / `processing_failed` / `few_data`.
- **Quotas.** 30 req/s per IP; 5000 req/day per login; segment creation/modification
  10/min, 100/hour, 500/day. Failed requests count too; exceeding returns HTTP 429
  (retried with backoff, honoring `Retry-After`).
- **Successful DELETEs return HTTP 200** with `{"success": true}` (not 204).
- **Field-name drift.** Older archived docs called the pixel counters `user_quantity7`;
  the current reference says `user_quantity_7` — don't hard-code either, pass through.

## Escape hatch

| Tool | Description |
|---|---|
| `raw_request` | Call any Audience Management path directly (e.g. `PUT v1/management/segment/{id}/reprocess`, `POST v1/management/pixel/{id}/undelete`, `GET v1/management/accounts`) for endpoints without a dedicated tool. `method` defaults to GET; include query params inline in `path`; `body` is sent as JSON for POST/PUT. A `path` that resolves to a foreign origin is rejected (SSRF guard). |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `YANDEX_AUDIENCE_TOKEN` | no | — | Yandex OAuth token, sent as `Authorization: OAuth …`. Treat it as a secret. Optional since the in-chat login exists; when set it beats the stored login and is never refreshed or deleted by the server. |
| `YANDEX_AUDIENCE_OAUTH_CLIENT_ID` | no | the A1-x-Tech app | ClientID of your own OAuth app for the in-chat login (must use redirect URI `https://oauth.yandex.ru/verification_code`). |
| `YANDEX_AUDIENCE_API_HOST` | no | `https://api-audience.yandex.ru` | API host override (`https://api-audience.yandex.com` for international accounts). |
| `YANDEX_AUDIENCE_TIMEOUT_MS` | no | `60000` | Per-request timeout, ms. |
| `YANDEX_AUDIENCE_MAX_RETRIES` | no | `3` | Retries on 429 (5xx/network retried for GET only — writes must not be duplicated). |
