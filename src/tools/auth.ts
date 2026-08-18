import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TokenStore } from "../auth.js";
import type { AudienceClient } from "../client.js";
import {
  clearPendingLogin,
  exchangeCode,
  oauthClientId,
  pendingLogin,
  startLogin,
} from "../oauth.js";
import { DESTRUCTIVE, fail, ok, READ_ONLY, WRITE_IDEMPOTENT } from "./util.js";

/**
 * The in-chat login. Two steps because the user has to leave for the browser in
 * between: `start_login` hands out a URL, `finish_login` redeems the code they
 * bring back. The PKCE verifier never leaves this process, so the code passing
 * through the chat is useless to anyone who reads it — and it dies in 10 minutes.
 */
export function registerAuthTools(
  server: McpServer,
  client: AudienceClient,
  tokens: TokenStore,
): void {
  server.registerTool(
    "auth_status",
    {
      title: "Статус подключения к Аудиториям",
      annotations: READ_ONLY,
      description:
        "Показывает, подключены ли Яндекс Аудитории: есть ли токен, откуда он взят " +
        "(переменная окружения YANDEX_AUDIENCE_TOKEN или сохранённый вход), когда истекает и " +
        "где лежит файл с сохранёнными данными. Ничего не отправляет в сеть и не показывает сам токен. " +
        "Вызовите это, если инструменты Аудиторий отвечают, что подключение не настроено.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(tokens.status());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "start_login",
    {
      title: "Начать подключение Аудиторий",
      annotations: READ_ONLY,
      description:
        "Первый шаг подключения Яндекс Аудиторий без правки конфигурации и без перезапуска клиента. " +
        "Возвращает ссылку на страницу Яндекс OAuth. Покажите ссылку пользователю целиком и попросите: " +
        "открыть её в браузере под аккаунтом Яндекса, которому принадлежат нужные сегменты (или которому " +
        "они доверены), подтвердить доступ на чтение и изменение сегментов и прислать показанный код " +
        "подтверждения. Полученный код передайте в finish_login. Код действует 10 минут. Сам по себе код " +
        "бесполезен для постороннего: обменять его может только этот сервер.",
      inputSchema: {},
    },
    async () => {
      try {
        const { authorizeUrl } = startLogin();
        return ok({
          authorizeUrl,
          clientId: oauthClientId(),
          expiresInMinutes: 10,
          nextStep:
            "Покажите пользователю ссылку authorizeUrl, дождитесь кода подтверждения и вызовите finish_login с этим кодом.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "finish_login",
    {
      title: "Завершить подключение Аудиторий",
      annotations: WRITE_IDEMPOTENT,
      description:
        "Второй шаг подключения: обменивает код подтверждения из start_login на токен доступа, " +
        "сохраняет его в файл только для владельца (0600) и сразу проверяет живым запросом к Аудиториям. " +
        "После успеха остальные инструменты работают немедленно — перезапускать клиент не нужно. " +
        "Код одноразовый и живёт 10 минут: если он не принят, вызовите start_login заново и попросите свежий.",
      inputSchema: {
        code: z
          .string()
          .min(1)
          .describe("Код подтверждения, который Яндекс показал пользователю после входа."),
      },
    },
    async ({ code }) => {
      try {
        const pending = pendingLogin();
        if (!pending) {
          return fail(
            "Нет активного запроса на подключение (или он истёк — он живёт 10 минут). " +
              "Вызовите start_login и повторите вход.",
          );
        }

        const response = await exchangeCode({
          code: code.trim(),
          verifier: pending.verifier,
          clientId: pending.clientId,
        });
        tokens.save(response);
        clearPendingLogin();

        // Prove it works before telling the user it does: the live read both
        // validates the token against the API and shows whether this account
        // sees any segments at all.
        const segments = await client.listSegments({ limit: 5 });
        const list = (segments as { segments?: unknown[] })?.segments;
        const found = Array.isArray(list) ? list.length : 0;

        return ok({
          connected: true,
          segmentsVisible: found,
          storedAt: tokens.status().path,
          // Present only when Yandex granted less than SCOPE asked for — worth
          // surfacing, because the failure it causes shows up later as a bare 403.
          grantedScope: response.scope,
          note:
            found === 0
              ? "Токен сохранён и проверен живым запросом, но сегментов не видно: либо в этом аккаунте их ещё нет (это нормально для нового аккаунта), либо вход выполнен под другим аккаунтом Яндекса — уточните у пользователя и при необходимости повторите start_login."
              : "Подключение готово, инструменты Аудиторий можно вызывать сразу.",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "logout",
    {
      title: "Отключить Аудитории",
      annotations: DESTRUCTIVE,
      description:
        "Удаляет сохранённый токен Аудиторий с диска. Токен, заданный переменной окружения " +
        "YANDEX_AUDIENCE_TOKEN, не трогает — его нужно убирать из конфигурации клиента вручную. " +
        "Доступ, выданный приложению, остаётся активным на стороне Яндекса: отозвать его можно в Яндекс ID.",
      inputSchema: {},
    },
    async () => {
      try {
        const removed = tokens.logout();
        clearPendingLogin();
        return ok({
          removed,
          note: removed
            ? "Сохранённый токен удалён."
            : "Сохранённого токена не было — удалять нечего.",
          envTokenStillSet: tokens.status().source === "env",
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
