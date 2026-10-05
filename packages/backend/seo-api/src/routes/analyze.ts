import { Hono } from "hono";
import * as cheerio from "cheerio";

export const analyzeRoutes = new Hono();

export type Status = "pass" | "warn" | "fail";
export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface Check {
  id: string;
  title: string;
  status: Status;
  severity: Severity;
  details: string;
  value?: string;
  advice?: string;
}

export interface Category {
  key: string;
  title: string;
  score: number;
  failed: number;
  warnings: number;
  passed: number;
  checks: Check[];
}

const UA =
  "Mozilla/5.0 (compatible; VaayuSEOCheckup/1.0; +https://seo.vaayulabs.com)";

function normalizeUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

async function fetchWithTimeout(
  url: string,
  ms = 20000,
  init: RequestInit = {},
): Promise<{ res: Response; text: string; ms: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*", ...(init.headers ?? {}) },
      redirect: "follow",
    });
    const text = await res.text().catch(() => "");
    return { res, text, ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

async function urlOk(url: string, ms = 8000): Promise<{ ok: boolean; status: number }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: ctrl.signal,
        headers: { "User-Agent": UA },
        redirect: "follow",
      });
      if (res.status === 405 || res.status === 501) {
        const g = await fetch(url, {
          signal: ctrl.signal,
          headers: { "User-Agent": UA, Range: "bytes=0-0" },
          redirect: "follow",
        });
        return { ok: g.status < 400, status: g.status };
      }
      return { ok: res.status < 400, status: res.status };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return { ok: false, status: 0 };
  }
}

