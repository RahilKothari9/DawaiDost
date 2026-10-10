"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, MapPin, Truck, X } from "lucide-react";
import { useState } from "react";
import { DistrictMap } from "@/components/map/DistrictMap";
import { useDistrict } from "@/lib/district/store";
import type { Transfer, TransferStatus } from "@/lib/district/types";
import { Badge, Button } from "@/components/ui";
import { TRANSFER_LABEL, fmtAgo, fmtDateTime, fmtPct } from "@/components/shell/format";
import { useLookups } from "@/components/shell/useLookups";
import { TransferFlowMini } from "@/components/map/TransferFlowMini";
import { DecisionMark, ViewHeader } from "./parts";

const COLUMNS: { status: TransferStatus; hint: string }[] = [
  { status: "proposed", hint: "Drafted from a recommendation, waiting for you" },
  { status: "approved", hint: "Approved, waiting for a vehicle" },
  { status: "in_transit", hint: "On the road" },
  { status: "delivered", hint: "Received and counted" },
];

export function TransfersView() {
  const { state } = useDistrict();
  const [focus, setFocus] = useState<string | null>(null);
  const by = (s: TransferStatus) => state.transfers.filter((t) => t.status === s).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const moving = by("in_transit");
  const units = moving.reduce((n, t) => n + t.quantity, 0);
  const rejected = by("rejected");

  return (
    <div className="view">
      <ViewHeader
        kicker="Medicine that already exists in the district, moved to where it is needed"
        title="Transfers"
        lede={`${moving.length} ${moving.length === 1 ? "transfer is" : "transfers are"} on the road carrying ${units} units. A donor clinic never drops below its own reserve; that rule is in code, not in the model.`}
      />
      <div className="mapview__frame transfers-map">
        <DistrictMap variant="compact" height={340} selectedTransferId={focus} onSelectTransfer={setFocus} defaultLayers={{ transfers: true }} />
      </div>

      <div className="kanban">
        {COLUMNS.map((c) => {
          const items = by(c.status);
          return (
            <section key={c.status} className={`kcol kcol--${c.status}`} aria-label={TRANSFER_LABEL[c.status]}>
              <header className="kcol__head">
                <h2><i aria-hidden />{TRANSFER_LABEL[c.status]}</h2>
                <span className="kcol__count num">{items.length}</span>
              </header>
              <AnimatePresence initial={false}>
                {items.map((t) => (
                  <motion.div key={t.id} layout layoutId={`tcard-${t.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <TransferCard t={t} focused={focus === t.id} onFocus={() => setFocus((f) => (f === t.id ? null : t.id))} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {items.length === 0 ? <p className="kcol__empty">{c.hint}. Nothing here right now.</p> : null}
            </section>
          );
        })}
      </div>
      {rejected.length ? (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>{rejected.length} rejected</summary>
          <ul className="rejected-list" style={{ marginTop: 8 }}>
            {rejected.map((t) => <RejectedRow key={t.id} t={t} />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function RejectedRow({ t }: { t: Transfer }) {
  const L = useLookups();
  return <li>{t.quantity} × {L.medicineName(t.medicineId)} · {L.facilityName(t.fromId)} → {L.facilityName(t.toId)} · {fmtDateTime(t.updatedAt)}</li>;
}

function TransferCard({ t, focused, onFocus }: { t: Transfer; focused: boolean; onFocus: () => void }) {
  const { state, dispatch } = useDistrict();
  const L = useLookups();
  const med = L.medicine(t.medicineId);
  const decision = t.decisionId ? state.decisions.find((d) => d.id === t.decisionId) : state.decisions.find((d) => d.transferId === t.id);
  const set = (status: TransferStatus) => dispatch({ type: "SET_TRANSFER_STATUS", transferId: t.id, status });
  const dispatchedAt = t.dispatchedAt ?? t.updatedAt;
  const elapsedH = (new Date(state.now).getTime() - new Date(dispatchedAt).getTime()) / 36e5;
  const pct = t.status === "in_transit" ? Math.max(0, Math.min(1, elapsedH / Math.max(1, t.etaHours))) : t.status === "delivered" ? 1 : 0;
  const etaLeft = Math.max(0, t.etaHours - elapsedH);

  return (
    <article className={`tcard tcard--${t.status} ${focused ? "is-focused" : ""}`}>
      <div className="tcard__med">
        <strong>{med ? `${med.name} ${med.strength}` : t.medicineId}</strong>
        <span className="tcard__qty">{t.quantity}<small>{med?.unit.split(" ")[0] ?? "units"}s</small></span>
      </div>
      <TransferFlowMini transferId={t.id} className="tcard__flow" />
      <div className="tcard__meta">
        {t.status === "in_transit" ? <span><span className="num">{fmtPct(pct)}</span> of the way · <span className="num">{etaLeft.toFixed(1)}h</span> left</span> : null}
        {t.status === "delivered" ? <span>Delivered {fmtAgo(t.deliveredAt ?? t.updatedAt, state.now)}</span> : null}
        {t.reason ? <span>{t.reason}</span> : null}
      </div>
      <div className="tcard__foot">
        {decision ? (
          <Link
            href="/decisions"
            className="tcard__dlink"
            onClick={() => {
              dispatch({ type: "SELECT_FACILITY", facilityId: decision.facilityId });
              dispatch({ type: "SELECT_MEDICINE", medicineId: decision.medicineId });
            }}
          >
            <DecisionMark label={`${fmtPct(decision.confidence)} · ${decision.source === "live" ? "live" : "fallback"}`} />
          </Link>
        ) : (
          <Badge>Manual</Badge>
        )}
        <div className="tcard__actions">
          <Button size="sm" variant="ghost" aria-pressed={focused} aria-label={focused ? "Clear map highlight" : "Show on map"} title={focused ? "Clear map highlight" : "Show on map"} icon={<MapPin size={14} />} onClick={onFocus} />
          {t.status === "proposed" ? (
            <>
              <Button size="sm" variant="ghost" aria-label="Reject transfer" icon={<X size={14} />} onClick={() => set("rejected")} />
              <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => set("approved")}>Approve</Button>
            </>
          ) : t.status === "approved" ? (
            <Button size="sm" variant="decision" icon={<Truck size={14} />} onClick={() => set("in_transit")}>Dispatch</Button>
          ) : t.status === "in_transit" ? (
            <Button size="sm" icon={<Check size={14} />} onClick={() => set("delivered")}>Mark delivered</Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
