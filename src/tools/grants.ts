import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AudienceClient } from "../client.js";
import { DESTRUCTIVE, fail, ok, READ_ONLY, segmentIdField, WRITE_IDEMPOTENT } from "./util.js";

export function registerGrantTools(server: McpServer, client: AudienceClient): void {
  server.registerTool(
    "list_segment_grants",
    {
      title: "Список доступов к сегменту",
      annotations: READ_ONLY,
      description:
        "Возвращает список разрешений на управление сегментом. " +
        "Ответ — {\"grants\": [...]}: у каждого разрешения user_login (логин пользователя), permission (edit — редактирование, view — просмотр), comment и created_at.",
      inputSchema: {
        segment_id: segmentIdField(),
      },
    },
    async ({ segment_id }) => {
      try {
        return ok(await client.listSegmentGrants(segment_id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "add_segment_grant",
    {
      title: "Выдать доступ к сегменту",
      annotations: WRITE_IDEMPOTENT,
      description:
        "Создаёт разрешение на управление сегментом для указанного логина Яндекса. " +
        "permission: edit — редактирование и использование сегмента, view — только просмотр/использование. " +
        "Ответ — {\"grant\": {...}} (поле created_at заполняет сервер).",
      inputSchema: {
        segment_id: segmentIdField(),
        user_login: z.string().min(1).describe("Логин пользователя Яндекса, которому выдаётся доступ."),
        permission: z.enum(["edit", "view"]).describe("Уровень доступа: edit (изменение) | view (просмотр)."),
        comment: z.string().max(255).optional().describe("Комментарий к разрешению (до 255 символов)."),
      },
    },
    async ({ segment_id, user_login, permission, comment }) => {
      try {
        return ok(await client.addSegmentGrant({ segment_id, user_login, permission, comment }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_segment_grant",
    {
      title: "Отозвать доступ к сегменту",
      annotations: DESTRUCTIVE,
      description:
        "Удаляет разрешение на управление сегментом у указанного пользователя. Успешный ответ — {\"success\": true}.",
      inputSchema: {
        segment_id: segmentIdField(),
        user_login: z.string().min(1).describe("Логин пользователя, у которого отзывается доступ."),
      },
    },
    async ({ segment_id, user_login }) => {
      try {
        return ok(await client.deleteSegmentGrant(segment_id, user_login));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
