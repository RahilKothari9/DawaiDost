import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Realtime credentials are not configured." }, { status: 503 });

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1",
          output_modalities: ["audio"],
          audio: { output: { voice: "marin" } },
          instructions: "You are role-playing a fictional PHC pharmacist in Sehore district, India, during a stock-taking call. Speak briefly and naturally in Hindi. The caller asks about Metformin 500 mg. Use only these supplied facts: 16 strips are on the shelf, the count has been physically confirmed, the clinic dispenses about 8 strips per day, and district resupply usually takes 5 days. Confirm these figures when asked. Do not invent other counts, make medical recommendations, or decide what the district should do. This is a clearly simulated demo conversation.",
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: "Could not start the Realtime session." }, { status: 502 });
    const clientSecret = payload.value ?? payload.client_secret?.value;
    if (!clientSecret) return NextResponse.json({ error: "Realtime did not return a client secret." }, { status: 502 });
    return NextResponse.json({ clientSecret });
  } catch {
    return NextResponse.json({ error: "Could not start the Realtime session." }, { status: 502 });
  }
}
