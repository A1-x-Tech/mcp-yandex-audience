import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AudienceClient, HttpMethod } from "../client.js";
import { fail, ok, RAW } from "./util.js";

export function registerRawTool(server: McpServer, client: AudienceClient): void {
  server.registerTool(
    "raw_request",
    {
      // The Audience API has write endpoints, and this tool can reach any of
      // them (including DELETE), so the worst case is assumed in the hints.
      annotations: RAW,
      title: "Произвольный запрос к API Аудиторий",
      description:
        "Escape hatch: прямой вызов любого пути Yandex Audience API, для эндпоинтов без выделенного инструмента " +
        "(например, PUT \"v1/management/segment/{id}/reprocess\" — пересчёт сегмента, или POST \"v1/management/pixel/{id}/undelete\" — восстановление пикселя). " +
        "Путь указывается относительно хоста API; query-параметры включайте прямо в path (например, \"v1/management/segments?limit=5\"). " +
        "body отправляется как JSON для POST/PUT. Заголовок Authorization подставляется автоматически; путь на чужой хост будет отклонён.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Относительный путь API, например "v1/management/segments?limit=5".'),
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .optional()
          .describe("HTTP-метод. По умолчанию GET (безопасный)."),
        body: z.record(z.any()).optional().describe("JSON-тело запроса (для POST/PUT)."),
      },
    },
    async ({ path, method, body }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        return ok(await client.request(m, path, body));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
