"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import type { TimelineKind } from "@/lib/district/types";
import { useShell, type Toast } from "./ShellContext";
import { KIND_LABEL } from "./format";

const TONE: Partial<Record<TimelineKind, Toast["tone"]>> = {
  decision: "decision",
  alert: "risk",
  escalation: "risk",
  recount_requested: "risk",
  approval: "success",
  count_verified: "success",
  transfer_update: "decision",
};

const HREF: Partial<Record<TimelineKind, string>> = {
  decision: "/decisions",
  approval: "/transfers",
  rejection: "/decisions",
  transfer_update: "/transfers",
  voice_report: "/voice",
  count_verified: "/voice",
  recount_requested: "/voice",
  indent: "/briefing",
  briefing: "/briefing",
  alert: "/stock",
  escalation: "/decisions",
};

/** Turns new accountability-timeline events into toasts. */
export function TimelineToaster() {
  const { state } = useDistrict();
  const { pushToast } = useShell();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(state.timeline.map((e) => e.id));
      return;
    }
    const fresh = state.timeline.filter((e) => !seen.current!.has(e.id));
    fresh.forEach((e) => seen.current!.add(e.id));
    // A reset or bulk load replaces many events at once; don't flood the screen.
    if (fresh.length === 0 || fresh.length > 4) return;
    fresh
      .slice()
      .reverse()
      .forEach((e) =>
        pushToast({ id: `tl-${e.id}`, title: e.title, detail: `${KIND_LABEL[e.kind] ?? e.kind} · ${e.actor}`, tone: TONE[e.kind] ?? "neutral", href: HREF[e.kind] }),
      );
  }, [state.timeline, pushToast]);

  return null;
}

export function ToastViewport() {
  const { toasts, dismissToast } = useShell();
  const reduce = useReducedMotion();

  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            className={`toast toast--${t.tone ?? "neutral"}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
            transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <ToastTimer id={t.id} onDone={dismissToast} />
            <i className="toast__bar" aria-hidden />
            <div className="toast__copy">
              {t.href ? (
                <Link href={t.href} className="toast__title" onClick={() => dismissToast(t.id)}>
                  {t.title}
                </Link>
              ) : (
                <p className="toast__title">{t.title}</p>
              )}
              {t.detail ? <p className="toast__detail">{t.detail}</p> : null}
            </div>
            <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastTimer({ id, onDone }: { id: string; onDone: (id: string) => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => onDone(id), 6500);
    return () => window.clearTimeout(t);
  }, [id, onDone]);
  return null;
}
