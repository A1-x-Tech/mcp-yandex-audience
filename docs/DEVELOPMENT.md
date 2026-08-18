# Development

## Requirements

- Node.js 20+ (the published package ships compiled `dist/`; `npx` needs no separate
  install). CI runs the suite on Node 20, 22 and 24.

## Commands

```bash
npm install
npm run dev        # run from source with tsx watch
npm test           # unit tests (node:test), no network
npm run typecheck  # type-check src + tests (no emit)
npm run build      # clean dist/ and compile with tsc
npm run smoke      # live READ-ONLY call: lists the first few segments
```

## Local run

```bash
npm run build
YANDEX_AUDIENCE_TOKEN=... node dist/index.js
# optional: YANDEX_AUDIENCE_API_HOST, YANDEX_AUDIENCE_TIMEOUT_MS, YANDEX_AUDIENCE_MAX_RETRIES
```

`npm run smoke` needs the same credentials and makes one live read
(`GET /v1/management/segments?limit=5` — no writes).

## Tests

Unit tests mock `globalThis.fetch` (client) or use a fake server + mock/real client
(tools), so the whole suite runs offline. `test/dist-smoke.test.js` additionally
builds `dist/` and completes a real MCP handshake over stdio against the built
entrypoint. Put a `*.test.ts` next to the code it covers;
`npm run typecheck && npm test` is the gate (also run by `prepublishOnly`).

## Телеметрия использования

Сервер отправляет анонимные события на `usage.gistrec.cloud` (`server_start`
при подключении клиента к настроенной установке, `unconfigured_start` при
подключении к серверу без токена, `tool_call` с **именем** инструмента и
`startup_failed` с кодом причины, если значение конфигурации невалидно), чтобы
считать активные установки и востребованность тулов. В событии только обезличенные технические поля:
случайный идентификатор установки
(`~/.config/mcp-yandex-audience/instance-id`), версия пакета, имя и версия
AI-приложения из MCP-handshake, версия Node.js и ОС.

Токен, данные аккаунта, аргументы вызовов и тексты запросов не отправляются
и не сохраняются (реализация — `src/telemetry.ts`). Отправка идёт в фоне
с таймаутом 2 с и молча пропускается при любой ошибке. Отключение для всех
MCP-серверов Ask Ads разом: `ASKADS_TELEMETRY=0`.
