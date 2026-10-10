import Link from "next/link";
import { ACTION_LABEL, ACTION_ORDER, ACTION_WHEN } from "@/components/shell/format";

const FLOW = [
  { who: "Pharmacist", tool: "OpenAI Realtime API", title: "Voice check-in", body: "A short weekly call in Hindi. The pharmacist says the shelf count. No form, no app, no smartphone needed." },
  { who: "Code", tool: "Deterministic", title: "Count check", body: "The new count is compared with last week's ledger and expected use. If they disagree, a recount is requested." },
  { who: "Code", tool: "Deterministic", title: "Forecast and surplus", body: "Days of stock against lead time plus a safety buffer. Safe surplus at nearby clinics, after each keeps a seven-day reserve." },
  { who: "OpenAI", tool: "Decisions API", title: "One bounded choice", body: "A facts-only snapshot goes in. Exactly one of four district actions comes out, with a probability for each.", ai: true },
  { who: "District officer", tool: "Human", title: "Approval", body: "The officer sees the alert, the evidence and the recommendation. Nothing moves until they approve it." },
];

const FACTS = [
  { n: "35%", body: "of sub-centres reported metformin stockouts in an ICMR survey of 415 facilities across 19 districts. The median stockout lasted seven months.", src: "ICMR / IJMR, 2025", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12178186/" },
  { n: "45%", body: "overall essential-medicine availability in public facilities in Punjab (51% in Haryana), across 80 facilities in 12 districts.", src: "PGIMER and collaborators", href: "https://pubmed.ncbi.nlm.nih.gov/26699711/" },
  { n: "58%", body: "of prescribed generic medicines were actually dispensed at the facility, across 1,290 prescriptions from 100 public facilities in Chhattisgarh.", src: "Chhattisgarh access study", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5958558/" },
  { n: "78→26%", body: "facilities without an antimalarial dosage, after 21 weeks of weekly SMS stock reporting at 129 facilities in Tanzania. Response rate averaged 95%.", src: "SMS for Life pilot", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC2978233/" },
  { n: "<5%", body: "amlodipine stockouts at facilities in the India Hypertension Control Initiative, which paired forecasting and stock tools with programme reforms.", src: "IHCI", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10721057/" },
  { n: "80%", body: "is the WHO reference target for availability of a defined set of essential medicines. Many sampled facilities in these studies fall below it.", src: "WHO access indicators", href: "https://www.who.int/tools/monitoring-and-evaluation/access-indicators" },
];

export function AboutView() {
  return (
    <article className="about">
      <header className="about__hero">
        <h1>The medicine is often already in the district. The information to move it is not.</h1>
        <p>
          Dawai Dost (&ldquo;medicine friend&rdquo;) brings clinic-shelf stock into view with a one-minute Hindi call, lets code do the arithmetic, and lets the OpenAI Decisions API choose
          the next district move from a fixed set. The district health officer approves every action. This prototype runs on a synthetic Sehore district; every clinic, person and
          count in it is fictional.
        </p>
      </header>

      <section className="about__section" aria-labelledby="loop">
        <header>
          <h2 id="loop">The loop</h2>
          <p>Each part of the system does the task it is best at. Code calculates, the model decides among bounded options, and a person approves.</p>
        </header>
        <ol className="flow">
          {FLOW.map((s, i) => (
            <li key={s.title} className={`flow__step ${s.ai ? "flow__step--ai" : ""}`}>
              <span className="flow__n">0{i + 1}</span>
              <span className="flow__who">{s.who} · {s.tool}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="about__section" aria-labelledby="actions">
        <header>
          <h2 id="actions">Four actions, and only four</h2>
          <p>
            The Decisions API answers one <code>choice</code> question. The response is always one valid action plus a probability for each, so there is no free text to parse and no
            invented action. The server rejects anything else and falls back to a labeled deterministic answer.
          </p>
        </header>
        <div className="choices" role="list">
          {ACTION_ORDER.map((a, i) => (
            <div className="choice" role="listitem" key={a}>
              <span className="choice__n">0{i + 1}</span>
              <span className="choice__name">{ACTION_LABEL[a]}</span>
              <code className="choice__code">{a}</code>
              <p className="choice__when">{ACTION_WHEN[a]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="about__section" aria-labelledby="division">
        <header>
          <h2 id="division">Who is responsible for what</h2>
          <p>A language model must not invent stock numbers, and a transfer needs an accountable person.</p>
        </header>
        <div className="split3">
          <div>
            <h3>Deterministic code</h3>
            <p>Days of stock, safe surplus, the donor reserve rule, recount checks. Exact arithmetic that is easy to audit and covered by tests.</p>
          </div>
          <div className="is-ai">
            <h3>Decisions API</h3>
            <p>Choosing the right response needs judgement across many signals. A closed choice set keeps the output safe; per-choice probabilities give the officer a confidence signal.</p>
          </div>
          <div>
            <h3>District officer</h3>
            <p>Approves or rejects. Every report, recommendation and approval lands on the activity log with a time and an owner.</p>
          </div>
        </div>
      </section>

      <section className="about__section" aria-labelledby="research">
        <header>
          <h2 id="research">Why this problem</h2>
          <p>India&apos;s supply systems track what leaves the warehouse. The data stops at the clinic door, and the first person to find a stockout is often a patient.</p>
        </header>
        <div className="facts">
          {FACTS.map((f) => (
            <div className="fact" key={f.src}>
              <span className="fact__n num">{f.n}</span>
              <p className="fact__copy">
                {f.body}
                <a className="fact__src" href={f.href} target="_blank" rel="noreferrer">{f.src}</a>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="about__section" aria-labelledby="stack">
        <header>
          <h2 id="stack">The OpenAI stack</h2>
          <p>Every external call has a labeled fallback, so the demo always runs and never shows fallback data as live.</p>
        </header>
        <table className="stack-table">
          <tbody>
            <tr>
              <th scope="row">Decisions API</th>
              <td>Picks one of four district actions from a facts-only snapshot and returns a probability for each. Model <code>gpt-6-luna</code>. Server route <code>POST /api/decisions</code>.</td>
            </tr>
            <tr>
              <th scope="row">Realtime API</th>
              <td>The Hindi voice check-in over WebRTC, using a short-lived client secret minted on the server. Model <code>gpt-realtime-2.1</code>. The API key never reaches the browser.</td>
            </tr>
            <tr>
              <th scope="row">Fallbacks</th>
              <td>Missing key, upstream error or a malformed answer returns a deterministic recommendation from the same stock rules, marked <code>demo_fallback</code> with a reason.</td>
            </tr>
            <tr>
              <th scope="row">Scope</th>
              <td>Synthetic data. Approvals change the dashboard only; nothing contacts a clinic, submits an order or dispatches medicine.</td>
            </tr>
          </tbody>
        </table>
        <p className="about__note">
          See it end to end on the <Link href="/" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>command center</Link>: one call, one forecast, one decision, one approval.
        </p>
      </section>
    </article>
  );
}
