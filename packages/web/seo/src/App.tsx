import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Config: API base + GA4. The same GA4 tag is reused across Vaayu sites, so we
// always send an explicit page_title / site identifier to distinguish traffic.
// Set VITE_GA4_ID in packages/web/seo/.env (e.g. G-XXXXXXXXXX). Empty = no-op.
// ---------------------------------------------------------------------------
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
const GA4_ID = (import.meta.env.VITE_GA4_ID as string | undefined) ?? "";
const SITE_NAME = "SEO Checkup | seo.vaayulabs.com";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function useGa4() {
  useEffect(() => {
    if (!GA4_ID) return;
    if (document.getElementById("ga4-tag")) return;
    const s = document.createElement("script");
    s.id = "ga4-tag";
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = function (...args: unknown[]) {
      (window.dataLayer as unknown[]).push(args);
    };
    window.gtag("js", new Date());
    // Distinguish this property's traffic from other sites sharing the tag.
    window.gtag("config", GA4_ID, {
      page_title: SITE_NAME,
      page_location: window.location.href,
      page_path: window.location.pathname,
      site: "seo.vaayulabs.com",
    });
  }, []);
}

function track(event: string, params: Record<string, unknown> = {}) {
  try {
    window.gtag?.("event", event, { site: "seo.vaayulabs.com", page_title: SITE_NAME, ...params });
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// Types (mirror backend)
// ---------------------------------------------------------------------------
type Status = "pass" | "warn" | "fail";
interface Check {
  id: string;
  title: string;
  status: Status;
  severity: "HIGH" | "MEDIUM" | "LOW";
  details: string;
  value?: string;
  advice?: string;
}
interface Category {
  key: string;
  title: string;
  score: number;
  failed: number;
  warnings: number;
  passed: number;
  checks: Check[];
}
interface PsiPayload {
  url: string;
  strategy: string;
  score: number;
  metrics: { id: string; title: string; display: string; numeric: number | null; score: number | null }[];
  opportunities: { id: string; title: string; savingsMs: number }[];
}

// Google pass/warn thresholds for lab metrics (mobile).
function psiCheckFor(m: PsiPayload["metrics"][number]): Check | null {
  const s = (status: Status, severity: Check["severity"], details: string, advice: string): Check => ({
    id: `psi-${m.id}`, title: `${m.title} (Google lab)`, status, severity, details, value: m.display, advice,
  });
  switch (m.id) {
    case "largest-contentful-paint": {
      const v = m.numeric ?? Infinity;
      return s(v <= 2500 ? "pass" : v <= 4000 ? "warn" : "fail", "HIGH",
        `Largest Contentful Paint is ${m.display}. Google recommends ≤ 2.5s.`,
        "Compress hero images (WebP/AVIF), preload the LCP image, defer non-critical JS.");
    }
    case "cumulative-layout-shift": {
      const v = m.numeric ?? Infinity;
      return s(v <= 0.1 ? "pass" : v <= 0.25 ? "warn" : "fail", "HIGH",
        `Cumulative Layout Shift is ${m.display}. Google recommends ≤ 0.1.`,
        "Set explicit width/height on images and embeds; reserve space for ads and dynamic content.");
    }
    case "first-contentful-paint": {
      const v = m.numeric ?? Infinity;
      return s(v <= 1800 ? "pass" : v <= 3000 ? "warn" : "fail", "MEDIUM",
        `First Contentful Paint is ${m.display}. Google recommends ≤ 1.8s.`,
        "Reduce server response time, inline critical CSS, defer the rest.");
    }
    case "total-blocking-time": {
      const v = m.numeric ?? Infinity;
      return s(v <= 200 ? "pass" : v <= 600 ? "warn" : "fail", "MEDIUM",
        `Total Blocking Time is ${m.display}. Google recommends ≤ 200ms.`,
        "Split long JS tasks, defer third-party scripts, remove unused JavaScript.");
    }
    case "speed-index": {
      const v = m.numeric ?? Infinity;
      return s(v <= 3400 ? "pass" : v <= 5800 ? "warn" : "fail", "LOW",
        `Speed Index is ${m.display}. Under ~3.4s feels fast.`,
        "Prioritize above-the-fold content; lazy-load everything below it.");
    }
    default:
      return null;
  }
}

function psiCategory(p: PsiPayload): Category {
  const checks: Check[] = [
    {
      id: "psi-score", title: "Google Performance Score (mobile lab)",
      status: p.score >= 90 ? "pass" : p.score >= 50 ? "warn" : "fail",
      severity: "MEDIUM",
      details: `Google Lighthouse lab score is ${p.score}/100 on a simulated mobile device.`,
      value: `${p.score}/100`,
      advice: "Work the metric failures below in order — LCP and CLS move this score most.",
    },
    ...p.metrics.flatMap((m) => (psiCheckFor(m) ? [psiCheckFor(m)!] : [])),
    ...p.opportunities.map((o): Check => ({
      id: `psi-opp-${o.id}`, title: o.title, status: "warn", severity: "LOW",
      details: o.savingsMs > 0 ? `Potential saving of ~${(o.savingsMs / 1000).toFixed(1)}s.` : "Flagged by Google Lighthouse as worth fixing.",
      advice: "Apply the Lighthouse recommendation for this opportunity.",
    })),
  ];
  const pts = checks.reduce((a, x) => a + (x.status === "pass" ? 1 : x.status === "warn" ? 0.5 : 0), 0);
  return {
    key: "pagespeed", title: "Google PageSpeed — lab data (mobile)",
    score: Math.round((pts / Math.max(checks.length, 1)) * 100),
    failed: checks.filter((x) => x.status === "fail").length,
    warnings: checks.filter((x) => x.status === "warn").length,
    passed: checks.filter((x) => x.status === "pass").length,
    checks,
  };
}
interface Report {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  score: number;
  failed: number;
  warnings: number;
  passed: number;
  total: number;
  meta: { title: string; description: string; h1: string; htmlKb: number; loadSeconds: number };
  categories: Category[];
}

// ---------------------------------------------------------------------------
// Small UI atoms
// ---------------------------------------------------------------------------
const C = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  bg: "#f8fafc",
  card: "#ffffff",
  brand: "#4f46e5",
  brandDark: "#4338ca",
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
};

function ScoreRing({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? C.green : score >= 60 ? C.amber : C.red;
  return (
    <div style={{ position: "relative", width: 150, height: 150 }}>
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" stroke={C.line} strokeWidth="12" />
        <circle
          cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ - (circ * score) / 100}
          transform="rotate(-90 75 75)"
          style={{ transition: "stroke-dashoffset .8s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 800, color: C.ink }}>{score}</div>
          <div style={{ fontSize: 12, color: C.muted }}>/ 100</div>
        </div>
      </div>
    </div>
  );
}

function Badge({ status }: { status: Status }) {
  const map = {
    pass: { bg: "#dcfce7", fg: "#15803d", label: "Passed" },
    warn: { bg: "#fef3c7", fg: "#b45309", label: "Warning" },
    fail: { bg: "#fee2e2", fg: "#b91c1c", label: "Failed" },
  } as const;
  const m = map[status];
  return (
    <span style={{ background: m.bg, color: m.fg, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 }}>
      {m.label.toUpperCase()}
    </span>
  );
}

function Sev({ level }: { level: Check["severity"] }) {
  const map = { HIGH: C.red, MEDIUM: C.amber, LOW: C.muted } as const;
  return (
    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: map[level], padding: "3px 8px", borderRadius: 6 }}>
      {level}
    </span>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  useGa4();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [psiLoading, setPsiLoading] = useState(false);
  const [psiError, setPsiError] = useState("");
  const [withPsi, setWithPsi] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<"all" | Status>("all");

  useEffect(() => {
    document.title = SITE_NAME;
  }, []);

  const failedChecks = useMemo(
    () => report?.categories.flatMap((c) => c.checks).filter((x) => x.status === "fail") ?? [],
    [report],
  );

  async function runPsi(target: string) {
    // Runs AFTER the instant report is already on screen, so lab latency
    // never blocks the core results. Failure only shows a note.
    setPsiLoading(true);
    setPsiError("");
    try {
      const res = await fetch(`${API_URL}/pagespeed?url=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `PageSpeed failed (HTTP ${res.status})`);
      const cat = psiCategory(data as PsiPayload);
      setReport((prev) => (prev ? { ...prev, categories: [...prev.categories, cat] } : prev));
      track("seo_pagespeed_complete", { score: (data as PsiPayload).score });
    } catch (err) {
      setPsiError(err instanceof Error ? err.message : "PageSpeed lab data unavailable.");
    } finally {
      setPsiLoading(false);
    }
  }

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const target = url.trim();
    if (!target) {
      setError("Enter a website URL first — e.g. example.com");
      return;
    }
    setLoading(true);
    setError("");
    setReport(null);
    track("seo_check_start", { url: target.slice(0, 120) });
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Check failed (HTTP ${res.status})`);
      setReport(data as Report);
      track("seo_check_complete", {
        url: (data as Report).finalUrl?.slice(0, 120),
        score: (data as Report).score,
      });
      if (withPsi) void runPsi(target);
      window.scrollTo({ top: 560, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink, background: C.bg, minHeight: "100vh" }}>
      {/* header */}
      <header style={{ background: "#fff", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: C.brand, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800 }}>V</div>
          <strong>Vaayu SEO Checkup</strong>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>Free instant audit · seo.vaayulabs.com</span>
        </div>
      </header>

      {/* hero / funnel */}
      <section style={{ background: "linear-gradient(180deg,#312e81,#4f46e5)", color: "#fff" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "52px 20px 44px" }}>
          <h1 style={{ fontSize: 36, margin: "0 0 10px", fontWeight: 800 }}>Free SEO Site Checkup</h1>
          <p style={{ margin: "0 0 24px", opacity: 0.9, maxWidth: 640 }}>
            Enter any website URL to get an instant SEO score across meta tags, speed,
            security, mobile and advanced checks — with exactly what to fix.
          </p>
          <form onSubmit={run} style={{ display: "flex", gap: 10, maxWidth: 640, flexWrap: "wrap" }}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              inputMode="url"
              style={{ flex: 1, minWidth: 240, padding: "13px 16px", borderRadius: 10, border: "none", fontSize: 16 }}
            />
            <button
              type="submit" disabled={loading}
              style={{ background: "#fff", color: C.brandDark, fontWeight: 800, border: "none", borderRadius: 10, padding: "13px 26px", fontSize: 16, cursor: loading ? "wait" : "pointer" }}
            >
              {loading ? "Checking…" : "Check SEO"}
            </button>
          </form>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, opacity: 0.92, cursor: "pointer" }}>
            <input type="checkbox" checked={withPsi} onChange={(e) => setWithPsi(e.target.checked)} />
            Include Google PageSpeed lab data (LCP / CLS, mobile) — free, adds ~20s after instant results
          </label>
          {error && (
            <div style={{ marginTop: 14, background: "#fee2e2", color: "#991b1b", padding: "10px 14px", borderRadius: 8, maxWidth: 640, fontSize: 14 }}>
              {error}
            </div>
          )}
          {loading && <p style={{ opacity: 0.85, fontSize: 14 }}>Fetching page → running 30+ checks → scoring…</p>}
        </div>
      </section>

      {/* report */}
      {report && (
        <main style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 20px 60px" }}>
          {/* score card */}
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 24, display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
            <ScoreRing score={report.score} />
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontSize: 13, color: C.muted }}>SEO Report for</div>
              <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{report.finalUrl}</div>
              <p style={{ color: C.muted, fontSize: 14 }}>
                Your site scored <strong style={{ color: C.ink }}>{report.score}/100</strong>. We found{" "}
                <strong style={{ color: C.red }}>{report.failed} issues to fix</strong>
                {report.warnings > 0 && <> and <strong style={{ color: C.amber }}>{report.warnings} warnings</strong></>} — clearing them is how you move up.
              </p>
              <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
                <span><strong style={{ color: C.red }}>{report.failed}</strong> Failed</span>
                <span><strong style={{ color: C.amber }}>{report.warnings}</strong> Warnings</span>
                <span><strong style={{ color: C.green }}>{report.passed}</strong> Passed</span>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                <button onClick={() => window.print()} style={{ border: `1px solid ${C.line}`, background: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}>
                  Download / Print PDF
                </button>
                <a href={`${API_URL}/analyze`} onClick={(e) => e.preventDefault()} style={{ display: "none" }}>api</a>
              </div>
            </div>
          </div>

          {/* top issues strip */}
          {psiLoading && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 14, padding: "12px 20px", marginTop: 18, fontSize: 14, color: "#1d4ed8" }}>
              Fetching Google PageSpeed lab data… instant results above are ready.
            </div>
          )}
          {psiError && (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 14, padding: "12px 20px", marginTop: 18, fontSize: 14, color: "#92400e" }}>
              PageSpeed lab data skipped: {psiError}
            </div>
          )}
          {failedChecks.length > 0 && (
            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 14, padding: 20, marginTop: 18 }}>
              <strong>Issues to fix ({failedChecks.length})</strong>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14 }}>
                {failedChecks.slice(0, 8).map((x) => (
                  <li key={x.id} style={{ margin: "4px 0" }}>
                    <Sev level={x.severity} /> <a href={`#check-${x.id}`} style={{ color: C.brandDark }}>{x.title}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* filter */}
          <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
            {(["all", "fail", "warn", "pass"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 16px", fontSize: 13,
                  background: filter === f ? C.ink : "#fff", color: filter === f ? "#fff" : C.ink, cursor: "pointer",
                }}
              >
                {f === "all" ? `All (${report.total})` : f === "fail" ? `Failed (${report.failed})` : f === "warn" ? `Warnings (${report.warnings})` : `Passed (${report.passed})`}
              </button>
            ))}
          </div>

          {/* categories */}
          {report.categories.map((cat) => {
            const checks = cat.checks.filter((x) => filter === "all" || x.status === filter);
            if (!checks.length) return null;
            return (
              <section key={cat.key} style={{ marginTop: 26 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <h2 style={{ fontSize: 20, margin: 0 }}>{cat.title}</h2>
                  <span style={{ fontSize: 13, color: C.muted }}>
                    Score {cat.score} · {cat.failed} failed · {cat.warnings} warnings · {cat.passed} passed
                  </span>
                </div>
                <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                  {checks.map((x) => {
                    const isOpen = !!open[x.id];
                    return (
                      <article id={`check-${x.id}`} key={x.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <Sev level={x.severity} />
                          <strong style={{ fontSize: 15 }}>{x.title}</strong>
                          <span style={{ marginLeft: "auto" }}><Badge status={x.status} /></span>
                        </div>
                        <p style={{ fontSize: 14, color: "#334155", margin: "8px 0" }}>{x.details}</p>
                        {x.value && <div style={{ fontSize: 12, color: C.muted }}><code>{x.value}</code></div>}
                        <button
                          onClick={() => setOpen((o) => ({ ...o, [x.id]: !o[x.id] }))}
                          style={{ marginTop: 8, background: "none", border: "none", color: C.brandDark, cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 0 }}
                        >
                          {isOpen ? "Hide fix ▲" : "How to fix ▼"}
                        </button>
                        {isOpen && x.advice && (
                          <div style={{ marginTop: 8, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
                            {x.advice}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <p style={{ marginTop: 28, fontSize: 12, color: C.muted }}>
            Checked {report.total} signals · fetched in {report.meta.loadSeconds}s ({report.meta.htmlKb} KB HTML) · {new Date(report.fetchedAt).toLocaleString()}
          </p>
        </main>
      )}

      {/* empty state / how it works */}
      {!report && !loading && (
        <section style={{ maxWidth: 1080, margin: "0 auto", padding: "36px 20px 64px", display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {[
            ["1. Enter a URL", "Any public http(s) page. We fetch it live — no signup, no auth."],
            ["2. We run 30+ checks", "Meta tags, headings, images, speed, HTTPS/HSTS, mobile, structured data, SPF…"],
            ["3. Fix by priority", "HIGH / MEDIUM / LOW badges with exact how-to-fix steps for each failure."],
          ].map(([t, d]) => (
            <div key={t} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: 20 }}>
              <strong>{t}</strong>
              <p style={{ fontSize: 14, color: C.muted }}>{d}</p>
            </div>
          ))}
        </section>
      )}

      <footer style={{ borderTop: `1px solid ${C.line}`, background: "#fff" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "18px 20px", fontSize: 12, color: C.muted, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>© Vaayu Labs — SEO Checkup</span>
          <span style={{ marginLeft: "auto" }}>seo.vaayulabs.com · API: seo-api.vaayulabs.com</span>
        </div>
      </footer>
    </div>
  );
}
