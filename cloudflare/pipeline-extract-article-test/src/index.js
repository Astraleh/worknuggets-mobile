// ==========================================================
// WorkNuggets Extraction Worker (Headless Chromium binding)
// - Headless Chromium via @cloudflare/puppeteer
// - Durable Object for atomic concurrency + daily seconds quota
// - HTML-first extraction with quality scoring; browser fallback
// - Supabase integration (select + patch)
// - Test endpoint: /test?url=<encoded_url> for safe local testing
// ==========================================================

import puppeteer from "@cloudflare/puppeteer";
import domainRules from "../domain_rules.json";

// --- CONFIG ---
const MAX_CONCURRENT_BROWSER = 3;           // concurrency limit
const MAX_BROWSER_SECONDS_PER_DAY = 600;   // 10 minutes = 600 seconds
const DEFAULT_RESERVATION_SECONDS = 30;    // reserve when acquiring a slot to avoid overshoot
const MIN_BROWSER_SUCCESS_LENGTH = 150;    // minimal acceptable extracted length
const HTML_QUALITY_THRESHOLD = 0.60;       // threshold to accept HTML extraction

// ----------------------------
// Helpers: domain and HTML
// ----------------------------
function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function cleanHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function extractParagraphs(html) {
  const matches = cleanHTML(html).match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  if (!matches) return [];
  return matches
    .map(p => p.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(t => t.length > 40);
}

// ----------------------------
// Quality score
// ----------------------------
function computeQualityScore({ text, paragraphs, html }) {
  const charCount = text.length;
  const pCount = paragraphs.length;
  const hasArticleTag = /<article[\s>]/i.test(html);
  const hasPublishDateMeta = /property=["']article:published_time["']/i.test(html);
  const hasCanonical = /rel=["']canonical["']/i.test(html);
  const structureScore = (hasArticleTag || hasPublishDateMeta || hasCanonical) ? 1 : 0;

  const stopwords = [" the "," and "," but "," with "," this "," that "," from "," for "," was "," were "," are "," have "," has "];
  let stopwordMatches = 0;
  const lower = text.toLowerCase();
  for (const sw of stopwords) {
    if (lower.includes(sw)) stopwordMatches++;
  }
  const stopwordCoverage = stopwordMatches / stopwords.length;

  const S_length = Math.min(1, charCount / 2000);
  const S_paragraphs = Math.min(1, pCount / 8);
  const S_structure = structureScore;
  const S_stopwords = stopwordCoverage;

  const qualityScore =
    0.40 * S_length +
    0.25 * S_paragraphs +
    0.25 * S_structure +
    0.10 * S_stopwords;

  return {
    charCount,
    pCount,
    structureScore,
    stopwordCoverage,
    qualityScore
  };
}

// ----------------------------
// Supabase helpers
// ----------------------------
async function getNextArticle(env) {
  const url = new URL("/rest/v1/articles", env.SUPA_URL);
  url.searchParams.set("select", "id,link,content_status");
  url.searchParams.set("content_status", "eq.pending");
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPA_SECRET_API_KEY,
      Authorization: `Bearer ${env.SUPA_SECRET_API_KEY}`
    }
  });

  if (!res.ok) throw new Error(`Supabase select error: ${res.status}`);
  const rows = await res.json();
  return rows?.[0] || null;
}

async function updateArticle(env, id, patch) {
  const url = new URL("/rest/v1/articles", env.SUPA_URL);
  url.searchParams.set("id", `eq.${id}`);

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: env.SUPA_SECRET_API_KEY,
      Authorization: `Bearer ${env.SUPA_SECRET_API_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(patch)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase update error: ${res.status} - ${body}`);
  }
}

// ----------------------------
// HTML extractor
// ----------------------------
async function extractWithHttp(env, url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "WorkNuggetsBot/1.0" },
      redirect: "follow"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const paragraphs = extractParagraphs(html);
    const text = paragraphs.join("\n\n").slice(0, 12000);
    const metrics = computeQualityScore({ text, paragraphs, html });
    return { text, metrics, html };
  } catch (err) {
    console.log("HTTP extractor failed:", url, String(err));
    return { text: "", metrics: null, html: "" };
  }
}

