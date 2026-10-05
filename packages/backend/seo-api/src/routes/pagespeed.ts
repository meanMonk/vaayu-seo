import { Hono } from "hono";

/**
 * GET /pagespeed?url=https://example.com
 *
 * Thin proxy over the FREE Google PageSpeed Insights API (no billing, no key
 * required — ~25k req/day keyless; set PAGESPEED_API_KEY for higher quota).
 * Kept separate from /analyze on purpose: lab runs take 15–60s, so the main
 * instant audit stays fast and this is fetched opt-in only.
 */
export const pagespeedRoutes = new Hono();

interface PsiMetric {
  id: string;
  title: string;
  display: string;
  numeric: number | null;
  score: number | null;
}

interface PsiOpportunity {
  id: string;
  title: string;
  savingsMs: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

pagespeedRoutes.get("/", async (c) => {
  const raw = (c.req.query("url") ?? "").trim();
  if (!raw) return c.json({ error: "Pass ?url=https://example.com" }, 400);
  let target: URL;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
    target = new URL(withProto);
  } catch {
    return c.json({ error: "Invalid URL." }, 400);
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return c.json({ error: "Only http(s) URLs are supported." }, 400);
  }

  const key = process.env.PAGESPEED_API_KEY?.trim();
  const api =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(target.toString())}` +
    `&strategy=mobile&category=performance` +
    (key ? `&key=${encodeURIComponent(key)}` : "");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  let data: {
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { title?: string; displayValue?: string; numericValue?: number; score?: number | null; details?: { overallSavingsMs?: number } }>;
    };
    lighthouseVersion?: string;
  };
  try {
    const res = await fetch(api, {
      signal: ctrl.signal,
      headers: { "User-Agent": "VaayuSEOCheckup/1.0 (+https://seo.vaayulabs.com)" },
    });
    if (res.status === 429) {
      return c.json({ error: "Google PageSpeed quota exceeded — try again in a minute." }, 429);
    }
    if (!res.ok) {
      return c.json({ error: `PageSpeed API returned HTTP ${res.status}.` }, 502);
    }
    data = (await res.json()) as typeof data;
  } catch (e) {
    return c.json(
      { error: `PageSpeed request failed (${e instanceof Error ? e.message : "timeout"}).` },
      504,
    );
  } finally {
    clearTimeout(timer);
  }

  const lh = data.lighthouseResult;
  if (!lh) return c.json({ error: "No lab data returned for this URL." }, 502);

  const perfScore = Math.round((lh.categories?.performance?.score ?? 0) * 100);
  const audits = lh.audits ?? {};
  const pick = (id: string): PsiMetric => {
    const a = audits[id] ?? {};
    return {
      id,
      title: a.title ?? id,
      display: a.displayValue ?? "—",
      numeric: num(a.numericValue),
      score: typeof a.score === "number" ? a.score : null,
    };
  };

  const metrics: PsiMetric[] = [
    pick("largest-contentful-paint"),
    pick("cumulative-layout-shift"),
    pick("first-contentful-paint"),
    pick("total-blocking-time"),
    pick("speed-index"),
  ];

  const OPPORTUNITY_IDS = [
    "render-blocking-resources",
    "unused-javascript",
    "unused-css-rules",
    "modern-image-formats",
    "properly-size-images",
    "efficient-animated-content",
    "legacy-javascript",
    "uses-text-compression",
  ];
  const opportunities: PsiOpportunity[] = OPPORTUNITY_IDS.flatMap((id) => {
    const a = audits[id];
    if (!a) return [];
    const savings = num(a.details?.overallSavingsMs) ?? 0;
    if (savings < 100 && (a.score ?? 1) >= 0.9) return [];
    return [{ id, title: a.title ?? id, savingsMs: Math.round(savings) }];
  }).slice(0, 5);

  return c.json({
    url: target.toString(),
    strategy: "mobile",
    score: perfScore,
    lighthouseVersion: data.lighthouseVersion ?? "",
    metrics,
    opportunities,
  });
});

export default pagespeedRoutes;
