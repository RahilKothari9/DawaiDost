"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BatteryMedium, ChevronLeft, ChevronDown, CircleCheck, ClipboardList, CloudUpload, House, MessageSquare, Phone, SignalMedium, X } from "lucide-react";
import { useDistrict } from "@/lib/district/store";
import { facilityChoices, inboxMessages, pharmacistView } from "@/lib/pharmacist/derive";
import { clockHi, facilityHi } from "@/lib/pharmacist/hindi";
import { VoiceConsole } from "@/components/voice/VoiceConsole";
import { HomeScreen } from "./HomeScreen";
import { CheckinScreen, CountScreen } from "./CheckinScreens";
import { DispatchScreen, ReceiveScreen } from "./TransferScreens";
import { InboxScreen } from "./InboxScreen";
import s from "./phone.module.css";

export type Screen =
  | { name: "home" }
  | { name: "checkin"; call?: boolean }
  | { name: "count"; medicineId: string; recount?: boolean }
  | { name: "dispatch"; transferId: string }
  | { name: "receive"; transferId: string }
  | { name: "inbox" };

const TITLES: Record<Screen["name"], { hi: string; en: string }> = {
  home: { hi: "", en: "" },
  checkin: { hi: "हफ़्ते की गिनती", en: "Weekly count" },
  count: { hi: "गिनती लिखें", en: "Enter count" },
  dispatch: { hi: "माल भेजें", en: "Dispatch request" },
  receive: { hi: "माल मिला", en: "Confirm receipt" },
  inbox: { hi: "संदेश", en: "Messages" },
};

const PARENT: Partial<Record<Screen["name"], Screen>> = {
  count: { name: "checkin" },
  dispatch: { name: "home" },
  receive: { name: "home" },
};

/** Last time each facility's inbox was opened in this session (survives client navigation). */
const inboxSeen = new Map<string, number>();
const UNREAD_WINDOW_MS = 3 * 36e5;

const screenKey = (sc: Screen) => [sc.name, "medicineId" in sc ? sc.medicineId : "", "transferId" in sc ? sc.transferId : ""].join(":");