// ----------------------------
// Browser (Headless Chromium) extraction using Puppeteer
// ----------------------------
async function extractWithBrowser(env, url) {
  if (!env.BROWSER) {
    throw new Error("Browser binding not available in this environment");
  }

  let browser;
  try {
    console.log("Launching Puppeteer browser...");
    browser = await puppeteer.launch(env.BROWSER);
    console.log("Browser launched successfully");
    
    const page = await browser.newPage();
    console.log("New page created");

    // Set realistic headers to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    const startTime = Date.now();

    console.log("Navigating to:", url);
    await page.goto(url, {
      waitUntil: "domcontentloaded", // Changed from networkidle2 for faster loading
      timeout: 60000
    });
    console.log("Page loaded, waiting for content...");
    
    // Wait a bit for JavaScript to render
    await new Promise(resolve => setTimeout(resolve, 3000));

    const html = await page.content();
    console.log("Got page content, length:", html.length);

    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    const paragraphs = extractParagraphs(html);
    const text = paragraphs.join("\n\n").slice(0, 12000);
    const metrics = computeQualityScore({ text, paragraphs, html });

    // Detect CAPTCHA/bot detection
    const isCaptcha = text.toLowerCase().includes("not a robot") || 
                      text.toLowerCase().includes("please verify") ||
                      text.toLowerCase().includes("access denied") ||
                      html.includes("captcha");

    if (isCaptcha) {
      throw new Error("Bot detection / CAPTCHA detected");
    }

    return { text, metrics, html, durationSeconds };
  } catch (err) {
    console.error("Browser extraction error:", err);
    console.error("Error type:", err.constructor.name);
    console.error("Error message:", String(err));
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("Browser closed");
      } catch (e) {
        console.log("Failed to close browser:", String(e));
      }
    }
  }
}

