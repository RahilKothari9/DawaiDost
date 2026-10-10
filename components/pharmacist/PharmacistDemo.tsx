"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, PackageOpen, RotateCcw, Truck } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { facilityChoices } from "@/lib/pharmacist/derive";
import { facilityHi } from "@/lib/pharmacist/hindi";
import { PhoneApp } from "./PhoneApp";
import d from "./demo.module.css";

/** Facility being impersonated; module scope so it survives client navigation to officer views and back. */
const memory = new Map<"facilityId", string>();

function ago(iso: string, now: string) {
  const mins = Math.round((Date.parse(now) - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function PharmacistDemo() {
  const { state } = useDistrict();
  const [facilityId, setFacilityIdState] = useState(() => memory.get("facilityId") ?? "saraswati");
  const setFacilityId = (id: string) => { memory.set("facilityId", id); setFacilityIdState(id); };
  const choices = useMemo(() => {
    const all = facilityChoices(state);
    const typeRank = { PHC: 0, CHC: 1, DH: 2, WAREHOUSE: 3 } as const;
    return [...all].sort((a, b) => b.tasks - a.tasks || typeRank[a.facility.type] - typeRank[b.facility.type] || a.facility.name.localeCompare(b.facility.name));
  }, [state]);
  const current = state.facilities.find((f) => f.id === facilityId);
  const feed = state.timeline.slice(0, 6);
  const inTransit = state.transfers.filter((t) => t.status === "in_transit").length;
  const awaitingDispatch = state.transfers.filter((t) => t.status === "approved").length;

  return (
    <div className={d.stage}>
      <aside className={d.side} aria-label="Demo controls">
        <p className={d.eyebrow}>Dawai Dost · Pharmacist app</p>
        <h1 className={d.title}>The clinic end of the loop</h1>
        <p className={d.lede}>
          What a PHC pharmacist sees on a basic Android phone: Hindi first, big numbers, one task at a time.
          It shares live state with the district officer&apos;s desk.
        </p>

        <div className={d.pickerHead}>
          <span>View as</span>
          {current ? <strong>{current.name} — {current.pharmacist.name}</strong> : null}
        </div>
        <ul className={d.picker} role="listbox" aria-label="Facility to view as">
          {choices.map((c) => (
            <li key={c.facility.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.facility.id === facilityId}
                className={d.pick}
                onClick={() => setFacilityId(c.facility.id)}
              >
                <span className={d.pickName}>
                  {c.facility.name}
                  <small>{c.facility.pharmacist.name} · {facilityHi(c.facility)}</small>
                </span>
                <span className={d.pickTags}>
                  {c.dispatch ? <span className={d.tag} data-tone="moving" title="Approved transfer to dispatch"><PackageOpen aria-hidden />{c.dispatch} send</span> : null}
                  {c.receive ? <span className={d.tag} data-tone="moving" title="Consignment in transit to this clinic"><Truck aria-hidden />{c.receive} arriving</span> : null}
                  {c.recount ? <span className={d.tag} data-tone="warn" title="Recount requested"><RotateCcw aria-hidden />recount</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className={d.phoneWrap}>
        <div className={d.phone}>
          <div className={d.notch} aria-hidden />
          <div className={d.screen}>
            <PhoneApp key={facilityId} facilityId={facilityId} onFacilityChange={setFacilityId} />
          </div>
        </div>
      </div>

      <aside className={d.side} aria-label="Officer view in sync">
        <p className={d.eyebrow}>In sync with the officer</p>
        <h2 className={d.subtitle}>One shared record</h2>
        <p className={d.lede}>
          Every tap here writes to the same district store the officer uses. A dispatch starts the truck on the map; a receipt
          count updates stock and closes the transfer; a short count raises a discrepancy and a recount at the sender.
        </p>
        <div className={d.stats}>
          <div><b>{awaitingDispatch}</b><span>approved, waiting to be packed</span></div>
          <div><b>{inTransit}</b><span>consignments on the road</span></div>
        </div>
        <div className={d.links}>
          <Link href="/decisions">Decisions <ArrowUpRight aria-hidden /></Link>
          <Link href="/transfers">Transfers <ArrowUpRight aria-hidden /></Link>
          <Link href="/map">District map <ArrowUpRight aria-hidden /></Link>
        </div>
        <p className={d.feedHead}>Officer timeline, live</p>
        <ol className={d.feed}>
          {feed.map((e) => (
            <li key={e.id} data-mine={e.actor.includes("pharmacist") || undefined}>
              <span className={d.feedTitle}>{e.title}</span>
              <span className={d.feedMeta}>{e.actor} · {ago(e.at, state.now)}</span>
            </li>
          ))}
        </ol>
        <p className={d.fine}>Synthetic demo data. Facilities, people and counts are fictional.</p>
      </aside>
    </div>
  );
}
