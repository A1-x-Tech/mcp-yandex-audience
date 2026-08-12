#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AudienceClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
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
 * Loads the config, reporting the drop-off if it is missing. An unconfigured
 * server dies before the MCP handshake, so this ping is the only trace such an
 * install ever leaves — and it has to be awaited, or process.exit() below would
 * kill the request in flight.
 */
async function loadConfigOrExit(telemetry: Telemetry): Promise<AudienceConfig> {
  try {
    return loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Error: ${err.message}`);
    await telemetry.sendBlocking("startup_failed", { reason: err.reason });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a missing key
  // can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const config = await loadConfigOrExit(telemetry);
  const client = new AudienceClient(config);

  // `instructions` rides in the server options (second argument) and surfaces as
  // the top-level `instructions` of the initialize result.
  const server = new McpServer(
    {
      name: "mcp-yandex-audience",
      version: readVersion(),
    },
    { instructions: INSTRUCTIONS },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };

  registerSegmentTools(server, client);
  registerPixelTools(server, client);
  registerGrantTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-audience running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting mcp-yandex-audience:", err);
  process.exit(1);
});
