// OWNER: evals agent. Convenience launcher: `node scripts/evals/run.mjs [--configs ...] [--cases ...]`.
// Runs scripts/evals/run.ts under Node's built-in TypeScript support with .env.local loaded.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const flags = ["--experimental-transform-types", "--no-warnings", "--import", "./scripts/evals/register.mjs"];
if (existsSync(".env.local")) flags.unshift("--env-file=.env.local");
const r = spawnSync(process.execPath, [...flags, "scripts/evals/run.ts", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
