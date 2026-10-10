// OWNER: evals agent. /evals — evaluation report for the Decisions API, read from committed results.
import type { Metadata } from "next";
import { EvalReport } from "@/components/evals/EvalReport";
import { EVAL_CASES, EVAL_POLICY, EVAL_POLICY_VERSION, LIVE_SUBSET_IDS } from "@/lib/evals/cases";
import { loadLatestResults } from "@/lib/evals/load";
import { BASELINE_SOURCE, runBaseline } from "@/lib/evals/run";
import type { ResultsFile } from "@/lib/evals/types";

export const metadata: Metadata = { title: "Decision evals", description: "How often the OpenAI Decisions API picks the right district action on labeled cases, against a rules baseline." };

const RERUN = "node scripts/evals/run.mjs";

function baselineOnly(): ResultsFile {
  const now = new Date().toISOString();
  return {
    schema: "dawai-dost/evals@1",
    runId: "baseline-only",
    startedAt: now,
    finishedAt: now,
    policyVersion: EVAL_POLICY_VERSION,
    policy: EVAL_POLICY,
    concurrency: 4,
    maxAttempts: 4,
    timeoutMs: 45_000,
    cases: EVAL_CASES.map(({ snapshot, ...c }) => ({ ...c, snapshot })),
    configs: [],
    results: [],
    baseline: { name: "Deterministic fallback rules", source: BASELINE_SOURCE, results: EVAL_CASES.map(runBaseline) },
    notes: [],
  };
}

export default async function Page() {
  const loaded = await loadLatestResults();
  const data = loaded?.data ?? baselineOnly();
  const subset = data.cases.filter((c) => LIVE_SUBSET_IDS.includes(c.id)).map((c) => ({ id: c.id, title: c.title, expected: c.expected, acceptable: c.acceptable }));
  return <EvalReport data={data} file={loaded?.file ?? null} recorded={!!loaded && data.configs.length > 0} liveSubset={subset} rerun={RERUN} />;
}
