import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AudienceClient } from "../client.js";
import { DESTRUCTIVE, fail, ok, READ_ONLY, segmentIdField, WRITE, WRITE_IDEMPOTENT } from "./util.js";

interface UploadArgs {
  file_path?: string;
  content?: string;
  file_name?: string;
}

/**
 * The upload tools accept either a local file path or inline content — exactly
 * one. Cross-field rules can't live in a plain-object inputSchema, so this is
 * checked here; a violation becomes a fail() result, not a thrown error.
 */
async function readUploadInput(
  args: UploadArgs,
  defaultName: string,
): Promise<{ fileName: string; data: Uint8Array } | { error: string }> {
  const hasPath = typeof args.file_path === "string" && args.file_path.length > 0;
  const hasContent = typeof args.content === "string" && args.content.length > 0;
  if (hasPath === hasContent) {
    return { error: "Укажите ровно один источник данных: file_path (путь к локальному файлу) ИЛИ content (содержимое файла строкой)." };
  }
  if (hasPath) {
    const data = await readFile(args.file_path as string);
    return { fileName: args.file_name || basename(args.file_path as string), data };
  }
  return { fileName: args.file_name || defaultName, data: new TextEncoder().encode(args.content as string) };
}

const uploadInputSchema = () => ({
  file_path: z
    .string()
    .min(1)
    .optional()
    .describe("Путь к локальному файлу с данными. Укажите либо file_path, либо content (ровно одно)."),
  content: z
    .string()
    .min(1)
    .optional()
    .describe("Содержимое файла строкой (для небольших сегментов). Укажите либо content, либо file_path (ровно одно)."),
  file_name: z
    .string()
    .min(1)
    .optional()
    .describe("Имя файла для загрузки. По умолчанию — имя из file_path или стандартное имя."),
});

