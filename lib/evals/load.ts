// OWNER: evals agent. Server-only: read committed results files from data/evals/, newest run by startedAt.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResultsFile } from "./types";

const DIR = join(process.cwd(), "data", "evals");

export type LoadedRun = { file: string; data: ResultsFile };

export async function loadAllResults(): Promise<LoadedRun[]> {
  let names: string[] = [];
  try {
    names = (await readdir(DIR)).filter((f) => /^results-.*\.json$/.test(f));
  } catch {
    return [];
  }
  const runs: LoadedRun[] = [];
  for (const name of names) {
    try {
      const data = JSON.parse(await readFile(join(DIR, name), "utf8")) as ResultsFile;
      if (data.schema === "dawai-dost/evals@1") runs.push({ file: `data/evals/${name}`, data });
    } catch {
      // skip unreadable files
    }
  }
  return runs.sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
}

export async function loadLatestResults(): Promise<LoadedRun | null> {
  return (await loadAllResults()).at(-1) ?? null;
}
