"use client";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

export type TabsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
};

/** Segmented tablist with roving focus (arrow keys, Home, End). */
export function Tabs<T extends string>({ items, value, onChange, label, size = "md", className }: TabsProps<T>) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={["ui-tabs", `ui-tabs--${size}`, className ?? ""].join(" ").trim()}>
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${id}-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ui-tab"
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {item.label}
            {typeof item.count === "number" ? <span className="ui-tab__count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
