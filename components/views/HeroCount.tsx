"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useDistrict } from "@/lib/district/store";

/** The command-center hero: one live number, a short label. Updates as the clock moves and transfers land. */
export function HeroCount() {
  const { state, assessments } = useDistrict();
  const reduce = useReducedMotion();
  const urgent = new Set(assessments.filter((a) => a.risk === "stockout" || a.risk === "critical").map((a) => a.facilityId)).size;
  const clinics = state.facilities.filter((f) => f.type !== "WAREHOUSE").length;

  return (
    <header className="hero" aria-live="polite">
      <h1 className="hero__line">
        <span className={`hero__num ${urgent === 0 ? "is-clear" : ""}`} aria-hidden>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={urgent}
              className="hero__digits"
              initial={reduce ? { opacity: 0 } : { y: "40%", opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: "-40%", opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
            >
              {urgent}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="sr-only">{urgent} </span>
        <span className="hero__label">{urgent === 1 ? "clinic runs out before resupply" : "clinics run out before resupply"}</span>
      </h1>
      <p className="hero__ctx">of {clinics} clinics in {state.district.name} district</p>
    </header>
  );
}
