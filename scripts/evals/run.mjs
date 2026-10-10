// OWNER: evals agent. Convenience launcher: `node scripts/evals/run.mjs [--configs ...] [--cases ...] [--concurrency N]`.
// Runs scripts/evals/run.ts under Node's built-in TypeScript support.
// Values in .env.local OVERRIDE the inherited environment: `node --env-file` does not, and a stale
// OPENAI_API_KEY exported in the shell would otherwise win silently.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || raw.trim().startsWith("#")) continue;
    env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
}
const flags = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/evals/register.mjs"];
const r = spawnSync(process.execPath, [...flags, "scripts/evals/run.ts", ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(r.status ?? 1);
