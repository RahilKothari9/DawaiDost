import type { HTMLAttributes, ReactNode } from "react";

export type PanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  /** `decision` marks panels that carry OpenAI Decisions API output. */
  tone?: "default" | "sunken" | "ink" | "decision";
  flush?: boolean;
  as?: "section" | "div" | "article" | "aside";
};

export function Panel({ title, kicker, actions, tone = "default", flush, as: Tag = "section", className, children, ...rest }: PanelProps) {
  const hasHead = title || kicker || actions;
  return (
    <Tag className={["ui-panel", `ui-panel--${tone}`, flush ? "ui-panel--flush" : "", className ?? ""].join(" ").trim()} {...rest}>
      {hasHead ? (
        <header className="ui-panel__head">
          <div className="ui-panel__titles">
            {kicker ? <p className="ui-panel__kicker">{kicker}</p> : null}
            {title ? <h2 className="ui-panel__title">{title}</h2> : null}
          </div>
          {actions ? <div className="ui-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ui-panel__body">{children}</div>
    </Tag>
  );
}
