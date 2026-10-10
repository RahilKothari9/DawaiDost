"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useDistrict } from "@/lib/district/store";
import type { TimelineEvent } from "@/lib/district/types";
import { fmtAgo, fmtTime } from "@/components/shell/format";

export function ViewHeader({ kicker, title, lede, actions }: { kicker?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="view-head">
      <div className="view-head__copy">
        {kicker ? <p className="view-head__kicker">{kicker}</p> : null}
        <h1 className="view-head__title">{title}</h1>
        {lede ? <p className="view-head__lede">{lede}</p> : null}
      </div>
      {actions ? <div className="view-head__actions">{actions}</div> : null}
    </header>
  );
}

/**
 * The decision mark: four ticks, one per allowed action, the tallest being the chosen one.
 * Used wherever the OpenAI Decisions API produced or shaped what is shown.
 */
export function DecisionMark({ label = "Decisions API", size = "sm", onInk, heights = [0.35, 1, 0.5, 0.25] }: { label?: ReactNode; size?: "sm" | "lg"; onInk?: boolean; heights?: number[] }) {
  const top = heights.indexOf(Math.max(...heights));
  return (
    <span className={`dmark ${size === "lg" ? "dmark--lg" : ""} ${onInk ? "dmark--on-ink" : ""}`}>
      <span className="dmark__ticks" aria-hidden>
        {heights.map((h, i) => (
          <i key={i} className={i === top ? "is-top" : ""} style={{ height: `${Math.max(18, h * 100)}%` }} />
        ))}
      </span>
      {label}
    </span>
  );
}

export function ActivityFeed({ events, limit = 8, showMore = true }: { events?: TimelineEvent[]; limit?: number; showMore?: boolean }) {
  const { state } = useDistrict();
  const list = (events ?? state.timeline).slice(0, limit);
  if (!list.length) return <p className="muted" style={{ fontSize: 13 }}>Nothing has happened yet. Reports, decisions and approvals appear here as they occur.</p>;
  return (
    <div>
      <ol className="feed">
        {list.map((e) => (
          <li key={e.id} className="feed__item">
            <time className="feed__time" dateTime={e.at} title={fmtAgo(e.at, state.now)}>{fmtTime(e.at)}</time>
            <i className={`feed__dot feed__dot--${e.kind}`} aria-hidden />
            <div>
              <p className="feed__title">{e.title}</p>
              <p className="feed__meta">{e.actor} · {fmtAgo(e.at, state.now)}</p>
            </div>
          </li>
        ))}
      </ol>
      {showMore && state.timeline.length > limit ? (
        <Link href="/activity" className="inbox-note" style={{ display: "inline-block", textDecoration: "underline", textUnderlineOffset: 3 }}>
          See all {state.timeline.length} events in the activity log
        </Link>
      ) : null}
    </div>
  );
}
