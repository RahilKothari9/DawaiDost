// OWNER: evals agent. Server-only: read the newest committed results file from data/evals/.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResultsFile } from "./types";

const DIR = join(process.cwd(), "data", "evals");

export async function listResultFiles(): Promise<string[]> {
  try {
    return (await readdir(DIR)).filter((f) => /^results-.*\.json$/.test(f)).sort();
  } catch {
    return [];
  }
}

export async function loadLatestResults(): Promise<{ file: string; data: ResultsFile } | null> {
  const files = await listResultFiles();
  const latest = files.at(-1);
  if (!latest) return null;
  const data = JSON.parse(await readFile(join(DIR, latest), "utf8")) as ResultsFile;
  return data.schema === "dawai-dost/evals@1" ? { file: `data/evals/${latest}`, data } : null;
}