export function registerSegmentTools(server: McpServer, client: AudienceClient): void {
  server.registerTool(
    "list_segments",
    {
      title: "Список сегментов",
      annotations: READ_ONLY,
      description:
        "Возвращает список сегментов Яндекс Аудиторий, доступных пользователю (все типы: uploading, metrika, appmetrica, lookalike, geo, pixel). " +
        "Ответ — {\"segments\": [...]}: у каждого сегмента id, name, type, status (uploaded | is_processed | processed | processing_failed | is_updated | few_data), create_time, owner " +
        "и типоспецифичные поля (у файловых — content_type, hashed, item_quantity, matched_quantity и др.). " +
        "Пагинация: limit (по умолчанию 10000) и offset; параметр pixel фильтрует по сегментам, созданным на основе указанного пикселя. " +
        "Отдельного метода получения одного сегмента в API нет — фильтруйте этот список по id.",
      inputSchema: {
        limit: z.number().int().min(1).optional().describe("Сколько сегментов вернуть (по умолчанию 10000)."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Порядковый номер сегмента, с которого начать выдачу (первый — 0)."),
        pixel: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Идентификатор пикселя: вернуть только сегменты, созданные на его основе."),
      },
    },
    async ({ limit, offset, pixel }) => {
      try {
        return ok(await client.listSegments({ limit, offset, pixel }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_segment_file",
    {
      title: "Загрузить файл сегмента (device id / MAC / хеши)",
      annotations: WRITE,
      description:
        "Создаёт сегмент из TSV/TXT-файла с данными: идентификаторы устройств (IDFA/GAID), MAC-адреса или SHA256-хеши, по одной записи в строке; минимум 100 записей, до 1 ГБ, UTF-8. " +
        "Это первый шаг двухфазного создания: в ответе сегмент со статусом uploaded и его id — затем сегмент нужно сохранить инструментом confirm_segment (имя, тип содержимого, хеширование). " +
        "Источник данных: file_path (путь к локальному файлу) или content (содержимое строкой) — ровно одно из двух. " +
        "Квота на создание сегментов: 10/мин, 100/час, 500/сутки.",
      inputSchema: uploadInputSchema(),
    },
    async ({ file_path, content, file_name }) => {
      try {
        const input = await readUploadInput({ file_path, content, file_name }, "segment.tsv");
        if ("error" in input) return fail(new Error(input.error));
        return ok(await client.uploadSegmentFile(input.fileName, input.data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "upload_segment_csv_file",
    {
      title: "Загрузить CSV-файл сегмента (CRM-данные)",
      annotations: WRITE,
      description:
        "Создаёт сегмент из CSV-файла с CRM-данными. Первая строка — заголовок: колонки email, phone, ext_id (или external_id) и произвольные дополнительные поля; минимум 100 записей, до 1 ГБ. " +
        "Это первый шаг двухфазного создания: в ответе сегмент со статусом uploaded и его id — затем сегмент нужно сохранить инструментом confirm_segment (content_type: crm). " +
        "Источник данных: file_path (путь к локальному файлу) или content (содержимое строкой) — ровно одно из двух. " +
        "Квота на создание сегментов: 10/мин, 100/час, 500/сутки.",
      inputSchema: uploadInputSchema(),
    },
    async ({ file_path, content, file_name }) => {
      try {
        const input = await readUploadInput({ file_path, content, file_name }, "segment.csv");
        if ("error" in input) return fail(new Error(input.error));
        return ok(await client.uploadSegmentCsvFile(input.fileName, input.data));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "confirm_segment",
    {
      title: "Сохранить загруженный сегмент",
      annotations: WRITE,
      description:
        "Сохраняет сегмент, созданный из файла (второй шаг после upload_segment_file / upload_segment_csv_file): задаёт имя, тип содержимого и параметры хеширования. " +
        "content_type: idfa_gaid (идентификаторы мобильных устройств), mac (MAC-адреса) или crm (CSV с CRM-данными). " +
        "hashing_alg — только SHA256 (MD5 не поддерживается API с 01.01.2025). device_matching_type: CROSS_DEVICE (по умолчанию) или IN_DEVICE (только для idfa_gaid). " +
        "check_size=false позволяет сохранить сегмент меньше 100 записей (его нельзя использовать в Директе, пока размер не превысит 100). " +
        "Ответ — {\"segment\": {...}}; обработка занимает время, статус смотрите через list_segments.",
      inputSchema: {
        segment_id: segmentIdField(),
        name: z.string().min(1).describe("Название сегмента."),
        content_type: z
          .enum(["idfa_gaid", "mac", "crm"])
          .describe("Тип содержимого файла: idfa_gaid | mac | crm."),
        hashed: z.boolean().optional().describe("Захешированы ли данные в файле."),
        hashing_alg: z
          .enum(["SHA256"])
          .optional()
          .describe("Алгоритм хеширования — только SHA256 (MD5 не поддерживается с 01.01.2025)."),
        device_matching_type: z
          .enum(["CROSS_DEVICE", "IN_DEVICE"])
          .optional()
          .describe("Режим сопоставления устройств: CROSS_DEVICE (по умолчанию) | IN_DEVICE (только для idfa_gaid)."),
        check_size: z
          .boolean()
          .optional()
          .describe("false — разрешить сохранение сегмента меньше 100 записей (по умолчанию true)."),
      },
    },
    async ({ segment_id, name, content_type, hashed, hashing_alg, device_matching_type, check_size }) => {
      try {
        return ok(
          await client.confirmSegment({
            segment_id,
            name,
            content_type,
            hashed,
            hashing_alg,
            device_matching_type,
            check_size,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "rename_segment",
    {
      title: "Переименовать сегмент",
      annotations: WRITE_IDEMPOTENT,
      description:
        "Изменяет сегмент. В схеме изменения доступно только поле name, так что фактически это переименование. " +
        "Работает с сегментом любого типа; ответ — {\"segment\": {...}} с обновлёнными данными.",
      inputSchema: {
        segment_id: segmentIdField(),
        name: z.string().min(1).describe("Новое название сегмента."),
      },
    },
    async ({ segment_id, name }) => {
      try {
        return ok(await client.renameSegment(segment_id, name));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_segment",
    {
      title: "Удалить сегмент",
      annotations: DESTRUCTIVE,
      description:
        "Удаляет указанный сегмент Яндекс Аудиторий. Операция необратима (метода восстановления сегмента в API нет). " +
        "Успешный ответ — {\"success\": true}.",
      inputSchema: {
        segment_id: segmentIdField(),
      },
    },
    async ({ segment_id }) => {
      try {
        return ok(await client.deleteSegment(segment_id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_lookalike_segment",
    {
      title: "Создать lookalike-сегмент",
      annotations: WRITE,
      description:
        "Создаёт сегмент типа lookalike — пользователи, «похожие» по поведению в интернете на аудиторию исходного сегмента (lookalike_link). " +
        "lookalike_value — степень похожести от 1 (максимальная точность, меньший охват) до 5 (максимальный охват). " +
        "maintain_device_distribution / maintain_geo_distribution (по умолчанию true) сохраняют распределение по типам устройств и городам исходного сегмента. " +
        "Ответ — {\"segment\": {...}}; сегмент обрабатывается асинхронно, статус смотрите через list_segments. Квота: 10/мин, 100/час, 500/сутки.",
      inputSchema: {
        name: z.string().min(1).describe("Название сегмента."),
        lookalike_link: z
          .number()
          .int()
          .positive()
          .describe("Идентификатор исходного сегмента, на который будут «похожи» пользователи."),
        lookalike_value: z
          .number()
          .int()
          .min(1)
          .max(5)
          .describe("Степень «похожести»: 1 (точнее, уже) .. 5 (шире охват)."),
        maintain_device_distribution: z
          .boolean()
          .optional()
          .describe("Сохранять распределение по типам устройств исходного сегмента (по умолчанию true)."),
        maintain_geo_distribution: z
          .boolean()
          .optional()
          .describe("Сохранять распределение по городам исходного сегмента (по умолчанию true)."),
      },
    },
    async ({ name, lookalike_link, lookalike_value, maintain_device_distribution, maintain_geo_distribution }) => {
      try {
        return ok(
          await client.createLookalikeSegment({
            name,
            lookalike_link,
            lookalike_value,
            maintain_device_distribution,
            maintain_geo_distribution,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "create_pixel_segment",
    {
      title: "Создать сегмент на основе пикселя",
      annotations: WRITE,
      description:
        "Создаёт сегмент типа pixel — пользователи, которых пиксель (pixel_id из list_pixels) видел за последние period_length дней (1..90). " +
        "Дополнительные условия объединяются по «И»: частота показов (times_quantity + times_quantity_operation: lt | eq | gt) и фильтры по UTM-меткам " +
        "(utm_source, utm_medium, utm_campaign, utm_content, utm_term). " +
        "device_matching_type присутствует в примере запроса API, но не описан в документации — считайте экспериментальным. " +
        "Ответ — {\"segment\": {...}}. Квота: 10/мин, 100/час, 500/сутки.",
      inputSchema: {
        name: z.string().min(1).describe("Название сегмента."),
        pixel_id: pixelIdBody(),
        period_length: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Период в сутках (1..90), за который пользователь был замечен пикселем."),
        times_quantity: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Пороговое количество срабатываний пикселя (используется вместе с times_quantity_operation)."),
        times_quantity_operation: z
          .enum(["lt", "eq", "gt"])
          .optional()
          .describe("Условие по частоте: lt (меньше), eq (равно), gt (больше) относительно times_quantity."),
        utm_source: z.string().optional().describe("Фильтр по метке utm_source."),
        utm_medium: z.string().optional().describe("Фильтр по метке utm_medium."),
        utm_campaign: z.string().optional().describe("Фильтр по метке utm_campaign."),
        utm_content: z.string().optional().describe("Фильтр по метке utm_content."),
        utm_term: z.string().optional().describe("Фильтр по метке utm_term."),
        device_matching_type: z
          .enum(["CROSS_DEVICE", "IN_DEVICE"])
          .optional()
          .describe("Режим сопоставления устройств (недокументирован для pixel-сегментов, экспериментально)."),
      },
    },
    async (args) => {
      try {
        return ok(
          await client.createPixelSegment({
            name: args.name,
            pixel_id: args.pixel_id,
            period_length: args.period_length,
            times_quantity: args.times_quantity,
            times_quantity_operation: args.times_quantity_operation,
            utm_source: args.utm_source,
            utm_medium: args.utm_medium,
            utm_campaign: args.utm_campaign,
            utm_content: args.utm_content,
            utm_term: args.utm_term,
            device_matching_type: args.device_matching_type,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );
}

/** pixel_id for the create body — a factory like the other shared fields. */
function pixelIdBody() {
  return z
    .number()
    .int()
    .positive()
    .describe("Идентификатор пикселя (id из list_pixels), на основе которого строится сегмент.");
}
