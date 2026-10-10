// OWNER: find agent. Request validation for /api/find/*.
import { z } from "zod";

const Band = z.enum(["available", "low", "out"]);

export const FindSnapshotSchema = z.object({
  now: z.string().min(10).max(40),
  facilities: z.array(z.object({
    id: z.string().max(60), name: z.string().max(80), type: z.string().max(20), block: z.string().max(40),
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  })).max(200),
  rows: z.array(z.object({ f: z.string().max(60), m: z.string().max(60), band: Band, at: z.string().max(40), verified: z.boolean() })).max(5000),
  inbound: z.array(z.object({ f: z.string().max(60), m: z.string().max(60), arrivesAt: z.string().max(40), status: z.enum(["approved", "in_transit"]) })).max(500),
  reports: z.array(z.object({ f: z.string().max(60), m: z.string().max(60), at: z.string().max(40) })).max(500),
  upstream: z.record(z.string(), z.enum(["available", "delayed", "unavailable"])),
});

export const OriginSchema = z.object({
  kind: z.enum(["facility", "village", "gps"]),
  id: z.string().max(60),
  homeFacilityId: z.string().max(60),
  lat: z.number(),
  lng: z.number(),
});

export const AskFieldsSchema = z.object({
  text: z.string().max(400).optional(),
  lang: z.enum(["hi", "en"]).default("hi"),
  snapshot: FindSnapshotSchema,
  origin: OriginSchema.nullable().optional(),
});

export type AskFields = z.infer<typeof AskFieldsSchema>;

export type AskResponse = {
  transcript: string;
  medicineIds: string[];
  conditionId: string | null;
  place: { kind: "facility" | "village" | "block"; id: string } | null;
  answerText: string | null; // null when we still need the medicine or the place
  needs: "medicine" | "place" | null;
  source: { transcribe: "live" | "typed"; parse: "live" | "fallback" };
  fallbackReason?: string;
};
