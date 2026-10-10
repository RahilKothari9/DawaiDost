// Shared voice-layer contract (client + server). Zod schemas validate anything that crosses the network.
import { z } from "zod";

export const VOICE_MODES = ["pharmacist_sim", "caller_agent", "availability"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const MedicineFactSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  strength: z.string().max(40).default(""),
  unit: z.string().max(60).default("units"),
  hindiName: z.string().max(80).optional(),
  lastCount: z.number().nonnegative().max(1e6),
  dailyUse: z.number().nonnegative().max(1e5),
  /** Expected shelf count today = last count − use since last report (+ known receipts). */
  expected: z.number().nonnegative().max(1e6),
  expectedMin: z.number().nonnegative().max(1e6),
  expectedMax: z.number().nonnegative().max(1e6),
  /** Ground-truth count the simulated pharmacist reports (pharmacist_sim only). */
  shelfCount: z.number().nonnegative().max(1e6).optional(),
  lastReportAt: z.string().max(40).optional(),
});
export type MedicineFact = z.infer<typeof MedicineFactSchema>;

export const FacilityRefSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  block: z.string().max(60).default(""),
  type: z.string().max(20).default("PHC"),
  pharmacistName: z.string().max(80).default("Pharmacist"),
  language: z.string().max(8).default("hi"),
});
export type FacilityRef = z.infer<typeof FacilityRefSchema>;

export const DirectorySchema = z.object({
  facilities: z.array(z.object({ id: z.string().max(64), name: z.string().max(80), block: z.string().max(60).default("") })).max(200),
  medicines: z.array(z.object({ id: z.string().max(64), name: z.string().max(80), strength: z.string().max(40).default(""), hindiName: z.string().max(80).optional() })).max(200),
});
export type Directory = z.infer<typeof DirectorySchema>;

export const VoiceFactsSchema = z.object({
  facility: FacilityRefSchema.optional(),
  medicines: z.array(MedicineFactSchema).max(24).optional(),
  directory: DirectorySchema.optional(),
  districtName: z.string().max(60).optional(),
  now: z.string().max(40).optional(),
});
export type VoiceFacts = z.infer<typeof VoiceFactsSchema>;

export const SessionRequestSchema = z.object({
  mode: z.enum(VOICE_MODES).optional(),
  facilityId: z.string().max(64).optional(),
  facts: VoiceFactsSchema.optional(),
});
export type SessionRequest = z.infer<typeof SessionRequestSchema>;

export type SessionResponse = {
  clientSecret: string;
  mode: VoiceMode | "legacy";
  model: string;
  transcriptionModel: string | null;
  instructions: string;
  tools: string[];
};

export type Speaker = "agent" | "pharmacist" | "caller" | "tool" | "system";

export type TranscriptLine = {
  id: string;
  speaker: Speaker;
  text: string;
  gloss?: string;
  final: boolean;
  at: number; // ms epoch
};

export const TranscriptLineInputSchema = z.object({
  speaker: z.enum(["agent", "pharmacist", "caller", "tool", "system"]),
  text: z.string().max(4000),
});

export const ExtractRequestSchema = z.object({
  facts: VoiceFactsSchema.extend({ facility: FacilityRefSchema, medicines: z.array(MedicineFactSchema).min(1).max(24) }),
  transcript: z.union([z.string().max(20000), z.array(TranscriptLineInputSchema).max(200)]),
  language: z.string().max(8).optional(),
});
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;

export type ExtractSource = "live" | "fallback";

export type ExtractResponse = {
  reports: import("../district/types").VoiceReport[];
  source: ExtractSource;
  model?: string;
  fallbackReason?: string;
  englishSummary?: string;
};

export type CaptureState = "pending" | "asking" | "heard" | "confirmed" | "recount";

export type Capture = {
  medicineId: string;
  state: CaptureState;
  count?: number;
  note?: string;
};
