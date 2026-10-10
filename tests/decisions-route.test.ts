import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/decisions/route";
import { initialClinics } from "../lib/scenario";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/decisions", () => {
  it("returns a labeled demo result when credentials are not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const response = await POST(new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinics: initialClinics }),
    }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.source).toBe("demo_fallback");
    expect(result.action).toBe("transfer_surplus");
    expect(result.fallbackReason).toBe("missing_api_key");
  });

  it("maps a live Decisions API choice and its option probabilities", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: [{
        name: "next_action",
        type: "choice",
        choice: "transfer_surplus",
        confidence: 0.82,
        probabilities: [
          { value: "verify_count", probability: 0.05 },
          { value: "transfer_surplus", probability: 0.82 },
          { value: "draft_indent", probability: 0.09 },
          { value: "escalate_supply_gap", probability: 0.04 },
        ],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const response = await POST(new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinics: initialClinics }),
    }));
    const result = await response.json();
    expect(result.source).toBe("live");
    expect(result.action).toBe("transfer_surplus");
    expect(result.probabilities.transfer_surplus).toBe(0.82);
  });

  it("rejects malformed requests", async () => {
    const response = await POST(new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    }));
    expect(response.status).toBe(400);
  });

  it("falls back transparently when the upstream API rejects the request", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "No credits remaining." },
    }), { status: 429, headers: { "Content-Type": "application/json" } })));
    const response = await POST(new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinics: initialClinics }),
    }));
    const result = await response.json();
    expect(result.source).toBe("demo_fallback");
    expect(result.fallbackReason).toBe("upstream_unavailable");
  });
});
