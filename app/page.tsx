"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowLeftRight, ArrowUpRight, AudioLines, BadgeCheck,
  Bell, Check, ChevronDown, CircleHelp, Clock3, FileText, HeartPulse, MapPin,
  MoreHorizontal, PackageCheck, PhoneCall, Play, RotateCcw, ShieldCheck, Sparkles,
  TriangleAlert, Volume2, Waves,
} from "lucide-react";
import { actionLabels, daysOfStock, getFallbackDecision, initialClinics, transferableSurplus, type Clinic, type DecisionAction } from "@/lib/scenario";
import { requestDecision, type DecisionResult } from "@/lib/decision-client";

type TranscriptLine = { speaker: "caller" | "pharmacist"; text: string };

const callerPrompts = [
  "नमस्ते, Dawai Dost से कॉल है। मेटफॉर्मिन 500 mg की कितनी स्ट्रिप्स बची हैं?",
  "क्या आपने गिनती दोबारा जांची है? रोज़ लगभग कितनी स्ट्रिप्स दी जाती हैं?",
  "अगली सप्लाई आने में कितना समय लगता है? धन्यवाद, हमने आपकी रिपोर्ट दर्ज कर ली है।",
];

const sampleTranscript: TranscriptLine[] = [
  { speaker: "caller", text: callerPrompts[0] },
  { speaker: "pharmacist", text: "अभी 16 स्ट्रिप्स हैं। मैंने गिनती दोबारा जांच ली है।" },
  { speaker: "caller", text: callerPrompts[1] },
  { speaker: "pharmacist", text: "रोज़ करीब 8 स्ट्रिप्स जाती हैं।" },
  { speaker: "caller", text: callerPrompts[2] },
  { speaker: "pharmacist", text: "नई सप्लाई में लगभग 5 दिन लगते हैं। धन्यवाद।" },
];

const actionIcons: Record<DecisionAction, typeof ShieldCheck> = {
  verify_count: ShieldCheck,
  transfer_surplus: ArrowLeftRight,
  draft_indent: FileText,
  escalate_supply_gap: TriangleAlert,
};

