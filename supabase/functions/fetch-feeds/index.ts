// supabase/functions/fetch-feeds/index.ts
// === VERIFIED PRODUCTION VERSION ===
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Parser from "https://esm.sh/rss-parser@3.12.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
// ---------- FEED SOURCES ----------
const FEEDS = {
  "ai-ml": [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://venturebeat.com/category/ai/feed/"
  ],
  "cybersecurity": [
    "https://www.bleepingcomputer.com/feed/",
    "https://thehackernews.com/feeds/posts/default"
  ],
  "fintech-crypto": [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss"
  ],
  "adtech-marketing": [
    "https://adexchanger.com/feed/",
    "https://www.marketingdive.com/feeds/news/"
  ],
  "healthtech-biotech": [
    "https://www.mobihealthnews.com/feed"
  ],
  "legal-regulatory": [
    "https://www.jdsupra.com/rss/allarticles.rss"
  ],
  "finance-banking": [
    "https://www.cnbc.com/id/100003114/device/rss/rss.html"
  ],
  "product-tech": [
    "https://www.producthunt.com/feed"
  ],
  "sales-bizdev": [
    "https://blog.hubspot.com/sales/rss.xml"
  ],
  "data-analytics": [
    "https://www.kdnuggets.com/feed"
  ],
  "realestate-proptech": [
    "https://www.inman.com/feed/"
  ],
  "hr-talent": [
    "https://www.hrdive.com/feeds/news/"
  ],
  "supply-logistics": [
    "https://www.freightwaves.com/news/feed"
  ]
};
// ---------- HELPERS ----------
function extractText(html, max = 500) {
  if (!html) return "";
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim().slice(0, max);
}
function calculateReadTime(text) {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.min(Math.ceil(words / 200), 30));
}
function extractTags(title, summary) {
  const txt = (title + " " + summary).toLowerCase();
  const tags = [
    "ai",
    "blockchain",
    "security",
    "breach",
    "regulation",
    "fda",
    "sec",
    "startup",
    "funding",
    "acquisition",
    "bitcoin",
    "product",
    "research"
  ];
  return tags.filter((t)=>txt.includes(t));
}
function determineImportance(title, summary) {
  const txt = (title + " " + summary).toLowerCase();
  if (/breaking|zero-day|critical|breach|fda approves|emergency/.test(txt)) return "critical";
  if (/launches|announces|releases|acquires|regulation|billion/.test(txt)) return "high";
  if (/report|study/.test(txt)) return "medium";
  return "low";
}
// ---------- MAIN ----------
serve(async ()=>{
  const debug = {
    started: new Date().toISOString(),
    feedCounts: {},
    inserted: 0,
    errors: []
  };
  // Get environment variables (Supabase auto-provides these)
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("URL");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({
      success: false,
      error: "Missing PROJECT_URL or SERVICE_ROLE_KEY",
      debug
    }), {
      headers: {
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const parser = new Parser({
    timeout: 8000
  });
  // ---------- FETCH ALL FEEDS PARALLEL ----------
  const fetchFeed = async (category, url)=>{
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 7000);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "IndustryPulseBot/1.0"
        }
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const xml = await resp.text();
      const feed = await parser.parseString(xml);
      debug.feedCounts[url] = feed.items?.length || 0;
      const items = (feed.items ?? []).map((it)=>{
        const link = it.link?.trim();
        if (!link?.startsWith("http")) return null;
        const title = it.title?.trim();
        if (!title || title.length < 10) return null;
        const summary = extractText(it.contentSnippet || it.content || "", 500);
        const full = extractText(it.content || "", 5000);
        const pub = new Date(it.isoDate || it.pubDate || Date.now());
        if (Date.now() - pub.getTime() > 7 * 864e5) return null;
        return {
                title,
                link,
                category,
                source: feed.title || new URL(url).hostname,
                pub_date: pub.toISOString(),
                last_fetched: new Date().toISOString(),
                created_at: new Date().toISOString(),

                // ---- pipeline flags ----
                full_content: null,
                ai_summary: null,
                content_status: "pending",
                summary_status: "pending",
                last_error: null,

                // ---- lightweight metadata (optional) ----
                summary,     // used only as fallback
                read_time: calculateReadTime(summary),
                importance: determineImportance(title, summary),
                tags: extractTags(title, summary),
                };
      }).filter(Boolean);
      return items;
    } catch (e) {
      debug.errors.push({
        feedUrl: url,
        message: String(e)
      });
      return [];
    }
  };
  const feedPromises = Object.entries(FEEDS).flatMap(([cat, urls])=>urls.map((u)=>fetchFeed(cat, u)));
  const settled = await Promise.allSettled(feedPromises);
  const allArticles = settled.filter((r)=>r.status === "fulfilled").flatMap((r)=>r.value);
  // ---------- DEDUP ----------
  const unique = Array.from(new Map(allArticles.map((a)=>[
      a.link.toLowerCase(),
      a
    ])).values());
  // ---------- UPSERT ----------
  if (unique.length) {
    const { data, error } = await supabase.from("articles").upsert(unique, {
      onConflict: "link"
    }).select("id");
    if (error) {
      debug.errors.push({
        phase: "upsert",
        message: error.message
      });
    } else {
      debug.inserted = data?.length || 0;
    }
  }
  debug.ended = new Date().toISOString();
  return new Response(JSON.stringify({
    success: true,
    summary: {
      total_fetched: allArticles.length,
      unique_articles: unique.length,
      inserted: debug.inserted,
      errors_count: debug.errors.length
    },
    debug
  }, null, 2), {
    headers: {
      "Content-Type": "application/json"
    },
    status: 200
  });
});
