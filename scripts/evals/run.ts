// OWNER: evals agent. CLI: run the labeled eval set against the live Decisions API and save results JSON.
//
//   node --env-file=.env.local --experimental-transform-types --no-warnings --import ./scripts/evals/register.mjs scripts/evals/run.ts \
//     [--configs gpt-6-luna:product,gpt-6-luna:minimal] [--cases T01,V01] [--concurrency 4] [--out data/evals/results-YYYY-MM-DD.json]
//
// Prints progress and headline metrics; never prints the API key.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EVAL_CASES, EVAL_POLICY, EVAL_POLICY_VERSION } from "../../lib/evals/cases";
import { BASELINE_SOURCE, makeConfig, runBaseline, runCase, runPool } from "../../lib/evals/run";
import { gradeBaseline, gradeConfig } from "../../lib/evals/report";
import type { CaseResult, PromptVariantId, ResultsFile, RunConfig } from "../../lib/evals/types";

const DEFAULT_CONFIGS = "gpt-6-luna:product,gpt-6-luna:action_only,gpt-6-luna:minimal,gpt-5.4-mini:product,gpt-6-sol:product";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set (pass --env-file=.env.local).");
  const concurrency = Number(arg("concurrency") ?? 4);
  const maxAttempts = 4;
  const timeoutMs = 45_000;
  const only = arg("cases")?.split(",").map((s) => s.trim());
  const cases = only ? EVAL_CASES.filter((c) => only.includes(c.id)) : EVAL_CASES;
  const configs: RunConfig[] = (arg("configs") ?? DEFAULT_CONFIGS).split(",").map((s) => {
    const [model, variant] = s.trim().split(":");
    if (!["product", "action_only", "minimal"].includes(variant)) throw new Error(`Unknown variant in ${s}`);
    return makeConfig(model, variant as PromptVariantId, cases[0]);
  });
  const startedAt = new Date().toISOString();
  const out = arg("out") ?? `data/evals/results-${startedAt.slice(0, 10)}.json`;

  // Probe once so an exhausted key fails fast instead of producing a file of errors.
  const probe = await runCase(cases[0], configs[0], { key, maxAttempts: 2, timeoutMs });
  if (!probe.ok && /HTTP 4\d\d/.test(probe.error ?? "")) throw new Error(`Probe call failed: ${probe.error}. Nothing written.`);

  const results: CaseResult[] = [];
  for (const config of configs) {
    const t0 = performance.now();
    let done = 0;
    const rs = await runPool(cases, concurrency, (c) => runCase(c, config, { key, maxAttempts, timeoutMs }), (r) => {
      done++;
      process.stdout.write(`\r${config.id.padEnd(28)} ${String(done).padStart(3)}/${cases.length}  ${r.caseId} ${r.ok ? r.choice : `ERR ${r.error}`}`.padEnd(100));
    });
    results.push(...rs);
    const m = gradeConfig(cases, rs);
    console.log(`\n${config.id}: accuracy ${(m.accuracy * 100).toFixed(1)}%  unambiguous ${(m.unambiguousAccuracy * 100).toFixed(1)}%  failed ${m.failed}  ECE ${m.ece?.toFixed(3) ?? "-"}  p95 ${m.latency.p95 ?? "-"} ms  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  }

  const baseline = cases.map(runBaseline);
  const bm = gradeBaseline(cases, baseline);
  console.log(`baseline (rules): accuracy ${(bm.accuracy * 100).toFixed(1)}%  unambiguous ${(bm.unambiguousAccuracy * 100).toFixed(1)}%`);

  const file: ResultsFile = {
    schema: "dawai-dost/evals@1",
    runId: `eval-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    policyVersion: EVAL_POLICY_VERSION,
    policy: EVAL_POLICY,
    concurrency,
    maxAttempts,
    timeoutMs,
    cases: cases.map((c) => ({ id: c.id, title: c.title, category: c.category, expected: c.expected, acceptable: c.acceptable, ambiguous: c.ambiguous, rule: c.rule, reason: c.reason, snapshot: c.snapshot })),
    configs,
    results,
    baseline: { name: "Deterministic fallback rules", source: BASELINE_SOURCE, results: baseline },
    notes: [`Run with node ${process.version} via scripts/evals/run.ts.`],
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(file, null, 1) + "\n");
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
