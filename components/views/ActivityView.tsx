"use client";
import { Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useDistrict } from "@/lib/district/store";
import type { TimelineEvent, TimelineKind } from "@/lib/district/types";
import { Button, EmptyState, Panel } from "@/components/ui";
import { KIND_LABEL, fmtAgo, fmtDateTime } from "@/components/shell/format";
import { useLookups } from "@/components/shell/useLookups";
import { ViewHeader } from "./parts";

const isAi = (actor: string) => /decisions api|openai|model/i.test(actor);

function actorGroup(actor: string): string {
  if (isAi(actor)) return "Decisions API";
  if (/\(dho\)|officer/i.test(actor)) return "District officer";
  if (/pharmacist/i.test(actor)) return "Pharmacists";
  return "System and code";
}

function toCsv(rows: TimelineEvent[], facilityName: (id?: string) => string, medicineName: (id?: string) => string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["time_iso", "kind", "title", "detail", "facility", "medicine", "actor"];
  const body = rows.map((e) => [e.at, e.kind, e.title, e.detail ?? "", e.facilityId ? facilityName(e.facilityId) : "", e.medicineId ? medicineName(e.medicineId) : "", e.actor].map(esc).join(","));
  return [head.join(","), ...body].join("\n");
}

export function ActivityView() {
  const { state } = useDistrict();
  const L = useLookups();
  const [kinds, setKinds] = useState<Set<TimelineKind>>(new Set());
  const [facility, setFacility] = useState("");
  const [medicine, setMedicine] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");

  const kindCounts = useMemo(() => {
    const m = new Map<TimelineKind, number>();
    state.timeline.forEach((e) => m.set(e.kind, (m.get(e.kind) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.timeline]);
  const actorGroups = useMemo(() => [...new Set(state.timeline.map((e) => actorGroup(e.actor)))].sort(), [state.timeline]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.timeline.filter(
      (e) =>
        (!kinds.size || kinds.has(e.kind)) &&
        (!facility || e.facilityId === facility) &&
        (!medicine || e.medicineId === medicine) &&
        (!actor || actorGroup(e.actor) === actor) &&
        (!needle || `${e.title} ${e.detail ?? ""} ${e.actor}`.toLowerCase().includes(needle)),
    );
  }, [state.timeline, kinds, facility, medicine, actor, q]);

  const toggleKind = (k: TimelineKind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows, L.facilityName, L.medicineName)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dawai-dost-${state.district.name.toLowerCase()}-activity-${state.now.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = kinds.size || facility || medicine || actor || q;

  return (
    <div className="view">
      <ViewHeader
        kicker="Accountability record"
        title="Every step has a time and an owner"
        lede="Reports, count checks, recommendations, approvals and deliveries, newest first. Decisions API entries keep the exact snapshot that was sent, so any recommendation can be audited later."
        actions={<Button icon={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export {rows.length} as CSV</Button>}
      />

      <div className="filters" role="search">
        <label className="field field--grow">
          <Search size={15} aria-hidden />
          <span className="sr-only">Search the log</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, details, people" />
        </label>
        <label className="field">
          <span className="sr-only">Facility</span>
          <select value={facility} onChange={(e) => setFacility(e.target.value)}>
            <option value="">All facilities</option>
            {state.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">Medicine</span>
          <select value={medicine} onChange={(e) => setMedicine(e.target.value)}>
            <option value="">All medicines</option>
            {state.medicines.map((m) => <option key={m.id} value={m.id}>{m.name} {m.strength}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">Actor</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Everyone</option>
            {actorGroups.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={() => { setKinds(new Set()); setFacility(""); setMedicine(""); setActor(""); setQ(""); }}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="chips" aria-label="Event types">
        {kindCounts.map(([k, n]) => (
          <button key={k} type="button" className={`chip ${k === "decision" ? "chip--decision" : ""}`} aria-pressed={kinds.has(k)} onClick={() => toggleKind(k)}>
            {KIND_LABEL[k] ?? k} <span className="num">{n}</span>
          </button>
        ))}
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState title="No events match these filters" compact>Clear a filter or search for a clinic or pharmacist name.</EmptyState>
          </div>
        ) : (
          <>
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Type</th>
                    <th scope="col">What happened</th>
                    <th scope="col">Where</th>
                    <th scope="col">Who</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="ledger__time">{fmtDateTime(e.at)}<small>{fmtAgo(e.at, state.now)}</small></td>
                      <td><span className="ledger__kind"><i className={`feed__dot feed__dot--${e.kind}`} aria-hidden />{KIND_LABEL[e.kind] ?? e.kind}</span></td>
                      <td className="ledger__what"><strong>{e.title}</strong>{e.detail ? <span>{e.detail}</span> : null}</td>
                      <td>{e.facilityId ? L.facilityName(e.facilityId) : "—"}{e.medicineId ? <span className="muted" style={{ display: "block", fontSize: 12 }}>{L.medicineName(e.medicineId)}</span> : null}</td>
                      <td className={`ledger__actor ${isAi(e.actor) ? "is-ai" : ""}`}>{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ol className="ledger-cards feed" style={{ padding: "4px 14px" }}>
              {rows.map((e) => (
                <li key={e.id} className="feed__item">
                  <time className="feed__time" dateTime={e.at}>{fmtDateTime(e.at).split(", ").pop()}</time>
                  <i className={`feed__dot feed__dot--${e.kind}`} aria-hidden />
                  <div>
                    <p className="feed__title">{e.title}</p>
                    {e.detail ? <p className="feed__meta">{e.detail}</p> : null}
                    <p className={`feed__meta ${isAi(e.actor) ? "ledger__actor is-ai" : ""}`}>{KIND_LABEL[e.kind]} · {e.actor} · {fmtAgo(e.at, state.now)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </Panel>
    </div>
  );
}
