import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "./config.js";

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * A missing token used to throw, which killed the process before the MCP
 * handshake and left the user with a dead server and no reason. It is now a
 * survivable state: the server starts, answers initialize/tools/list, and the
 * client raises CredentialsError at call time (pinned in client.test.ts).
 * Pinned here because reverting it would restore that dead end.
 */
test("a missing OAuth token does not throw — the server must start degraded", () => {
  withEnv(
    {
      YANDEX_AUDIENCE_TOKEN: undefined,
      YANDEX_AUDIENCE_API_HOST: undefined,
      YANDEX_AUDIENCE_TIMEOUT_MS: undefined,
      YANDEX_AUDIENCE_MAX_RETRIES: undefined,
    },
    () => {
      const cfg = loadConfig();
      assert.equal(cfg.token, undefined);
      // The rest of the config stays usable: defaults intact.
      assert.equal(cfg.apiHost, "https://api-audience.yandex.ru");
      assert.equal(cfg.timeoutMs, 60_000);
      assert.equal(cfg.maxRetries, 3);
    },
  );
});

test("an empty value is treated as absent, not as an empty credential", () => {
  withEnv({ YANDEX_AUDIENCE_TOKEN: "" }, () => {
    assert.equal(loadConfig().token, undefined);
  });
});

test("a configured server loads with the default host", () => {
  withEnv(
    {
      YANDEX_AUDIENCE_TOKEN: "tok",
      YANDEX_AUDIENCE_API_HOST: undefined,
      YANDEX_AUDIENCE_TIMEOUT_MS: undefined,
      YANDEX_AUDIENCE_MAX_RETRIES: undefined,
    },
    () => {
      const cfg = loadConfig();
      assert.equal(cfg.token, "tok");
      assert.equal(cfg.apiHost, "https://api-audience.yandex.ru");
      assert.equal(cfg.timeoutMs, 60_000);
      assert.equal(cfg.maxRetries, 3);
    },
  );
});

test("YANDEX_AUDIENCE_API_HOST overrides the host (e.g. .com for international accounts)", () => {
  withEnv(
    { YANDEX_AUDIENCE_TOKEN: "tok", YANDEX_AUDIENCE_API_HOST: "https://api-audience.yandex.com" },
    () => {
      assert.equal(loadConfig().apiHost, "https://api-audience.yandex.com");
    },
  );
});

test("invalid numeric overrides silently fall back to the defaults", () => {
  withEnv(
    {
      YANDEX_AUDIENCE_TOKEN: "tok",
      YANDEX_AUDIENCE_TIMEOUT_MS: "not-a-number",
      YANDEX_AUDIENCE_MAX_RETRIES: "-5",
    },
    () => {
      const cfg = loadConfig();
      assert.equal(cfg.timeoutMs, 60_000);
      assert.equal(cfg.maxRetries, 3);
    },
  );
});

test("valid numeric overrides are honored", () => {
  withEnv(
    {
      YANDEX_AUDIENCE_TOKEN: "tok",
      YANDEX_AUDIENCE_TIMEOUT_MS: "1500",
      YANDEX_AUDIENCE_MAX_RETRIES: "0",
    },
    () => {
      const cfg = loadConfig();
      assert.equal(cfg.timeoutMs, 1500);
      assert.equal(cfg.maxRetries, 0);
    },
  );
});
