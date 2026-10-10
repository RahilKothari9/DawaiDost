"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
  /** When true the drawer does not dim or block the page behind it. */
  modeless?: boolean;
};

export function Drawer({ open, onClose, title, subtitle, children, width = 440, modeless }: DrawerProps) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => panelRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className={["ui-drawer-root", modeless ? "is-modeless" : ""].join(" ").trim()}>
          {!modeless ? (
            <motion.div className="ui-drawer-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          ) : null}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal={!modeless}
            aria-labelledby={titleId}
            tabIndex={-1}
            className="ui-drawer"
            style={{ ["--drawer-w" as string]: `${width}px` }}
            initial={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <header className="ui-drawer__head">
              <div>
                <h2 id={titleId} className="ui-drawer__title">{title}</h2>
                {subtitle ? <p className="ui-drawer__sub">{subtitle}</p> : null}
              </div>
              <button type="button" className="ui-icon-btn" onClick={onClose} aria-label="Close panel">
                <X size={16} />
              </button>
            </header>
            <div className="ui-drawer__body">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