function scoreOf(checks: Check[]): number {
  if (!checks.length) return 100;
  const pts = checks.reduce((a, c) => a + (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  return Math.round((pts / checks.length) * 100);
}

async function hasSpf(domain: string): Promise<boolean | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT`,
        { signal: ctrl.signal },
      );
      if (!res.ok) return null;
      const j = (await res.json()) as { Answer?: { data: string }[] };
      const txts = (j.Answer ?? []).map((a) => a.data).join(" ");
      return txts.includes("v=spf1");
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

analyzeRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const raw = String(body?.url ?? "").trim();
  if (!raw) return c.json({ error: "Provide a website URL, e.g. https://example.com" }, 400);

  let target: URL;
  try {
    target = new URL(normalizeUrl(raw));
  } catch {
    return c.json({ error: "Invalid URL. Include the domain, e.g. https://example.com" }, 400);
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    return c.json({ error: "Only http(s) URLs are supported." }, 400);
  }

  const started = Date.now();
  let html = "";
  let headers = new Headers();
  let finalUrl = target.toString();
  let loadMs = 0;
  let fetchStatus = 0;
  try {
    const { res, text, ms } = await fetchWithTimeout(target.toString(), 25000);
    html = text;
    headers = res.headers;
    finalUrl = res.url || target.toString();
    loadMs = ms;
    fetchStatus = res.status;
  } catch (e) {
    return c.json({ error: `Could not fetch that URL (${e instanceof Error ? e.message : "timeout"}). Is the site online?` }, 422);
  }
  if (fetchStatus >= 400 || !html) {
    return c.json({ error: `The site responded with HTTP ${fetchStatus}. Try another URL.` }, 422);
  }

  const $ = cheerio.load(html);
  const host = target.hostname;
  const isHttps = target.protocol === "https:";
  const htmlKb = Buffer.byteLength(html, "utf8") / 1024;
  const h = (name: string) => headers.get(name) ?? "";

  const get = <T,>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  // ---- shared facts ----
  const title = get(() => $("title").first().text().trim(), "");
  const metaDesc = get(() => $('meta[name="description"]').attr("content")?.trim() ?? "", "");
  const h1s = get(() => $("h1").toArray(), []);
  const h2count = get(() => $("h2").length, 0);
  const imgs = get(() => $("img").toArray(), []);
  const imgsNoAlt = imgs.filter((el) => {
    const a = $(el).attr("alt");
    return !a || !a.trim();
  }).length;
  const imgsModern = imgs.filter((el) => /(\.webp|\.avif)(\?|$)/i.test($(el).attr("src") ?? "")).length;
  const imgsSrcset = imgs.filter((el) => $(el).attr("srcset")).length;
  const linksBlank = get(() => $('a[target="_blank"]').toArray(), []);
  const linksUnsafe = linksBlank.filter((el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    return !rel.includes("noopener") && !rel.includes("noreferrer");
  }).length;
  const deprecatedCount = get(
    () => $("strike,u,font,center,marquee,tt,big,acronym,applet,basefont").length,
    0,
  );
  const domNodes = get(() => $("*").length, 0);
  const scripts = get(() => $("script[src]").toArray(), []);
  const stylesheets = get(() => $('link[rel="stylesheet"]').toArray(), []);
  const renderBlocking = get(
    () =>
      [
        ...stylesheets.filter((el) => {
          const media = ($(el).attr("media") ?? "all").toLowerCase();
          const onload = $(el).attr("onload");
          return media !== "print" && !onload;
        }),
        ...get(() => $("head script[src]").toArray(), []).filter((el) => {
          return !($(el).attr("async") !== undefined || $(el).attr("defer") !== undefined);
        }),
      ].length,
    0,
  );
  const estRequests = scripts.length + stylesheets.length + imgs.length + 1;
  const mixedCount = isHttps
    ? get(() => $(`[src^="http://"],[href^="http://"]`).length, 0)
    : 0;
  const emailsFound = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html);
  const mailtoCount = get(() => $('a[href^="mailto:"]').length, 0);
  const viewport = get(() => $('meta[name="viewport"]').attr("content") ?? "", "");
  const charset = get(() => $('meta[charset]').attr("charset") ?? $('meta[http-equiv="Content-Type" i]').attr("content") ?? "", "");
  const canonical = get(() => $('link[rel="canonical"]').attr("href") ?? "", "");
  const robotsMeta = get(() => $('meta[name="robots" i]').attr("content")?.toLowerCase() ?? "", "");
  const metaRefresh = get(() => $('meta[http-equiv="refresh" i]').length > 0, false);
  const structuredCount = get(() => $('script[type="application/ld+json"]').length, 0);
  const hasHsts = !!h("strict-transport-security");
  const encoding = (h("content-encoding") || "").toLowerCase();
  const hasCompression = encoding.includes("br") || encoding.includes("gzip") || encoding.includes("zstd");
  const hasAnalytics = /googletagmanager\.com|google-analytics\.com\/|analytics\.js|gtag\(/i.test(html);
  const faviconLink = get(() => $('link[rel*="icon"]').attr("href") ?? "", "");
  const usesMediaQueries = /@media\s*\(/i.test(html);
  const langAttr = get(() => $("html").attr("lang") ?? "", "");

  const [robots, sitemap, favicon, wwwAlt, spf] = await Promise.all([
    urlOk(`${target.origin}/robots.txt`),
    (async () => {
      const r = await urlOk(`${target.origin}/sitemap.xml`);
      if (r.ok) return r;
      return urlOk(`${target.origin}/sitemap_index.xml`);
    })(),
    faviconLink
      ? urlOk(new URL(faviconLink, target.origin).toString())
      : urlOk(`${target.origin}/favicon.ico`),
    (async () => {
      const alt = host.startsWith("www.") ? host.slice(4) : "www." + host;
      return urlOk(`${target.protocol}//${alt}/`);
    })(),
    hasSpf(host.replace(/^www\./, "")),
  ]);

  const common: Check[] = [
    {
      id: "meta-title", title: "Meta Title Test",
      status: !title ? "fail" : title.length > 70 ? "warn" : "pass",
      severity: "MEDIUM",
      details: !title ? "This page has no <title> tag — search engines and tabs show a bare URL." : `Title (${title.length} chars): “${title.slice(0, 120)}”. Keep it under ~60–70 characters.`,
      value: title.slice(0, 120) || "missing",
      advice: "Add a unique, keyword-led <title> under 60 characters on every page.",
    },
    {
      id: "meta-description", title: "Meta Description Test",
      status: !metaDesc ? "fail" : metaDesc.length > 160 || metaDesc.length < 50 ? "warn" : "pass",
      severity: "MEDIUM",
      details: !metaDesc ? "No meta description found — Google invents the snippet for you." : `Description (${metaDesc.length} chars): “${metaDesc.slice(0, 160)}”. Aim for 50–160 characters.`,
      value: metaDesc.slice(0, 160) || "missing",
      advice: "Write a 120–155 character description with the primary keyword and a call to action.",
    },
    {
      id: "headings", title: "Heading Tags Test",
      status: h1s.length === 0 ? "fail" : h2count > 10 ? "warn" : "pass",
      severity: "MEDIUM",
      details: h1s.length === 0 ? "No H1 tag found — search engines lose the main topic signal." : h2count > 10 ? `Found ${h2count} H2 tags — that many can dilute topical focus. Keep it under ~10.` : `1 H1 + ${h2count} H2 tags — clean hierarchy.`,
      value: `${h1s.length} H1 / ${h2count} H2`,
      advice: "Use exactly one H1 per page and fewer than 10 H2s.",
    },
    {
      id: "keywords-usage", title: "Keywords Usage Test",
      status: !title && !metaDesc ? "fail" : "pass",
      severity: "LOW",
      details: "Title, description and headings carry the page's main terms. Keyword stuffing is not required — natural placement wins.",
      advice: "Place the primary keyword in the title, one H1 and early body copy — naturally.",
    },
    {
      id: "robots-txt", title: "Robots.txt Test",
      status: robots.ok ? "pass" : "fail",
      severity: "MEDIUM",
      details: robots.ok ? `robots.txt found (HTTP ${robots.status}) at /robots.txt.` : "No reachable /robots.txt — crawlers get no guidance.",
      value: robots.ok ? `HTTP ${robots.status}` : "missing",
      advice: "Publish a robots.txt that allows key sections and points to your sitemap.",
    },
    {
      id: "sitemap", title: "Sitemap Test",
      status: sitemap.ok ? "pass" : "fail",
      severity: "MEDIUM",
      details: sitemap.ok ? `XML sitemap found (HTTP ${sitemap.status}).` : "No XML sitemap found at /sitemap.xml — discovery is slower.",
      value: sitemap.ok ? `HTTP ${sitemap.status}` : "missing",
      advice: "Generate an XML sitemap and reference it in robots.txt + Search Console.",
    },
    {
      id: "img-alt", title: "Image Alt Test",
      status: imgs.length === 0 ? "pass" : imgsNoAlt > 0 ? "fail" : "pass",
      severity: "MEDIUM",
      details: imgs.length === 0 ? "No images on this page." : imgsNoAlt > 0 ? `${imgsNoAlt} of ${imgs.length} images have empty or missing alt text.` : `All ${imgs.length} images have alt text.`,
      value: `${imgs.length - imgsNoAlt}/${imgs.length} with alt`,
      advice: "Give every informative image a short, descriptive alt attribute.",
    },
    {
      id: "responsive-images", title: "Responsive Image Test",
      status: imgs.length === 0 ? "pass" : imgsSrcset === 0 ? "warn" : "pass",
      severity: "LOW",
      details: imgs.length === 0 ? "No images on this page." : imgsSrcset === 0 ? `0 of ${imgs.length} images use srcset/sizes — mobiles download desktop-sized files.` : `${imgsSrcset} of ${imgs.length} images use srcset.`,
      advice: "Serve responsive images with srcset + sizes so phones download smaller files.",
    },
    {
      id: "deprecated-tags", title: "Deprecated HTML Tags Test",
      status: deprecatedCount > 0 ? "fail" : "pass",
      severity: "LOW",
      details: deprecatedCount > 0 ? `Found ${deprecatedCount} deprecated tags (<strike>, <u>, <font>, <center>…).` : "No deprecated HTML tags found.",
      value: String(deprecatedCount),
      advice: "Replace <font>/<center>/<strike>/<u> with CSS equivalents.",
    },
    {
      id: "favicon", title: "Favicon Test",
      status: favicon.ok ? "pass" : "fail",
      severity: "LOW",
      details: favicon.ok ? "Favicon resolves — tabs and bookmarks look branded." : "No reachable favicon — browser tabs show a generic icon.",
      advice: "Add /favicon.ico plus a 180px apple-touch-icon.",
    },
    {
      id: "analytics", title: "Google Analytics Test",
      status: hasAnalytics ? "pass" : "warn",
      severity: "LOW",
      details: hasAnalytics ? "Google Analytics / Tag Manager detected." : "No GA/GTM snippet detected — you are flying blind on traffic.",
      advice: "Install GA4 (via Tag Manager) on every template.",
    },
  ];

  const speed: Check[] = [
    {
      id: "html-size", title: "HTML Page Size Test",
      status: htmlKb > 200 ? "fail" : htmlKb > 100 ? "warn" : "pass",
      severity: "MEDIUM",
      details: `HTML document is ${htmlKb.toFixed(1)} KB. Keep it under ~100 KB for fast first paint.`,
      value: `${htmlKb.toFixed(1)} KB`,
      advice: "Trim inline CSS/JS, paginate long pages, enable compression.",
    },
    {
      id: "dom-size", title: "DOM Size Test",
      status: domNodes > 1500 ? "fail" : domNodes > 900 ? "warn" : "pass",
      severity: "LOW",
      details: `DOM has ${domNodes.toLocaleString()} nodes (recommended ≤ 1,500). Large DOMs slow rendering and JS.`,
      value: domNodes.toLocaleString() + " nodes",
      advice: "Simplify markup: fewer wrappers, virtualize long lists, lazy-render below the fold.",
    },
    {
      id: "compression", title: "HTML Compression Test",
      status: hasCompression ? "pass" : "fail",
      severity: "MEDIUM",
      details: hasCompression ? `Response uses ${encoding || "compressed"} encoding — good.` : "No content-encoding (gzip/br) on the HTML response — bytes are wasted.",
      value: encoding || "none",
      advice: "Enable Brotli/gzip for HTML, CSS and JS at the server or CDN.",
    },
    {
      id: "load-time", title: "Site Loading Speed Test",
      status: loadMs > 5000 ? "fail" : loadMs > 2500 ? "warn" : "pass",
      severity: "HIGH",
      details: `Fetched the HTML in ${(loadMs / 1000).toFixed(2)}s from this checker. Over ~2.5s risks losing visitors.`,
      value: `${(loadMs / 1000).toFixed(2)}s`,
      advice: "Cache aggressively, use a CDN, defer non-critical JS.",
    },
    {
      id: "page-objects", title: "Page Objects Test",
      status: estRequests > 60 ? "fail" : estRequests > 20 ? "warn" : "pass",
      severity: "LOW",
      details: `~${estRequests} sub-resources referenced (scripts + styles + images). More than ~20 slows loading.`,
      value: `~${estRequests} requests`,
      advice: "Bundle JS/CSS, lazy-load images, sprite small icons.",
    },
    {
      id: "render-blocking", title: "Render Blocking Resources Test",
      status: renderBlocking > 0 ? "fail" : "pass",
      severity: "HIGH",
      details: renderBlocking > 0 ? `${renderBlocking} render-blocking stylesheet/script(s) in <head> delay first paint.` : "No render-blocking resources detected in <head>.",
      value: String(renderBlocking),
      advice: "Add defer/async to scripts; inline critical CSS and defer the rest.",
    },
    {
      id: "modern-images", title: "Modern Image Format Test",
      status: imgs.length === 0 ? "pass" : imgsModern > 0 ? "pass" : "fail",
      severity: "MEDIUM",
      details: imgs.length === 0 ? "No images on this page." : imgsModern > 0 ? `${imgsModern} image(s) already use WebP/AVIF.` : `0 of ${imgs.length} images use WebP/AVIF — JPEG/PNG cost extra bytes.`,
      advice: "Convert images to WebP (fallback to JPEG) and compress.",
    },
    {
      id: "ttfb", title: "Time To First Byte Test",
      status: loadMs > 1800 ? "warn" : "pass",
      severity: "LOW",
      details: `Server responded in ${(loadMs / 1000).toFixed(2)}s. Google recommends TTFB under ~0.8s.`,
      value: `${(loadMs / 1000).toFixed(2)}s`,
      advice: "Use server caching, a nearby region and a CDN to cut TTFB.",
    },
  ];

  const server: Check[] = [
    {
      id: "https", title: "SSL / HTTPS Test",
      status: isHttps ? "pass" : "fail",
      severity: "HIGH",
      details: isHttps ? "Site loads over HTTPS — good." : "Site loads over plain HTTP — browsers flag it insecure.",
      advice: "Serve everything over HTTPS with a valid certificate and redirect HTTP → HTTPS.",
    },
    {
      id: "hsts", title: "HSTS Test",
      status: !isHttps ? "fail" : hasHsts ? "pass" : "fail",
      severity: "LOW",
      details: hasHsts ? "Strict-Transport-Security header is set." : "No Strict-Transport-Security header — first visits can be downgraded.",
      advice: "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.",
    },
    {
      id: "mixed-content", title: "Mixed Content Test",
      status: mixedCount > 0 ? "fail" : "pass",
      severity: "HIGH",
      details: mixedCount > 0 ? `${mixedCount} sub-resource(s) load over http:// on an https:// page — browsers may block them.` : "No mixed content — all sub-resources load over HTTPS.",
      advice: "Rewrite every http:// asset URL to https:// (or protocol-relative).",
    },
    {
      id: "unsafe-links", title: "Unsafe Cross-Origin Links Test",
      status: linksUnsafe > 0 ? "fail" : "pass",
      severity: "MEDIUM",
      details: linksUnsafe > 0 ? `${linksUnsafe} of ${linksBlank.length} target="_blank" links miss rel="noopener/noreferrer".` : linksBlank.length ? `All ${linksBlank.length} new-tab links use rel="noopener" — good.` : "No target=\"_blank\" links on this page.",
      advice: 'Add rel="noopener noreferrer" to every target="_blank" link.',
    },
    {
      id: "plaintext-emails", title: "Plaintext Emails Test",
      status: mailtoCount > 0 || emailsFound ? "warn" : "pass",
      severity: "LOW",
      details: mailtoCount > 0 || emailsFound ? `${mailtoCount} mailto link(s) expose addresses to harvesters.` : "No plaintext email addresses found.",
      advice: "Use a contact form or obfuscate addresses shown publicly.",
    },
    {
      id: "canonicalization", title: "URL Canonicalization Test",
      status: wwwAlt.ok ? "warn" : "pass",
      severity: "LOW",
      details: wwwAlt.ok ? "Both www and non-www versions resolve (HTTP 200) — pick one canonical host and redirect the other." : "Only one host version resolves — good.",
      advice: "301-redirect the secondary host (www ↔ apex) to the canonical one.",
    },
  ];

  const mobile: Check[] = [
    {
      id: "viewport", title: "Meta Viewport Test",
      status: viewport ? "pass" : "fail",
      severity: "HIGH",
      details: viewport ? `Viewport meta present: “${viewport.slice(0, 80)}”.` : "No viewport meta tag — mobile browsers render a desktop-width page.",
      advice: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    },
    {
      id: "media-queries", title: "Media Query Responsive Test",
      status: usesMediaQueries ? "pass" : "warn",
      severity: "MEDIUM",
      details: usesMediaQueries ? "CSS media queries detected — layout adapts to screen sizes." : "No @media queries found in served HTML/CSS — verify responsiveness.",
      advice: "Use responsive breakpoints (or a fluid layout) for 360px → 1440px.",
    },
    {
      id: "charset", title: "Charset Declaration Test",
      status: charset ? "pass" : "fail",
      severity: "LOW",
      details: charset ? `Character encoding declared: ${charset.slice(0, 60)}.` : "No character encoding declared — text may render incorrectly.",
      value: charset.slice(0, 40) || "missing",
      advice: 'Declare <meta charset="UTF-8"> as the first head element.',
    },
  ];

  const advanced: Check[] = [
    {
      id: "structured-data", title: "Structured Data Test",
      status: structuredCount > 0 ? "pass" : "warn",
      severity: "MEDIUM",
      details: structuredCount > 0 ? `${structuredCount} JSON-LD block(s) found — eligible for rich results.` : "No JSON-LD structured data — missing rich-result eligibility.",
      advice: "Add Organization + WebSite/Article JSON-LD where relevant.",
    },
    {
      id: "noindex", title: "Noindex Tag Test",
      status: /noindex/i.test(robotsMeta) ? "fail" : "pass",
      severity: "HIGH",
      details: /noindex/i.test(robotsMeta) ? `Robots meta says “${robotsMeta}” — search engines will skip this page!` : "No noindex directive — the page can be indexed.",
      advice: "Remove noindex from pages you want in Google; keep it only on thin/internal pages.",
    },
    {
      id: "canonical-tag", title: "Canonical Tag Test",
      status: canonical ? "pass" : "warn",
      severity: "MEDIUM",
      details: canonical ? `Canonical points to ${canonical.slice(0, 100)}.` : "No canonical link tag — duplicate-URL signals are unresolved.",
      advice: "Add an absolute self-referencing <link rel=\"canonical\">.",
    },
    {
      id: "meta-refresh", title: "Meta Refresh Test",
      status: metaRefresh ? "fail" : "pass",
      severity: "LOW",
      details: metaRefresh ? "Meta refresh redirect found — bad for UX and SEO." : "No meta-refresh redirect — good.",
      advice: "Replace meta-refresh with a proper 301 redirect.",
    },
    {
      id: "spf", title: "SPF Records Test",
      status: spf === true ? "pass" : spf === false ? "fail" : "warn",
      severity: "LOW",
      details: spf === true ? "SPF record found — mail spoofing is harder." : spf === false ? "No SPF record — anyone can spoof mail from this domain." : "Could not verify DNS from here — check your TXT records manually.",
      advice: "Publish a TXT record like `v=spf1 include:_spf.google.com ~all`.",
    },
    {
      id: "lang", title: "HTML Lang Attribute Test",
      status: langAttr ? "pass" : "warn",
      severity: "LOW",
      details: langAttr ? `html lang="${langAttr}" — screen readers and engines know the language.` : "Missing html lang attribute — accessibility suffers.",
      advice: 'Set <html lang="en"> (or the correct language).',
    },
  ];

  const cats: Category[] = [
    { key: "common", title: "Common SEO issues", checks: common },
    { key: "speed", title: "Speed optimizations", checks: speed },
    { key: "server", title: "Server and security", checks: server },
    { key: "mobile", title: "Mobile usability", checks: mobile },
    { key: "advanced", title: "Advanced SEO", checks: advanced },
  ].map((c) => ({
    ...c,
    score: scoreOf(c.checks),
    failed: c.checks.filter((x) => x.status === "fail").length,
    warnings: c.checks.filter((x) => x.status === "warn").length,
    passed: c.checks.filter((x) => x.status === "pass").length,
  }));

  const all = cats.flatMap((c) => c.checks);
  const overall = scoreOf(all);

  return c.json({
    url: target.toString(),
    finalUrl,
    fetchedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    score: overall,
    failed: all.filter((x) => x.status === "fail").length,
    warnings: all.filter((x) => x.status === "warn").length,
    passed: all.filter((x) => x.status === "pass").length,
    total: all.length,
    meta: {
      title: title.slice(0, 200),
      description: metaDesc.slice(0, 300),
      h1: h1s.length ? $(h1s[0]).text().trim().slice(0, 200) : "",
      htmlKb: Math.round(htmlKb * 10) / 10,
      loadSeconds: Math.round((loadMs / 1000) * 100) / 100,
    },
    categories: cats,
  });
});

export default analyzeRoutes;
