"use client";
// OWNER: ai agent. "Ask the district": chat over the live district state. The Responses API calls function tools
// that run server-side over a snapshot of the store; answers stream in with tool calls shown as chips.
import { ArrowUp, Database, MessageCircleQuestion, Square, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { streamAsk } from "@/lib/ai/client";
import { compactState } from "@/lib/ai/compact";
import type { AiSource } from "@/lib/ai/types";
import { useDistrict } from "@/lib/district/store";
import { fmtMs, SourceBadge, Spinner } from "./shared";
import a from "./ai.module.css";
import s from "./AskDistrict.module.css";

export type AskDistrictProps = {
  variant?: "full" | "panel";
  /** Override the suggested prompts. */
  suggestions?: string[];
};

type ToolChip = { id: string; name: string; args: Record<string, unknown>; summary?: string };
type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tools: ToolChip[]; source?: AiSource; model?: string | null; fallbackReason?: string; latencyMs?: number; done: boolean; error?: string };


function argText(args: Record<string, unknown>) {
  return Object.entries(args)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => (k === "within_days" ? `≤${v}d` : k === "limit" ? `top ${v}` : String(v)))
    .join(" · ");
}

export function AskDistrict({ variant = "full", suggestions }: AskDistrictProps) {
  const { state } = useDistrict();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panel = variant === "panel";

  const prompts = suggestions ?? defaultPrompts(state);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      if (!last || last.role !== "assistant") return ms;
      return [...ms.slice(0, -1), fn(last)];
    });

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages, { role: "user" as const, content: q }];
    const wire = history
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    setMessages([...history, { role: "assistant", content: "", tools: [], done: false }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamAsk(wire, compactState(state), (e) => {
        if (e.type === "meta") patchLast((m) => ({ ...m, source: e.source, model: e.model, fallbackReason: e.fallbackReason, content: e.source === "demo_fallback" ? "" : m.content, tools: e.source === "demo_fallback" ? [] : m.tools }));
        else if (e.type === "tool_call") patchLast((m) => ({ ...m, tools: [...m.tools, { id: e.id, name: e.name, args: e.args }] }));
        else if (e.type === "tool_result") patchLast((m) => ({ ...m, tools: m.tools.map((t) => (t.id === e.id ? { ...t, summary: e.summary } : t)) }));
        else if (e.type === "delta") patchLast((m) => ({ ...m, content: m.content + e.text }));
        else if (e.type === "error") patchLast((m) => ({ ...m, error: e.message }));
        else if (e.type === "done") patchLast((m) => ({ ...m, done: true, source: e.source, latencyMs: e.latencyMs, fallbackReason: e.fallbackReason ?? m.fallbackReason }));
      }, ctrl.signal);
    } catch (err) {
      if (!ctrl.signal.aborted) patchLast((m) => ({ ...m, error: err instanceof Error ? err.message : "Request failed" }));
    } finally {
      patchLast((m) => ({ ...m, done: true }));
      setBusy(false);
      abortRef.current = null;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) abortRef.current?.abort();
    else void ask(input);
  }

  return (
    <section className={`${s.ask} ${panel ? s.panel : ""}`} aria-label="Ask the district">
      <div ref={logRef} className={s.log} aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? (
          <div className={s.intro}>
            <p className={s.introTitle}><MessageCircleQuestion size={15} aria-hidden /> Ask about any clinic, medicine or transfer</p>
            <p className={s.introSub}>Answers come only from tool calls over today&apos;s district ledger, so every number is traceable.</p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className={s.user}><p>{m.content}</p></div>
            ) : (
              <div key={i} className={s.bot}>
                {m.tools.length ? (
                  <ul className={s.tools} aria-label="Tool calls">
                    {m.tools.map((t) => (
                      <li key={t.id} className={s.tool} data-done={t.summary !== undefined || undefined} title={JSON.stringify(t.args)}>
                        {t.summary === undefined ? <Spinner size={11} /> : <Wrench size={11} aria-hidden />}
                        <code>{t.name}</code>
                        {argText(t.args) ? <span className={s.toolArgs}>{argText(t.args)}</span> : null}
                        {t.summary !== undefined ? <span className={s.toolRes}>→ {t.summary}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.content ? (
                  <div className={s.answer}>{m.content.split("\n").map((line, j) => (line.trim() ? <p key={j}>{line}</p> : null))}{!m.done ? <span className={s.caret} aria-hidden /> : null}</div>
                ) : !m.done ? (
                  <p className={s.thinking}><Spinner size={12} /> {m.tools.length ? "reading tool results…" : "thinking…"}</p>
                ) : null}
                {m.error ? <p className={s.err}>{m.error}</p> : null}
                {m.done && m.source ? (
                  <p className={s.meta}>
                    <SourceBadge source={m.source} reason={m.fallbackReason} />
                    <span className={a.genLabel}>
                      <Database size={11} aria-hidden /> {m.tools.length} tool call{m.tools.length === 1 ? "" : "s"}
                      {m.source === "live" && m.model ? ` · ${m.model}` : m.source === "demo_fallback" ? " · keyword planner, no model" : ""}
                      {m.latencyMs ? ` · ${fmtMs(m.latencyMs)}` : ""}
                    </span>
                  </p>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      {messages.length === 0 || !panel ? (
        <div className={s.prompts} aria-label="Suggested questions">
          {prompts.map((p) => (
            <button key={p} type="button" className={s.prompt} onClick={() => ask(p)} disabled={busy}>{p}</button>
          ))}
        </div>
      ) : null}

      <form className={s.form} onSubmit={onSubmit}>
        <label className={s.srOnly} htmlFor="ask-district-input">Ask the district</label>
        <input
          id="ask-district-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Which PHCs run out of amlodipine this week?"
          maxLength={500}
          autoComplete="off"
        />
        <button type="submit" className={s.send} disabled={!busy && !input.trim()} aria-label={busy ? "Stop" : "Send"}>
          {busy ? <Square size={13} /> : <ArrowUp size={15} />}
        </button>
      </form>
    </section>
  );
}

function defaultPrompts(state: ReturnType<typeof useDistrict>["state"]): string[] {
  const has = (name: string) => state.medicines.some((m) => m.name.toLowerCase() === name);
  const hasFac = (name: string) => state.facilities.some((f) => f.name.toLowerCase().startsWith(name));
  const out: string[] = [];
  if (has("amlodipine")) out.push("Which PHCs run out of amlodipine this week?");
  if (hasFac("rampur") && has("metformin")) out.push("Where can Rampur get metformin?");
  out.push("What transfers are in transit right now?");
  const sel = state.facilities.find((f) => f.id === state.selectedFacilityId);
  if (sel) out.push(`What is ${sel.name} short of?`);
  return out.slice(0, 4);
}
