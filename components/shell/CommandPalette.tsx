"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { Building2, Clock, CornerDownLeft, Mic, Pill, RotateCcw, Search, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDistrict } from "@/lib/district/store";
import { Kbd } from "@/components/ui";
import { useShell } from "./ShellContext";
import { NAV } from "./nav";
import { RISK_LABEL, RISK_RANK, fmtDays } from "./format";
import type { RiskLevel } from "@/lib/district/types";

type Command = {
  id: string;
  group: "Views" | "Actions" | "Facilities" | "Medicines";
  label: string;
  hint?: ReactNode;
  icon: LucideIcon;
  keywords?: string;
  decision?: boolean;
  run: () => void;
};

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useShell();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  return <AnimatePresence>{paletteOpen ? <PaletteDialog onClose={() => setPaletteOpen(false)} /> : null}</AnimatePresence>;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { state, dispatch, assessments } = useDistrict();
  const { pushToast } = useShell();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const worst = (facilityId: string) => {
      const rows = assessments.filter((a) => a.facilityId === facilityId);
      return rows.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])[0];
    };
    const sel = state.selectedFacilityId ? state.facilities.find((f) => f.id === state.selectedFacilityId) : undefined;
    const out: Command[] = [
      ...NAV.map((n) => ({ id: `v-${n.href}`, group: "Views" as const, label: n.label, hint: n.description, icon: n.icon, keywords: n.short, run: go(n.href) })),
      {
        id: "a-decide",
        group: "Actions",
        label: sel ? `Run the Decisions API for ${sel.name}` : "Run the Decisions API",
        hint: "Pick one of four actions, with a probability for each",
        icon: Sparkles,
        decision: true,
        keywords: "decide recommend openai",
        run: go("/decisions"),
      },
      {
        id: "a-story",
        group: "Actions",
        label: "Open the Saraswati metformin case",
        hint: "Voice check, Decisions API, approval, transfer",
        icon: Sparkles,
        decision: true,
        keywords: "story hero demo",
        run: () => {
          const s = state.facilities.find((f) => /saraswati/i.test(f.name));
          if (s) dispatch({ type: "SELECT_FACILITY", facilityId: s.id });
          router.push("/#story");
        },
      },
      { id: "a-call", group: "Actions", label: sel ? `Start a voice check-in with ${sel.name}` : "Start a voice check-in", hint: "Hindi stock call over the Realtime API", icon: Mic, keywords: "call phone realtime", run: go("/voice") },
      { id: "a-6h", group: "Actions", label: "Advance the clock 6 hours", icon: Clock, keywords: "time", run: () => dispatch({ type: "ADVANCE_CLOCK", hours: 6 }) },
      { id: "a-1d", group: "Actions", label: "Advance the clock 1 day", icon: Clock, keywords: "time day", run: () => dispatch({ type: "ADVANCE_CLOCK", hours: 24 }) },
      {
        id: "a-reset",
        group: "Actions",
        label: "Reset the scenario",
        icon: RotateCcw,
        run: () => {
          dispatch({ type: "RESET" });
          pushToast({ title: "Scenario reset", tone: "neutral" });
        },
      },
      ...state.facilities.map((f) => {
        const w = worst(f.id);
        return {
          id: `f-${f.id}`,
          group: "Facilities" as const,
          label: f.name,
          hint: (
            <>
              {f.type} · {f.block} block
              {w ? <span className={`pal-risk pal-risk--${w.risk}`}>{RISK_LABEL[w.risk as RiskLevel]} · {fmtDays(w.daysOfStock)}d</span> : null}
            </>
          ),
          icon: Building2,
          keywords: `${f.block} ${f.pharmacist.name} ${f.type}`,
          run: () => {
            dispatch({ type: "SELECT_FACILITY", facilityId: f.id });
            router.push("/map");
          },
        };
      }),
      ...state.medicines.map((m) => ({
        id: `m-${m.id}`,
        group: "Medicines" as const,
        label: `${m.name} ${m.strength}`,
        hint: `${m.category} · lead time ${m.leadTimeDays}d`,
        icon: Pill,
        keywords: m.category,
        run: () => {
          dispatch({ type: "SELECT_MEDICINE", medicineId: m.id });
          router.push("/stock");
        },
      })),
    ];
    return out;
  }, [state.facilities, state.medicines, state.selectedFacilityId, assessments, dispatch, router, pushToast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => c.group !== "Facilities" || commands.filter((x) => x.group === "Facilities").indexOf(c) < 6);
    const terms = q.split(/\s+/);
    return commands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.activeElement as HTMLElement | null;
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runAt = (i: number) => {
    const c = filtered[i];
    if (!c) return;
    onClose();
    c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); runAt(active); }
  };

  let lastGroup = "";
  return (
    <div className="palette-root" onKeyDown={onKey}>
      <motion.div className="palette-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="palette"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
      >
        <div className="palette__search">
          <Search size={16} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder="Search clinics, medicines, views, actions"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={filtered[active] ? `pal-${filtered[active].id}` : undefined}
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {filtered.length === 0 ? <li className="palette__empty">Nothing matches “{query}”. Try a clinic, block or medicine name.</li> : null}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            const Icon = c.icon;
            return (
              <li key={c.id} role="presentation">
                {header ? <p className="palette__group">{header}</p> : null}
                <div
                  id={`pal-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-idx={i}
                  className={`palette__item ${i === active ? "is-active" : ""} ${c.decision ? "is-decision" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAt(i)}
                >
                  <Icon size={16} aria-hidden className="palette__icon" />
                  <span className="palette__text">
                    <span className="palette__label">{c.label}</span>
                    {c.hint ? <span className="palette__hint">{c.hint}</span> : null}
                  </span>
                  {i === active ? <CornerDownLeft size={14} aria-hidden className="palette__enter" /> : null}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="palette__foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span><Kbd>Enter</Kbd> open</span>
          <span><Kbd>⌘K</Kbd> toggle</span>
        </footer>
      </motion.div>
    </div>
  );
}
