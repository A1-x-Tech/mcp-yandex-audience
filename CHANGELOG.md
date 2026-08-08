# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

## [0.1.1] — 2026-08-09

### Fixed

- `mcpName` в `package.json`: регистр namespace исправлен на `io.github.A1-x-Tech/*` (реестр MCP сверяет посимвольно с опубликованным npm-пакетом); описание в `server.json` сокращено до ≤100 символов.

## [0.1.0] — 2026-08-09

### Добавлено
- Первый релиз. MCP-сервер для API Яндекс Аудиторий
  (`api-audience.yandex.ru`, OAuth-токен), 16 инструментов:
  - сегменты: `list_segments`, `rename_segment`, `delete_segment`;
  - сегменты из файлов (двухфазно): `upload_segment_file`,
    `upload_segment_csv_file`, `confirm_segment`;
  - lookalike и пиксельные сегменты: `create_lookalike_segment`, `create_pixel_segment`;
  - пиксели: `list_pixels`, `create_pixel`, `update_pixel`, `delete_pixel`;
  - доступы: `list_segment_grants`, `add_segment_grant`, `delete_segment_grant`;
  - `raw_request` — escape hatch на любой путь API (GET/POST/PUT/DELETE).
- MCP-аннотации на каждом туле (read-only / write / idempotent write / destructive);
  карта «тул → хинты» запинована тестом.
- HTTP-клиент: SSRF-гард, таймаут с покрытием чтения тела, ретраи с бэкоффом
  (429 — всегда, 5xx/сеть — только для GET; учёт `Retry-After`),
  multipart-загрузка файлов сегментов, `AudienceError` с разбором формата ошибок API.
- Анонимная телеметрия использования (`server_start`, `tool_call`, `startup_failed`;
  отключение `ASKADS_TELEMETRY=0`).
- Тесты: node:test без сети (клиент, тулы, конфиг, телеметрия, аннотации) +
  dist-smoke с реальным MCP-хендшейком по stdio против собранного `dist/`.

[Unreleased]: https://github.com/A1-x-Tech/mcp-yandex-audience/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/A1-x-Tech/mcp-yandex-audience/releases/tag/v0.1.0
