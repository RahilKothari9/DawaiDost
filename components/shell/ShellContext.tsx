"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ApiHealth = {
  state: "checking" | "live" | "demo" | "offline";
  decisionsModel?: string;
  realtimeModel?: string;
};

export type Toast = {
  id: string;
  title: string;
  detail?: string;
  tone?: "neutral" | "decision" | "risk" | "success";
  href?: string;
};

type ShellValue = {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  health: ApiHealth;
  refreshHealth: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id"> & { id?: string }) => void;
  dismissToast: (id: string) => void;
};

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [health, setHealth] = useState<ApiHealth>({ state: "checking" });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshHealth = useCallback(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { openai?: { configured?: boolean; decisionsModel?: string; realtimeModel?: string } }) =>
        setHealth({ state: j.openai?.configured ? "live" : "demo", decisionsModel: j.openai?.decisionsModel, realtimeModel: j.openai?.realtimeModel }),
      )
      .catch(() => setHealth({ state: "offline" }));
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const dismissToast = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((t: Omit<Toast, "id"> & { id?: string }) => {
    const id = t.id ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((ts) => (ts.some((x) => x.id === id) ? ts : [...ts.slice(-2), { ...t, id }]));
  }, []);

  const value = useMemo(
    () => ({ paletteOpen, setPaletteOpen, health, refreshHealth, toasts, pushToast, dismissToast }),
    [paletteOpen, health, refreshHealth, toasts, pushToast, dismissToast],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
