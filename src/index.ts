#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AudienceClient } from "./client.js";
import { ConfigError, DEFAULT_HOST, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { AudienceConfig } from "./types.js";
import { registerSegmentTools } from "./tools/segments.js";
import { registerPixelTools } from "./tools/pixels.js";
import { registerGrantTools } from "./tools/grants.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Prose handed to the calling model in the MCP `initialize` result, before it
 * picks a tool. Deliberately NOT a summary of the tool list (the model already
 * has every name, description and schema): only what the tool list cannot say —
 * which Yandex product this is, what the API refuses to do, what a naive call
 * pattern costs, and which failures mean something other than what they look
 * like. It is prepended to every session, so keep it dense and factual.
 * Russian, like the tool descriptions — the audience is RU-speaking advertisers.
 */
const INSTRUCTIONS =
  "Это API Яндекс Аудиторий: сегменты, пиксели и доступы к ним. Не Директ и не Метрика: кампаний, " +
  "объявлений, ставок и рекламной статистики тут нет — готовый сегмент подключают к кампании вне " +
  "этого API. Выделенные инструменты создают только файловый (два шага: upload_* → " +
  "confirm_segment), lookalike и пиксельный сегмент, а у существующего меняют лишь имя; для " +
  "сегментов Метрики, AppMetrica и гео инструментов нет, они только видны в списке; остальные " +
  "методы API — через raw_request, который шлёт любой метод, включая DELETE. Обработка асинхронна: " +
  "статус приходит не сразу — перечитывайте list_segments, а не создавайте объект заново. Квоты: 30 " +
  "запросов/с на IP, 5000/сутки на логин; создание и изменение сегментов — 10/мин, 100/час, " +
  "500/сутки, ошибочные запросы тоже их расходуют. 429 сервер повторяет сам, а записи при 5xx и " +
  "сетевой ошибке — нет: вызов мог примениться, сначала проверьте состояние через list_*. Пустой " +
  "список может значить не «нет данных», а чужой аккаунт токена: видны только свои и доверенные " +
  "сегменты. Любая запись идёт в реальный аккаунт: сверяйте id, отката у delete_segment нет.";

/**
 * Prepended to INSTRUCTIONS when no token is configured. The model reads this
 * before it picks a tool, so an unconfigured session opens with the fix rather
 * than with a failed call. Unlike the Metrica sibling there is no in-chat
 * login: the token comes only from the environment, so the fix is the
 * operator's — set the variable and restart the server.
 */
const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: Яндекс Аудитории ещё не подключены — не задана переменная окружения " +
  "YANDEX_AUDIENCE_TOKEN, поэтому любой вызов инструмента вернёт ошибку. Подключиться из " +
  "диалога нельзя: оператор должен задать YANDEX_AUDIENCE_TOKEN (OAuth-токен Яндекса: " +
  "приложение регистрируется на https://oauth.yandex.ru/client/new со скоупами чтения и " +
  "изменения сегментов Аудиторий; для отладки подойдёт токен по инструкции " +
  "https://yandex.ru/dev/id/doc/ru/tokens/debug-token) в конфигурации MCP-клиента и " +
  "перезапустить сервер. ";

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a dead server and no reason —
 * instead the problem is carried into the session, where the model can read it
 * and relay it. (A missing token is not an error at all — loadConfig leaves the
 * field undefined; today it has no malformed-value checks either, so the catch
 * guards future ones.)
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: AudienceConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Error: ${err.message}`);
    // Fire-and-forget now that the process survives: the historical
    // `startup_failed` funnel stays comparable, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      config: { apiHost: process.env.YANDEX_AUDIENCE_API_HOST || DEFAULT_HOST },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a config
  // problem can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const { config, problem } = loadConfigOrDegraded(telemetry);
  const client = new AudienceClient(config);

  // Decided once, at startup: the token comes only from the environment, so an
  // unconfigured start stays unconfigured until the operator sets the variable
  // and restarts the server.
  const connected = Boolean(config.token);

  // `instructions` rides in the server options (second argument) and surfaces as
  // the top-level `instructions` of the initialize result.
  const server = new McpServer(
    {
      name: "mcp-yandex-audience",
      version: readVersion(),
    },
    {
      instructions: connected
        ? INSTRUCTIONS
        : UNCONFIGURED_PREFIX + (problem ? `Проблема конфигурации: ${problem.message} ` : "") + INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that
    // number. The reason vocabulary is the historical closed set (missing_token).
    if (connected) telemetry.send("server_start");
    else telemetry.send("unconfigured_start", { reason: problem?.reason ?? "missing_token" });
  };

  registerSegmentTools(server, client);
  registerPixelTools(server, client);
  registerGrantTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-yandex-audience running on stdio${
      connected ? "" : " (no YANDEX_AUDIENCE_TOKEN — set the variable and restart)"
    }`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting mcp-yandex-audience:", err);
  process.exit(1);
});
