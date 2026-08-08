import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AudienceClient } from "../client.js";
import { DESTRUCTIVE, fail, ok, pixelIdField, READ_ONLY, WRITE, WRITE_IDEMPOTENT } from "./util.js";

export function registerPixelTools(server: McpServer, client: AudienceClient): void {
  server.registerTool(
    "list_pixels",
    {
      title: "Список пикселей",
      annotations: READ_ONLY,
      description:
        "Возвращает список пикселей Яндекс Аудиторий пользователя. " +
        "Ответ — {\"pixels\": [...]}: у каждого пикселя id, name, create_time, url (код пикселя для вставки в рекламные материалы), " +
        "охваты user_quantity_7 / user_quantity_30 / user_quantity_90 (уникальные пользователи за 7/30/90 дней) и segments — сегменты, построенные на этом пикселе.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.listPixels());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_pixel",
    {
      title: "Создать пиксель",
      annotations: WRITE,
      description:
        "Создаёт пиксель Яндекс Аудиторий с заданным именем. " +
        "В ответе — {\"pixel\": {...}} с полем url: код пикселя, который нужно вставить в рекламные материалы (баннеры), " +
        "после чего на его основе можно строить сегменты инструментом create_pixel_segment.",
      inputSchema: {
        name: z.string().min(1).describe("Название пикселя."),
      },
    },
    async ({ name }) => {
      try {
        return ok(await client.createPixel(name));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_pixel",
    {
      title: "Переименовать пиксель",
      annotations: WRITE_IDEMPOTENT,
      description:
        "Изменяет указанный пиксель (в схеме изменения доступно только поле name — переименование). " +
        "Ответ — {\"pixel\": {...}} с обновлёнными данными.",
      inputSchema: {
        pixel_id: pixelIdField(),
        name: z.string().min(1).describe("Новое название пикселя."),
      },
    },
    async ({ pixel_id, name }) => {
      try {
        return ok(await client.updatePixel(pixel_id, name));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_pixel",
    {
      title: "Удалить пиксель",
      annotations: DESTRUCTIVE,
      description:
        "Удаляет указанный пиксель Яндекс Аудиторий. Успешный ответ — {\"success\": true}. " +
        "В API существует метод восстановления удалённого пикселя (POST /v1/management/pixel/{id}/undelete) — при необходимости он доступен через raw_request.",
      inputSchema: {
        pixel_id: pixelIdField(),
      },
    },
    async ({ pixel_id }) => {
      try {
        return ok(await client.deletePixel(pixel_id));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