// ----------------------------
// Durable Object helpers (atomic concurrency + daily seconds)
// ----------------------------
async function doCommand(env, cmd, payload = {}) {
  if (!env.BROWSER_QUOTA_DO || !env.BROWSER_QUOTA_DO.idFromName) {
    throw new Error("Durable Object binding BROWSER_QUOTA_DO missing");
  }
  const id = env.BROWSER_QUOTA_DO.idFromName("GLOBAL");
  const stub = env.BROWSER_QUOTA_DO.get(id);
  const res = await stub.fetch("https://do/" + cmd, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DO ${cmd} failed: ${res.status} - ${text}`);
  }
  return res.json();
}

// ----------------------------
// Main pipeline (single-run) - uses Supabase
// ----------------------------
async function runOnce(env) {
  const art = await getNextArticle(env);
  if (!art) {
    console.log("No pending articles.");
    return { extracted: false };
  }

  console.log("Picked article:", art.id, art.link);

  await updateArticle(env, art.id, {
    content_status: "extracting",
    last_error: null
  });

  try {
    const { text: htmlText, metrics: htmlMetrics, html } = await extractWithHttp(env, art.link);

    const host = hostFromUrl(art.link);
    let rule = "unknown";
    if (domainRules.blocked?.includes(host)) rule = "blocked";
    else if (domainRules.never_browser?.includes(host)) rule = "never_browser";
    else if (domainRules.always_use_browser?.includes(host)) rule = "always_browser";
    else if (domainRules.paywalled?.includes(host)) rule = "paywalled";
    else if (domainRules.strict?.includes(host)) rule = "strict";
    else if (domainRules.prefer_html?.includes(host)) rule = "prefer_html";

    if (rule === "blocked") throw new Error("Domain blocked from extraction");

    let finalText = htmlText;
    let usedBrowser = false;

    if (rule === "always_browser" || rule === "paywalled" || rule === "strict") {
      console.log("Domain rule forces browser:", host, rule);

      const acquire = await doCommand(env, "acquire", {
        reserveSeconds: DEFAULT_RESERVATION_SECONDS,
        maxConcurrent: MAX_CONCURRENT_BROWSER,
        maxDailySeconds: MAX_BROWSER_SECONDS_PER_DAY
      });

      if (!acquire.ok) throw new Error(`Browser acquire failed: ${acquire.reason}`);

      try {
        const { text: browserText, metrics: browserMetrics, durationSeconds } = await extractWithBrowser(env, art.link);

        if (!browserText || browserText.length < MIN_BROWSER_SUCCESS_LENGTH) {
          throw new Error("Browser extracted content too short");
        }

        await doCommand(env, "addSeconds", { seconds: durationSeconds || 0 });

        finalText = browserText;
        usedBrowser = true;
      } finally {
        await doCommand(env, "release", {});
      }
    } else {
      const q = htmlMetrics ? htmlMetrics.qualityScore : 0;
      console.log("HTML quality score:", q);

      if (!htmlMetrics || q < HTML_QUALITY_THRESHOLD) {
        console.log("HTML insufficient -> guarded browser extraction for", host);

        const acquire = await doCommand(env, "acquire", {
          reserveSeconds: DEFAULT_RESERVATION_SECONDS,
          maxConcurrent: MAX_CONCURRENT_BROWSER,
          maxDailySeconds: MAX_BROWSER_SECONDS_PER_DAY
        });

        if (!acquire.ok) throw new Error(`Browser acquire failed: ${acquire.reason}`);

        try {
          const { text: browserText, metrics: browserMetrics, durationSeconds } = await extractWithBrowser(env, art.link);

          if (!browserText || browserText.length < MIN_BROWSER_SUCCESS_LENGTH) {
            throw new Error("Browser extracted too short");
          }

          await doCommand(env, "addSeconds", { seconds: durationSeconds || 0 });

          finalText = browserText;
          usedBrowser = true;
        } finally {
          await doCommand(env, "release", {});
        }
      } else {
        console.log("HTML accepted (quality ok) for", art.link);
      }
    }

    await updateArticle(env, art.id, {
      content_status: "ready",
      full_content: finalText,
      last_error: null
    });

    console.log("Extraction SUCCESS:", art.id, usedBrowser ? "(via Browser)" : "(via HTML)");
    return { extracted: true };
  } catch (err) {
    console.log("Extraction FAILURE:", art.id, String(err));
    await updateArticle(env, art.id, {
      content_status: "failed",
      last_error: String(err)
    });
    return { extracted: false };
  }
}

// ----------------------------
// Manual test endpoint handler (safe, for staging/dev)
// Use: GET /test?url=<encoded-url>
// ----------------------------
async function runTestExtraction(url, env) {
  if (!url) {
    return new Response("Missing url param", { status: 400 });
  }
  try {
    // Acquire DO slot
    const acquire = await doCommand(env, "acquire", {
      reserveSeconds: DEFAULT_RESERVATION_SECONDS,
      maxConcurrent: MAX_CONCURRENT_BROWSER,
      maxDailySeconds: MAX_BROWSER_SECONDS_PER_DAY
    });

    if (!acquire.ok) {
      return new Response(JSON.stringify({ ok: false, reason: acquire.reason }), { status: 429, headers: { "Content-Type": "application/json" } });
    }

    try {
      const { text, metrics, html, durationSeconds } = await extractWithBrowser(env, url);
      await doCommand(env, "addSeconds", { seconds: durationSeconds || 0 });
      return new Response(JSON.stringify({ ok: true, metrics, length: text.length, durationSeconds }), { headers: { "Content-Type": "application/json" } });
    } finally {
      await doCommand(env, "release", {});
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

// ----------------------------
// Direct test endpoint (no DO, direct browser access)
// ----------------------------
async function runDirectTest(url, env) {
  if (!url) {
    return new Response("Missing url param", { status: 400 });
  }

  let browser;
  try {
    if (!env.BROWSER) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: "BROWSER binding not found" 
      }), { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log("Launching Puppeteer browser for:", url);
    browser = await puppeteer.launch(env.BROWSER);
    console.log("Browser launched");
    
    const page = await browser.newPage();
    console.log("New page created");
    
    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });
    
    console.log("Navigating to URL...");
    await page.goto(url, { 
      waitUntil: "domcontentloaded", 
      timeout: 60000 
    });
    console.log("Page loaded, waiting for JS rendering...");
    
    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const html = await page.content();
    console.log("Got HTML content, length:", html.length);
    
    const paragraphs = extractParagraphs(html);
    const text = paragraphs.join("\n\n").slice(0, 12000);
    
    return new Response(JSON.stringify({ 
      ok: true,
      length: text.length,
      htmlLength: html.length,
      paragraphCount: paragraphs.length,
      preview: text.slice(0, 200)
    }), { 
      headers: { "Content-Type": "application/json" } 
    });
  } catch (e) {
    console.error("Direct test error:", e);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: String(e),
      errorType: e.constructor.name,
      stack: e.stack
    }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("Browser closed");
      } catch (e) {
        console.log("Failed to close browser:", String(e));
      }
    }
  }
}

// ----------------------------
// Worker exports
// ----------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // DEBUG endpoint - inspect bindings
    if (url.pathname === "/debug") {
      return new Response(JSON.stringify({
        hasBrowser: !!env.BROWSER,
        browserType: typeof env.BROWSER,
        browserKeys: env.BROWSER ? Object.keys(env.BROWSER) : [],
        browserProto: env.BROWSER ? Object.getOwnPropertyNames(Object.getPrototypeOf(env.BROWSER)) : [],
        hasLaunch: env.BROWSER ? typeof env.BROWSER.launch : 'N/A',
        allEnvKeys: Object.keys(env),
        puppeteerAvailable: typeof puppeteer !== 'undefined'
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // DIRECT test endpoint (bypasses DO)
    if (url.pathname === "/test-direct") {
      const target = url.searchParams.get("url");
      const decoded = target ? decodeURIComponent(target) : null;
      return runDirectTest(decoded, env);
    }

    // Original test endpoint (with DO)
    if (url.pathname === "/test") {
      const target = url.searchParams.get("url");
      const decoded = target ? decodeURIComponent(target) : null;
      return runTestExtraction(decoded, env);
    }

    return new Response("WorkNuggets Extractor - CRON-only endpoint", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    console.log("CRON triggered");
    await runOnce(env);
  }
};

// ----------------------------
// Durable Object class (atomic quota + concurrency manager)
// ----------------------------
export class BrowserQuota {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async _readState() {
    const stored = await this.state.storage.get(["running", "dailySeconds", "dayKey"]);
    return {
      running: Number(stored.running || 0),
      dailySeconds: Number(stored.dailySeconds || 0),
      dayKey: stored.dayKey || null
    };
  }

  async _writeState(obj) {
    await this.state.storage.put(obj);
  }

  _currentDayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const cmd = url.pathname.replace("/", "");
    if (req.method !== "POST") {
      return new Response("only POST supported", { status: 405 });
    }
    const body = await req.json();

    const st = await this._readState();
    const today = this._currentDayKey();
    if (st.dayKey !== today) {
      st.dailySeconds = 0;
      st.dayKey = today;
    }

    if (cmd === "acquire") {
      const reserveSeconds = Number(body.reserveSeconds || 0);
      const maxConcurrent = Number(body.maxConcurrent || 3);
      const maxDailySeconds = Number(body.maxDailySeconds || 600);

      if (st.running >= maxConcurrent) {
        await this._writeState(st);
        return new Response(JSON.stringify({ ok: false, reason: "concurrency_limit", running: st.running }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if ((st.dailySeconds + reserveSeconds) > maxDailySeconds) {
        await this._writeState(st);
        return new Response(JSON.stringify({ ok: false, reason: "daily_budget_exhausted", dailySeconds: st.dailySeconds }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      st.running += 1;
      st.dailySeconds += reserveSeconds;

      await this._writeState({ running: st.running, dailySeconds: st.dailySeconds, dayKey: st.dayKey });

      return new Response(JSON.stringify({ ok: true, running: st.running, dailySeconds: st.dailySeconds }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (cmd === "release") {
      st.running = Math.max(0, st.running - 1);
      await this._writeState({ running: st.running, dailySeconds: st.dailySeconds, dayKey: st.dayKey });
      return new Response(JSON.stringify({ ok: true, running: st.running }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (cmd === "addSeconds") {
      const seconds = Number(body.seconds || 0);
      st.dailySeconds += seconds;
      await this._writeState({ running: st.running, dailySeconds: st.dailySeconds, dayKey: st.dayKey });
      return new Response(JSON.stringify({ ok: true, dailySeconds: st.dailySeconds }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (cmd === "status") {
      return new Response(JSON.stringify({ running: st.running, dailySeconds: st.dailySeconds, dayKey: st.dayKey }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response("unknown command", { status: 400 });
  }
}