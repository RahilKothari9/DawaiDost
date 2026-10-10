"use client";
// WebRTC Realtime connection hook: mints a role-specific client secret, wires mic + remote audio,
// exposes analysers for the orb/meter, and guarantees cleanup of peer connection and mic tracks.
import { useCallback, useEffect, useRef } from "react";
import type { SessionResponse, VoiceFacts, VoiceMode } from "@/lib/voice/types";

export type RealtimeFailure = "mic_denied" | "mic_unavailable" | "session_unavailable" | "connect_failed" | "timeout" | "api_error";

export class RealtimeError extends Error {
  constructor(public kind: RealtimeFailure, message?: string) {
    super(message ?? kind);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RealtimeServerEvent = { type: string; [key: string]: any };

export type ConnectOptions = {
  mode: VoiceMode;
  facilityId?: string;
  facts: VoiceFacts;
  mic: boolean;
  onEvent: (event: RealtimeServerEvent) => void;
  onDisconnect?: () => void;
};

export type Analysers = { mic: AnalyserNode | null; out: AnalyserNode | null };

const CONNECT_TIMEOUT_MS = 12_000;

export function useRealtimeCall() {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Analysers>({ mic: null, out: null });
  const sessionRef = useRef<SessionResponse | null>(null);
  const generationRef = useRef(0);

  const disconnect = useCallback(() => {
    generationRef.current += 1;
    try { channelRef.current?.close(); } catch { /* already closed */ }
    try { peerRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch { /* ignore */ }
    try { peerRef.current?.close(); } catch { /* ignore */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    void ctxRef.current?.close().catch(() => undefined);
    channelRef.current = null;
    peerRef.current = null;
    micRef.current = null;
    ctxRef.current = null;
    analysersRef.current = { mic: null, out: null };
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  const send = useCallback((event: Record<string, unknown>) => {
    const ch = channelRef.current;
    if (ch?.readyState === "open") {
      ch.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }, []);

  const connect = useCallback(async (opts: ConnectOptions): Promise<SessionResponse> => {
    disconnect();
    const generation = generationRef.current;
    const stale = () => generation !== generationRef.current;

    // 1. Mic first, so a permission denial fails fast and cleanly.
    let mic: MediaStream | null = null;
    if (opts.mic) {
      if (!navigator.mediaDevices?.getUserMedia) throw new RealtimeError("mic_unavailable", "This browser has no microphone access.");
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        throw new RealtimeError(name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : "mic_unavailable");
      }
      if (stale()) { mic.getTracks().forEach((t) => t.stop()); throw new RealtimeError("connect_failed", "cancelled"); }
      micRef.current = mic;
    }

    // 2. Role-specific client secret from our server (API key never reaches the browser).
    let session: SessionResponse;
    try {
      const res = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: opts.mode, facilityId: opts.facilityId, facts: opts.facts }),
      });
      if (!res.ok) throw new Error(String(res.status));
      session = await res.json();
    } catch {
      disconnect();
      throw new RealtimeError("session_unavailable");
    }
    if (stale()) throw new RealtimeError("connect_failed", "cancelled");
    sessionRef.current = session;

    // 3. Audio graph for the orb + mic meter.
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const ctx = AudioCtx ? new AudioCtx() : null;
    ctxRef.current = ctx;
    if (ctx && mic) {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      ctx.createMediaStreamSource(mic).connect(a);
      analysersRef.current.mic = a;
    }

    // 4. Peer connection.
    const peer = new RTCPeerConnection();
    peerRef.current = peer;
    if (mic) mic.getAudioTracks().forEach((t) => peer.addTrack(t, mic!));
    else peer.addTransceiver("audio", { direction: "recvonly" });

    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.autoplay = true;
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        void audioRef.current.play().catch(() => undefined);
      }
      if (ctx && stream) {
        const a = ctx.createAnalyser();
        a.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(a);
        analysersRef.current.out = a;
        void ctx.resume().catch(() => undefined);
      }
    };
    peer.onconnectionstatechange = () => {
      if ((peer.connectionState === "failed" || peer.connectionState === "disconnected") && !stale()) opts.onDisconnect?.();
    };

    const channel = peer.createDataChannel("oai-events");
    channelRef.current = channel;
    channel.onmessage = (e) => {
      if (stale()) return;
      try { opts.onEvent(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };
    const opened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new RealtimeError("timeout")), CONNECT_TIMEOUT_MS);
      channel.onopen = () => { window.clearTimeout(timer); resolve(); };
      channel.onclose = () => { window.clearTimeout(timer); if (!stale()) opts.onDisconnect?.(); };
    });

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdp.ok) throw new RealtimeError("connect_failed");
      if (stale()) throw new RealtimeError("connect_failed", "cancelled");
      await peer.setRemoteDescription({ type: "answer", sdp: await sdp.text() });
      await opened;
    } catch (err) {
      if (!stale()) disconnect();
      throw err instanceof RealtimeError ? err : new RealtimeError("connect_failed");
    }
    return session;
  }, [disconnect]);

  return { connect, disconnect, send, setMicEnabled, analysersRef, sessionRef };
}