export function PhoneApp({ facilityId, onFacilityChange }: { facilityId: string; onFacilityChange: (id: string) => void }) {
  const { state } = useDistrict();
  const view = useMemo(() => pharmacistView(state, facilityId), [state, facilityId]);
  const messages = useMemo(() => inboxMessages(state, facilityId), [state, facilityId]);
  const choices = useMemo(() => facilityChoices(state), [state]);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [callOpen, setCallOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; hi: string; en: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [seenAt, setSeenAt] = useState(() => inboxSeen.get(facilityId) ?? Date.parse(state.now) - UNREAD_WINDOW_MS);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const a = window.setTimeout(() => setSyncing(false), 900);
    const b = window.setTimeout(() => setToast(null), 3600);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [toast]);

  if (!view) return <div className={s.empty}>Facility not found</div>;

  const go = (next: Screen) => {
    if (next.name === "checkin" && next.call) setCallOpen(true);
    if (next.name === "inbox") {
      const t = Date.parse(state.now);
      inboxSeen.set(facilityId, t);
      setSeenAt(t);
    }
    setScreen(next.name === "checkin" ? { name: "checkin" } : next);
    contentRef.current?.scrollTo({ top: 0 });
  };
  const notify = (hi: string, en: string) => {
    setSyncing(true);
    setToast({ id: Date.now(), hi, en });
  };

  const unread = messages.filter((m) => Date.parse(m.at) > seenAt).length;
  const root = screen.name === "home" || screen.name === "checkin" || screen.name === "inbox";
  const title = TITLES[screen.name];
  const f = view.facility;

  let body: ReactNode;
  switch (screen.name) {
    case "home": body = <HomeScreen view={view} now={state.now} go={go} />; break;
    case "checkin": body = <CheckinScreen view={view} now={state.now} go={go} onCall={() => setCallOpen(true)} />; break;
    case "count": body = <CountScreen view={view} medicineId={screen.medicineId} recount={screen.recount} go={go} notify={notify} />; break;
    case "dispatch": body = <DispatchScreen view={view} transferId={screen.transferId} go={go} notify={notify} />; break;
    case "receive": body = <ReceiveScreen view={view} transferId={screen.transferId} go={go} notify={notify} />; break;
    case "inbox": body = <InboxScreen messages={messages} go={go} />; break;
  }

  return (
    <div className={s.app} lang="hi">
      <div className={s.status} aria-hidden>
        <span>{clockHi(state.now)}</span>
        <span className={s.statusIcons}><SignalMedium /><span>4G</span><BatteryMedium /></span>
      </div>

      <header className={s.appbar}>
        {!root ? (
          <button type="button" className={s.back} onClick={() => go(PARENT[screen.name] ?? { name: "home" })} aria-label="Back">
            <ChevronLeft size={26} aria-hidden />
          </button>
        ) : null}
        <div className={s.appbarTitle}>
          {screen.name === "home" ? (
            <>
              <h1>{facilityHi(f)} <ChevronDown size={16} aria-hidden className={s.switcherHint} /></h1>
              <p>{f.name} · {f.pharmacist.name} · {f.block}</p>
              <label className={s.srOnly} htmlFor="ph-switch">View as facility</label>
              <select id="ph-switch" className={s.switcher} value={facilityId} onChange={(e) => onFacilityChange(e.target.value)}>
                {choices.map((c) => (
                  <option key={c.facility.id} value={c.facility.id}>
                    {c.facility.name} — {c.facility.pharmacist.name}{c.tasks ? ` (${c.tasks})` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <h1>{title.hi}</h1>
              <p>{title.en} · {f.name}</p>
            </>
          )}
        </div>
        <span className={s.sync} data-state={syncing ? "sending" : "synced"} role="status">
          {syncing ? <CloudUpload aria-hidden /> : <CircleCheck aria-hidden />}
          {syncing ? "भेज रहे…" : "सेव"}
        </span>
      </header>

      <div className={s.content} ref={contentRef}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screenKey(screen)}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>

      <nav className={s.nav} aria-label="Pharmacist app">
        <button type="button" className={s.navBtn} aria-current={screen.name === "home" || screen.name === "dispatch" || screen.name === "receive" ? "page" : undefined} onClick={() => go({ name: "home" })}>
          <House aria-hidden />होम<small>Home</small>
          {view.taskCount > 0 ? <span className={s.badge} aria-label={`${view.taskCount} tasks`}>{view.taskCount}</span> : null}
        </button>
        <button type="button" className={s.navBtn} aria-current={screen.name === "checkin" || screen.name === "count" ? "page" : undefined} onClick={() => go({ name: "checkin" })}>
          <ClipboardList aria-hidden />गिनती<small>Count</small>
        </button>
        <button type="button" className={s.navBtn} aria-current={screen.name === "inbox" ? "page" : undefined} onClick={() => go({ name: "inbox" })}>
          <MessageSquare aria-hidden />संदेश<small>Messages</small>
          {unread > 0 ? <span className={s.badge} aria-label={`${unread} new`}>{unread}</span> : null}
        </button>
      </nav>

      <AnimatePresence>
        {toast ? (
          <motion.div key={toast.id} className={s.toast} role="status" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <CircleCheck aria-hidden />
            <div>{toast.hi}<small>{toast.en}</small></div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {callOpen ? (
          <>
            <motion.div key="bd" className={s.sheetBackdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCallOpen(false)} />
            <motion.div
              key="sheet"
              className={s.sheet}
              role="dialog"
              aria-modal="true"
              aria-label="Weekly check-in call"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
            >
              <div className={s.sheetHead}>
                <span className={s.callPulse}><Phone aria-hidden /></span>
                <div style={{ flex: 1 }}>
                  <strong>दवाई दोस्त कॉल</strong>
                  <small>Weekly check-in call · Hindi</small>
                </div>
                <button type="button" className={s.back} onClick={() => setCallOpen(false)} aria-label="Close call"><X size={24} aria-hidden /></button>
              </div>
              <div className={s.sheetBody}>
                <VoiceConsole
                  facilityId={facilityId}
                  initialMode="caller_agent"
                  onReports={(reports) => {
                    setCallOpen(false);
                    notify("कॉल पूरी हुई — गिनती भेज दी गई", `${reports.length} count${reports.length === 1 ? "" : "s"} sent to the district office`);
                  }}
                />
              </div>
              <div className={s.sheetFoot}>
                <button type="button" className={`${s.btn} ${s.block}`} onClick={() => { setCallOpen(false); go({ name: "checkin" }); }}>
                  <ClipboardList aria-hidden />
                  <span className={s.btnStack}>कॉल नहीं, खुद लिखें<small>Type counts instead</small></span>
                </button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
