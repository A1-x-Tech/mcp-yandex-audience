# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

### Изменено

- Сервер больше не завершается при отсутствии `YANDEX_AUDIENCE_TOKEN`: он стартует, отвечает
  на `initialize` и `tools/list`, а в `instructions` предупреждает модель, что оператор должен
  задать переменную окружения и перезапустить сервер. Прежний текст стартовой ошибки
  («YANDEX_AUDIENCE_TOKEN is required…») сохранён дословно и возвращается теперь при вызове
  инструмента (`CredentialsError`, ответ с `isError`) — без ретраев и без обращения к сети.
  Раньше процесс умирал до MCP-хендшейка, и пользователь видел только «красный крест» без
  причины.
- Телеметрия: у выжившего неконфигурированного старта своё событие `unconfigured_start`
  с прежним кодом причины (`missing_token`); `server_start` теперь означает старт рабочей
  установки. `startup_failed` остаётся для невалидных значений конфигурации (сегодня таких
  проверок нет) и отправляется fire-and-forget — процесс больше не ждёт пинг перед выходом.

## [1.0.1] — 2026-08-12

### Добавлено

- Инструкции сервера. В ответе MCP `initialize` теперь едет короткая справка для вызывающей
  модели: чем этот API является и чем не является, чего он не умеет, а также квоты, правила
  повторов и обманчивые ошибки, влияющие на то, как им пользоваться. Раньше это знание жило
  только в README, который модель не читает.

## [1.0.0] — 2026-08-11

### Изменено

- Объявлен стабильным. Набор инструментов, схемы входных данных и переменные окружения версии
  0.1.x переносятся без изменений — релиз фиксирует стабильность API, а не новое поведение.

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

[Unreleased]: https://github.com/A1-x-Tech/mcp-yandex-audience/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/A1-x-Tech/mcp-yandex-audience/releases/tag/v1.0.1
[1.0.0]: https://github.com/A1-x-Tech/mcp-yandex-audience/releases/tag/v1.0.0
[0.1.0]: https://github.com/A1-x-Tech/mcp-yandex-audience/releases/tag/v0.1.0
