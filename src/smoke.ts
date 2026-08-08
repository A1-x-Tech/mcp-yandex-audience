import { ConfigError, loadConfig } from "./config.js";
import { AudienceClient } from "./client.js";

/** Live READ-ONLY smoke check: lists the first few segments. */
async function main(): Promise<void> {
  const client = new AudienceClient(loadConfig());
  const result = await client.listSegments({ limit: 5 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  // A missing token is a user error, not a bug: report it without the stack.
  console.error("smoke failed:", err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
