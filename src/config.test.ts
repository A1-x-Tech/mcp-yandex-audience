import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, loadConfig } from "./config.js";

/**
 * The reason codes below are the vocabulary the telemetry dashboard groups by —
 * renaming one silently splits a bar in two, so they are pinned here.
 */
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

function reasonOf(vars: Record<string, string | undefined>): string {
  let caught: unknown;
  withEnv(vars, () => {
    try {
      loadConfig();
    } catch (err) {
      caught = err;
    }
  });
  assert.ok(caught instanceof ConfigError, "config problems must throw ConfigError, not exit");
  return caught.reason;
}

test("a missing OAuth token reports missing_token", () => {
  assert.equal(reasonOf({ YANDEX_AUDIENCE_TOKEN: undefined }), "missing_token");
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
