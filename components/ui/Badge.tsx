import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "ink" | "accent" | "stockout" | "critical" | "low" | "ok" | "surplus";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean; icon?: ReactNode };

export function Badge({ tone = "neutral", dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span className={["ui-badge", `ui-badge--${tone}`, className ?? ""].join(" ").trim()} {...rest}>
      {dot ? <i className="ui-badge__dot" aria-hidden /> : null}
      {icon ? <span className="ui-badge__icon" aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}
