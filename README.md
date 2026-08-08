# Yandex Audience MCP

[![npm](https://img.shields.io/npm/v/mcp-yandex-audience)](https://www.npmjs.com/package/mcp-yandex-audience)
[![CI](https://github.com/A1-x-Tech/mcp-yandex-audience/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-yandex-audience/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP-сервер для **[Яндекс Аудиторий](https://audience.yandex.ru)**: управляйте сегментами,
пикселями и похожими аудиториями — из Claude, Cursor, Codex и других AI-клиентов
на естественном языке.

Ассистент сам загрузит CRM-базу и сохранит её сегментом, построит lookalike нужной точности,
создаст пиксель и сегмент «видевших баннер», раздаст доступы коллегам — то, что в вебе
Аудиторий приходится делать вручную по нескольким экранам.

## Быстрый старт

1. [Получите OAuth-токен](#получение-доступа) Яндекса с правами на Аудитории.
2. Добавьте сервер — например, в Claude Code ([другие клиенты](#установка)):

   ```bash
   claude mcp add yandex-audience \
     -e YANDEX_AUDIENCE_TOKEN=ваш_токен \
     -- npx -y mcp-yandex-audience
   ```

3. Спросите ассистента: «Покажи мои сегменты в Аудиториях и их статусы»

## Что умеет

- **Сегменты** — `list_segments` (все типы со статусами), `rename_segment`, `delete_segment`.
- **Сегменты из файлов** — `upload_segment_file` (device id / MAC / SHA256-хеши) и
  `upload_segment_csv_file` (CRM-данные: email, телефоны) + `confirm_segment` — двухфазное
  создание «загрузил → сохранил с именем и типом».
- **Lookalike** — `create_lookalike_segment`: похожие аудитории со степенью точности 1..5.
- **Пиксели** — `list_pixels` (с охватами за 7/30/90 дней), `create_pixel`, `update_pixel`,
  `delete_pixel` и `create_pixel_segment` — сегменты из видевших баннер (период, частота, UTM).
- **Доступы** — `list_segment_grants`, `add_segment_grant`, `delete_segment_grant`:
  выдача и отзыв прав edit/view на сегмент по логину.
- **Универсальный `raw_request`** — прямой вызов любого пути API (пересчёт сегмента,
  восстановление пикселя, аккаунты-представители и т.д.).
- **Устойчивость** — ретраи на 429 с бэкоффом (на 5xx — только для чтения), таймаут запроса.

## Примеры запросов

Попросите ассистента на русском — например:

- «Покажи мои сегменты в Аудиториях и их статусы»
- «Загрузи файл clients.csv как сегмент "Клиенты 2026" с CRM-данными»
- «Создай lookalike на сегмент "Покупатели" со степенью похожести 2»
- «Создай пиксель "Промо октябрь" и сегмент всех, кто видел его за 30 дней»
- «Выдай логину team-lead доступ на просмотр сегмента 12345»

## Доступ к API

Сервер работает через **[API Яндекс Аудиторий](https://yandex.ru/dev/audience/)**
(хост `api-audience.yandex.ru`, авторизация OAuth-токеном в заголовке
`Authorization: OAuth <token>`). Токен привязан к аккаунту Яндекса — сервер видит те же
сегменты и пиксели, что и владелец токена в вебе Аудиторий (включая доверенные сегменты).

## Установка

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add yandex-audience \
  -e YANDEX_AUDIENCE_TOKEN=ваш_токен \
  -- npx -y mcp-yandex-audience
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "yandex-audience": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-audience"],
      "env": { "YANDEX_AUDIENCE_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "yandex-audience": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-audience"],
      "env": { "YANDEX_AUDIENCE_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json` — ключ `servers` (не `mcpServers`)

```json
{
  "servers": {
    "yandex-audience": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-yandex-audience"],
      "env": { "YANDEX_AUDIENCE_TOKEN": "ваш_токен" }
    }
  }
}
```

</details>

## Получение доступа

1. Зарегистрируйте приложение на [oauth.yandex.ru/client/new](https://oauth.yandex.ru/client/new)
   и отметьте права **Яндекс Аудиторий**:
   - «создание сегментов, изменение параметров настройки своих и доверенных сегментов»;
   - «чтение параметров настройки своих и доверенных сегментов».
2. Получите OAuth-токен для этого приложения — проще всего
   [отладочный токен](https://yandex.ru/dev/id/doc/ru/tokens/debug-token) из руководства по OAuth.
3. Запишите токен в `YANDEX_AUDIENCE_TOKEN`.

⚠️ Токен хранится **открытым текстом** в конфиге клиента — относитесь как к паролю.

## Настройка

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `YANDEX_AUDIENCE_TOKEN` | да | — | OAuth-токен Яндекса (заголовок `Authorization: OAuth …`). |
| `YANDEX_AUDIENCE_API_HOST` | нет | `https://api-audience.yandex.ru` | Хост API (`https://api-audience.yandex.com` для международных аккаунтов). |
| `YANDEX_AUDIENCE_TIMEOUT_MS` | нет | `60000` | Таймаут запроса, мс. |
| `YANDEX_AUDIENCE_MAX_RETRIES` | нет | `3` | Повторы при 429 (на 5xx/сетевых — только для чтения). |

## Требования

- Node.js 20+ (запускается через `npx`, отдельная установка не нужна).
- Аккаунт [Яндекс Аудиторий](https://audience.yandex.ru) и OAuth-токен —
  см. [Получение доступа](#получение-доступа).

## Ограничения

- **Это write-API.** Инструменты создают, изменяют и удаляют сегменты/пиксели;
  удаление сегмента необратимо. Инструменты размечены MCP-аннотациями
  (read-only / write / destructive) — клиенты могут запрашивать подтверждение.
- **Квоты API**: не более 30 запросов/сек с IP, 5000 запросов/сутки на логин;
  создание/изменение сегментов — 10/мин, 100/час, 500/сутки. Ошибочные запросы
  тоже расходуют квоту; при превышении API возвращает 429.
- **Файлы сегментов**: до 1 ГБ, минимум 100 записей (обходится `check_size=false`
  при сохранении), хеши — только SHA256 (MD5 не принимается с 01.01.2025).

## Документация

- [Все инструменты](https://github.com/A1-x-Tech/mcp-yandex-audience/blob/main/docs/TOOLS.md) — полный список с описанием.
- [Разработка](https://github.com/A1-x-Tech/mcp-yandex-audience/blob/main/docs/DEVELOPMENT.md) — сборка, тесты, smoke-проверка.
- [Публикация](https://github.com/A1-x-Tech/mcp-yandex-audience/blob/main/docs/PUBLISHING.md) — релиз и листинг в каталогах MCP.

## Смотрите также

- **[Ask Ads](https://askads.ru)** — чат-аналитик и «Сторож» рекламных кабинетов от авторов
  этого сервера: алерты о сливах бюджета и поломках трекинга — в Telegram.
- **[askads/claude-plugins](https://github.com/askads/claude-plugins)** — маркетплейс плагинов
  Claude: серверы Ask Ads ставятся одной командой, токены спрашиваются при включении.

## Поддержка

Вопросы, идеи и доработки — пишите в Telegram: [@gistrec](http://t.me/gistrec).

## Лицензия

MIT — см. [LICENSE](./LICENSE).
