"use client";
// OWNER: analytics agent. Small client hooks shared by the analytics charts.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeRM(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRM,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(RM_QUERY).matches : false),
    () => false,
  );
}

/** Observed content-box width of an element (0 until measured). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Animated count toward `value`; jumps instantly under reduced motion. */
export function useCountUp(value: number, duration = 700): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value)) {
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }
    const from = Number.isFinite(fromRef.current) ? fromRef.current : value;
    const start = performance.now();
    const dur = reduced || from === value ? 0 : duration;
    let id = 0;
    const step = (now: number) => {
      const k = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = from + (value - from) * eased;
      fromRef.current = v;
      setDisplay(v);
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [value, duration, reduced]);
  return display;
}
