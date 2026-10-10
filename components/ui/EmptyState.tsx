import type { ReactNode } from "react";

export type EmptyStateProps = { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean };

export function EmptyState({ icon, title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={["ui-empty", compact ? "ui-empty--compact" : ""].join(" ").trim()}>
      {icon ? <div className="ui-empty__icon" aria-hidden>{icon}</div> : null}
      <p className="ui-empty__title">{title}</p>
      {children ? <div className="ui-empty__body">{children}</div> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({ height = 16, width = "100%", className }: { height?: number | string; width?: number | string; className?: string }) {
  return <span className={["ui-skeleton", className ?? ""].join(" ").trim()} style={{ height, width }} aria-hidden />;
}