const actionNotes: Record<DecisionAction, string> = {
  verify_count: "Ask the pharmacist to recount before changing the district plan.",
  transfer_surplus: "Kalyanpur can spare 45 strips and remain above its 7-day reserve.",
  draft_indent: "Prepare a consumption-based indent while checking available supply.",
  escalate_supply_gap: "Alert the district store that clinic demand exceeds available stock.",
};

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export default function Home() {
  const [clinics, setClinics] = useState<Clinic[]>(initialClinics);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [callState, setCallState] = useState<"idle" | "connecting" | "live" | "demo" | "complete">("idle");
  const [decision, setDecision] = useState<DecisionResult | null>(null);
  const [decisionState, setDecisionState] = useState<"idle" | "thinking" | "complete">("idle");
  const [approved, setApproved] = useState(false);
  const [errorNote, setErrorNote] = useState("");
  const [now, setNow] = useState("09:42");
  const audioRef = useRef<HTMLAudioElement>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const promptIndexRef = useRef(0);
  const agentTextRef = useRef("");
  const completeCallRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const update = () => setNow(new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const runDecision = useCallback(async (currentClinics: Clinic[]) => {
    setDecisionState("thinking");
    setApproved(false);
    try {
      const result = await requestDecision(currentClinics);
      setDecision(result);
      if (result.source === "demo_fallback") {
        setErrorNote(result.fallbackReason === "unexpected_response"
          ? "The live decision could not be parsed. Showing a labeled demo fallback."
          : result.fallbackReason === "upstream_unavailable"
            ? "The live decision service returned an error. Showing a labeled demo fallback."
            : "Live credentials are unavailable. Showing a labeled demo fallback.");
      }
    } catch {
      setDecision(getFallbackDecision(currentClinics));
      setErrorNote("Could not reach the decision service. Showing a labeled demo fallback.");
    }
    setDecisionState("complete");
  }, []);

  const finishCall = useCallback((isLive: boolean) => {
    setCallState(isLive ? "complete" : "demo");
    const fixedCounts = initialClinics.map((clinic) => ({ ...clinic }));
    setClinics(fixedCounts);
    void runDecision(fixedCounts);
  }, [runDecision]);

  useEffect(() => {
    completeCallRef.current = () => finishCall(true);
  }, [finishCall]);

  const closeRealtime = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
  }, []);

  useEffect(() => () => closeRealtime(), [closeRealtime]);

  const startDemoFallback = useCallback(() => {
    closeRealtime();
    setTranscript(sampleTranscript);
    setCallState("demo");
    setErrorNote("Realtime voice is unavailable; using the clearly labeled sample call.");
    const fixedCounts = initialClinics.map((clinic) => ({ ...clinic }));
    setClinics(fixedCounts);
    void runDecision(fixedCounts);
  }, [closeRealtime, runDecision]);

  const startCall = useCallback(async () => {
    closeRealtime();
    setTranscript([]);
    setDecision(null);
    setDecisionState("idle");
    setErrorNote("");
    setApproved(false);
    promptIndexRef.current = 0;
    agentTextRef.current = "";
    setCallState("connecting");

    try {
      const tokenResponse = await fetch("/api/realtime/session", { method: "POST" });
      if (!tokenResponse.ok) throw new Error("Realtime session unavailable");
      const { clientSecret } = await tokenResponse.json();
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => undefined);
        }
      };
      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      const connectionTimer: { id?: number } = {};

      const sendPrompt = (index: number) => {
        promptIndexRef.current = index;
        agentTextRef.current = "";
        const prompt = callerPrompts[index];
        setTranscript((current) => [...current, { speaker: "caller", text: prompt }]);
        channel.send(JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] },
        }));
        channel.send(JSON.stringify({ type: "response.create", response: { output_modalities: ["audio"] } }));
      };

      channel.onopen = () => {
        if (connectionTimer.id) window.clearTimeout(connectionTimer.id);
        setCallState("live");
        channel.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            model: "gpt-realtime-2.1",
            output_modalities: ["audio"],
            audio: { output: { voice: "marin" } },
            instructions: "Role-play the fictional Saraswati PHC pharmacist in Hindi. Answer each question briefly and warmly. Facts are fixed: 16 strips of Metformin 500 mg, recount confirmed, about 8 strips dispensed daily, and resupply takes about 5 days. Do not invent quantities, recommend medical care, or choose a district action. This is a simulated demo call.",
          },
        }));
        window.setTimeout(() => sendPrompt(0), 450);
      };
      channel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "error") {
          startDemoFallback();
          return;
        }
        if (message.type === "response.output_audio_transcript.delta" || message.type === "response.output_text.delta") {
          agentTextRef.current += message.delta ?? "";
          setTranscript((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (last?.speaker === "pharmacist") last.text = agentTextRef.current;
            else next.push({ speaker: "pharmacist", text: agentTextRef.current });
            return next;
          });
        }
        if (message.type === "response.done") {
          const nextIndex = promptIndexRef.current + 1;
          if (nextIndex < callerPrompts.length && channel.readyState === "open") {
            window.setTimeout(() => sendPrompt(nextIndex), 500);
          } else {
            completeCallRef.current();
          }
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) throw new Error("Could not connect Realtime audio");
      await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      connectionTimer.id = window.setTimeout(() => {
        if (channel.readyState !== "open") startDemoFallback();
      }, 12_000);
    } catch {
      startDemoFallback();
    }
  }, [closeRealtime, startDemoFallback]);

  const resetScenario = useCallback(() => {
    closeRealtime();
    setClinics(initialClinics.map((clinic) => ({ ...clinic })));
    setTranscript([]);
    setCallState("idle");
    setDecision(null);
    setDecisionState("idle");
    setApproved(false);
    setErrorNote("");
  }, [closeRealtime]);

  const action = decision?.action;
  const ActionIcon = action ? actionIcons[action] : Sparkles;
  const targetClinic = clinics.find((clinic) => clinic.id === "saraswati") ?? clinics[0];
  const donorClinic = clinics.find((clinic) => clinic.id === "kalyanpur") ?? clinics[1];
  const nearbySurplus = transferableSurplus(donorClinic.stock, donorClinic.dailyUse);
  const transferQuantity = Math.min(24, nearbySurplus);
  const callRunning = callState === "connecting" || callState === "live";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="Dawai Dost home">
          <span className="brand-mark"><HeartPulse size={21} strokeWidth={2.2} /></span>
          <span className="brand-copy"><strong>dawai dost</strong><small>LAST-MILE RESPONSE</small></span>
        </a>
        <div className="workspace-switch"><span className="district-avatar">S</span><span><strong>Sehore district</strong><small>Madhya Pradesh, India</small></span><ChevronDown size={15} /></div>
        <p className="nav-label">OPERATIONS</p>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><Activity size={17} /><span>Overview</span><span className="nav-count">03</span></a>
          <a className="nav-item" href="#clinics"><PackageCheck size={17} /><span>Clinic stock</span></a>
          <a className="nav-item" href="#decision"><ArrowLeftRight size={17} /><span>Transfer desk</span><span className="nav-dot" /></a>
          <a className="nav-item" href="#timeline"><Clock3 size={17} /><span>Activity log</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="coverage-card"><div className="coverage-top"><span>WEEKLY COVERAGE</span><span>86%</span></div><div className="coverage-track"><span /></div><p>6 of 7 clinics reported this week</p></div>
          <a className="help-link" href="#about"><CircleHelp size={16} /> How Dawai Dost works</a>
          <div className="profile-row"><div className="profile-avatar">AK</div><div><strong>Ananya Kulkarni</strong><small>District health officer</small></div><MoreHorizontal size={18} /></div>
        </div>
      </aside>

      <section className="main-area" id="top">
        <header className="topbar">
          <div className="breadcrumb">District operations <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-right"><span className="system-live"><i /> System live</span><button className="icon-button" aria-label="Notifications"><Bell size={17} /><i /></button><span className="today-label">SAT, 10 OCT</span></div>
        </header>

        <div className="page-content" id="overview">
          <div className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" /> DISTRICT HEALTH NETWORK</div><h1>Good morning, Ananya<span>.</span></h1><p className="intro-copy">A clear view of what’s running low — and what you can do about it.</p></div>
            <button className="reset-button" onClick={resetScenario}><RotateCcw size={15} /> Reset demo</button>
          </div>

          <div className="metric-grid">
            <article className="metric-card"><div className="metric-icon mint"><PackageCheck size={17} /></div><span className="metric-label">CLINICS IN SCENARIO</span><div className="metric-value">3<span className="metric-muted"> / 3</span></div><div className="metric-foot"><span className="trend good"><Check size={12} /> Reports received</span><span>this week</span></div></article>
            <article className="metric-card"><div className="metric-icon coral"><TriangleAlert size={17} /></div><span className="metric-label">CLINICS NEEDING ACTION</span><div className="metric-value">02</div><div className="metric-foot"><span className="status-chip danger"><i /> Needs attention</span><span>metformin at risk</span></div></article>
            <article className="metric-card"><div className="metric-icon blue"><ArrowLeftRight size={17} /></div><span className="metric-label">TRANSFERABLE SURPLUS</span><div className="metric-value">45<span className="metric-muted"> strips</span></div><div className="metric-foot"><span className="trend good"><ArrowDownRight size={13} /> 1 clinic</span><span>can help today</span></div></article>
            <article className="metric-card"><div className="metric-icon gold"><Clock3 size={17} /></div><span className="metric-label">MEDIAN RESPONSE TIME</span><div className="metric-value">1.8<span className="metric-muted"> days</span></div><div className="metric-foot"><span className="trend good"><ArrowDownRight size={13} /> 0.4 days</span><span>this month</span></div></article>
          </div>

          <div className="section-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> NEEDS YOUR ATTENTION</div><h2>One clinic needs a plan</h2></div><button className="text-button">View all alerts <ArrowUpRight size={14} /></button></div>

          <div className="work-grid">
            <section className="case-card" id="clinics">
              <div className="case-topline"><span className="case-tag"><i /> STOCKOUT RISK</span><span className="case-time"><Clock3 size={13} /> Updated {now}</span></div>
              <div className="case-title-row"><div><h3>Metformin 500 mg</h3><p>Essential medicines · NCD program</p></div><button className="more-button" aria-label="More case options"><MoreHorizontal size={19} /></button></div>
              <div className="case-summary"><div className="clinic-emblem">SP</div><div className="clinic-title"><strong>{targetClinic.name}</strong><span><MapPin size={12} /> Sehore block · 18 km from district store</span></div><div className="stock-stat"><strong>{targetClinic.stock} <small>strips</small></strong><span>on the shelf</span></div></div>
              <div className="stock-visual"><div className="stock-visual-head"><span>ESTIMATED DAYS OF STOCK</span><strong>{daysOfStock(targetClinic.stock, targetClinic.dailyUse).toFixed(1)} days</strong></div><div className="stock-bar"><span /></div><div className="stock-markers"><span>Today</span><span className="threshold-label">Resupply + buffer · 8 days</span></div></div>
              <div className="case-facts"><div><span>DAILY USE</span><strong>~{targetClinic.dailyUse} strips</strong></div><div><span>RESUPPLY LEAD</span><strong>5 days</strong></div><div><span>REPORT CHECK</span><strong className="confirmed"><BadgeCheck size={14} /> Confirmed</strong></div></div>
              <div className="case-footer"><div className="reporter"><div className="reporter-avatar">RM</div><span><strong>R. Mishra</strong><small>Pharmacist · voice report</small></span></div><span className="report-freshness"><i /> Today, 09:42</span></div>
            </section>

            <section className={`decision-card ${decisionState === "thinking" ? "is-thinking" : ""}`} id="decision">
              <div className="decision-head"><div className="decision-orb"><Sparkles size={17} /></div><div className="decision-title"><strong>OpenAI Decisions API</strong><span>GPT-6 Luna <i /> Live decision layer</span></div><span className="beta-pill">BETA</span></div>
              {decisionState === "idle" && <div className="decision-empty"><div className="decision-spark"><AudioLines size={23} /></div><h3>Let’s make the next move clear.</h3><p>Start the stock call. The Decisions API will weigh the verified count, supply risk, and nearby surplus to recommend a next step.</p><div className="choice-preview"><span>VERIFY</span><span>TRANSFER</span><span>REORDER</span><span>ESCALATE</span></div><button className="primary-button call-button" onClick={startCall} disabled={callRunning}><PhoneCall size={16} /> Start stock call <span className="button-shortcut">~ 30 sec</span></button><p className="human-note"><ShieldCheck size={13} /> Your approval is required before any action.</p></div>}
              {decisionState === "thinking" && <div className="decision-loading"><div className="thinking-ring"><Waves size={21} /></div><h3>Weighing the next step</h3><p>Comparing stock cover, lead time, and transferable surplus.</p><div className="thinking-lines"><i /><i /><i /></div></div>}
              {decisionState === "complete" && decision && <div className="decision-result">
                <div className={`result-source ${decision.source}`}><i /> {decision.source === "live" ? "LIVE API RESULT" : "DEMO FALLBACK"}<span>{decision.source === "live" ? "Decision API response" : "Sample response"}</span></div>
                <div className="recommended-action"><div className="action-icon"><ActionIcon size={19} /></div><div><span>RECOMMENDED NEXT ACTION</span><h3>{action ? actionLabels[action] : "Review this case"}</h3></div><div className="confidence"><strong>{formatPercent(decision.confidence)}</strong><span>confidence</span></div></div>
                {decision.confidence < 0.65 && <div className="review-flag"><TriangleAlert size={14} /> Low confidence — review the evidence before choosing.</div>}
                <p className="decision-rationale">{action ? actionNotes[action] : "Review the available evidence."}</p>
                <div className="probability-title"><span>OPTION PROBABILITIES</span><span>Decisions API · choice</span></div>
                <div className="probability-list">{(Object.keys(actionLabels) as DecisionAction[]).map((key) => <div className={`probability-row ${key === action ? "selected" : ""}`} key={key}><span className="probability-name">{actionLabels[key]}</span><div className="probability-track"><i style={{ width: `${Math.max(2, decision.probabilities[key] * 100)}%` }} /></div><strong>{formatPercent(decision.probabilities[key])}</strong></div>)}</div>
                {action === "transfer_surplus" && <div className={`transfer-draft ${approved ? "approved" : ""}`}><div className="transfer-route"><div className="route-point donor"><span>K</span><i /><div><strong>{donorClinic.name}</strong><small>{nearbySurplus} strips transferable</small></div></div><div className="route-arrow"><ArrowLeftRight size={15} /></div><div className="route-point recipient"><span>S</span><i /><div><strong>{targetClinic.name}</strong><small>{daysOfStock(targetClinic.stock, targetClinic.dailyUse).toFixed(1)} days of stock</small></div></div></div><div className="draft-bottom"><div><span>PROPOSED TRANSFER</span><strong>{transferQuantity} strips <small>· bridge quantity</small></strong></div><button className={approved ? "approved-button" : "approve-button"} onClick={() => setApproved(true)} disabled={approved}>{approved ? <><Check size={14} /> Approved</> : <>Review & approve <ArrowUpRight size={14} /></>}</button></div></div>}
                {action !== "transfer_surplus" && <div className="secondary-action"><div><span>NEXT STEP</span><strong>{action ? actionNotes[action] : "Review recommended action."}</strong></div><button onClick={() => setApproved(true)} disabled={approved}>{approved ? <><Check size={14} /> Acknowledged</> : "Acknowledge"}</button></div>}
                <p className="human-note result-note"><ShieldCheck size={13} /> Recommendation only · district officer approval required.</p>
              </div>}
              {errorNote && <div className="inline-notice"><CircleHelp size={13} /> {errorNote}</div>}
            </section>
          </div>

          <div className="lower-grid">
            <section className="network-card" id="timeline">
              <div className="panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" /> LOCAL NETWORK</div><h2>Nearby clinic stock</h2></div><button className="more-button" aria-label="More network options"><MoreHorizontal size={19} /></button></div>
              {clinics.filter((clinic) => clinic.id !== targetClinic.id).map((clinic) => {
                const stockDays = daysOfStock(clinic.stock, clinic.dailyUse);
                const surplus = transferableSurplus(clinic.stock, clinic.dailyUse);
                const canSupport = surplus > 0;
                return <div className="network-row" key={clinic.id}><div className={`network-clinic-icon ${canSupport ? "donor" : "risk"}`}>{clinic.name.charAt(0)}</div><div className="network-clinic"><strong>{clinic.name}</strong><span>Metformin 500 mg · {clinic.stock} strips</span></div><span className={`days-badge ${canSupport ? "safe" : "risk"}`}>{stockDays.toFixed(1)} days</span><div className="network-status"><i className={canSupport ? "green-dot" : "red-dot"} /> {canSupport ? "Can support" : "At risk"}</div></div>;
              })}
              <div className="network-foot"><span><i className="green-dot" /> Surplus is calculated after a 7-day reserve.</span><button className="text-button">Open stock register <ArrowUpRight size={13} /></button></div>
            </section>

            <section className={`call-card ${callRunning ? "call-active" : ""}`}>
              <div className="call-card-head"><div><div className="eyebrow small"><span className="eyebrow-line" /> VOICE CHECK-IN</div><h2>Pharmacist call</h2></div><span className={`call-state-badge ${callState}`}>{callState === "live" ? <><i /> LIVE</> : callState === "connecting" ? "CONNECTING" : callState === "demo" ? "SAMPLE" : callState === "complete" ? <><Check size={12} /> COMPLETE</> : "READY"}</span></div>
              <div className="call-profile"><div className="call-person">RM<span className="online-dot" /></div><div><strong>R. Mishra</strong><span>Saraswati PHC pharmacist</span></div><div className="audio-bars" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div></div>
              {transcript.length > 0 ? <div className="transcript-box" aria-live="polite">{transcript.map((line, index) => <div className={`transcript-line ${line.speaker}`} key={`${line.speaker}-${index}`}><span>{line.speaker === "caller" ? "DAWAI DOST" : "R. MISHRA"}</span><p>{line.text || "…"}</p></div>)}</div> : <div className="call-placeholder"><div className="sound-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><p>A short Hindi check-in confirms stock, usage, and resupply timing.</p></div>}
              <div className="call-card-footer"><span><ShieldCheck size={13} /> Simulated AI voice · fictional clinic</span>{callState === "idle" || callState === "demo" || callState === "complete" ? <button className="mini-call-button" onClick={startCall} disabled={callRunning}>{callState === "complete" || callState === "demo" ? <RotateCcw size={13} /> : <Play size={13} />}{callState === "complete" || callState === "demo" ? "Replay" : "Start call"}</button> : <span className="call-duration"><Volume2 size={13} /> {callState === "live" ? "Speaking" : "Connecting"}</span>}</div>
            </section>
          </div>

          <section className="timeline-strip"><div className="timeline-icon"><Clock3 size={16} /></div><div className="timeline-copy"><strong>Accountability timeline</strong><span>Voice report received · Count confirmed · {decision ? "Decision returned" : "Waiting for the next decision"}</span></div><div className="timeline-stamp">{now} IST</div><button className="text-button">View activity <ArrowUpRight size={13} /></button></section>

          <footer className="page-footer"><span>DAWAI DOST <i /> LAST-MILE MEDICINE RESPONSE</span><span>Prototype · synthetic clinic data <i /> <a href="#about">About this demo</a></span></footer>
        </div>
      </section>
      <audio ref={audioRef} autoPlay />
    </main>
  );
}
