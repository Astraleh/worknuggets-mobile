// supabase/functions/fetch-feeds/domainConfig.ts

// ===============================
// MVP FEED SOURCES (safe, reliable)
// ===============================
export const FEEDS: Record<string, string[]> = {
  "ai-ml": [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://venturebeat.com/category/ai/feed/",
  ],

  "cybersecurity": [
    "https://www.bleepingcomputer.com/feed/",
    "https://thehackernews.com/feeds/posts/default",
  ],

  "fintech-crypto": [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
  ],

  "adtech-marketing": [
    "https://adexchanger.com/feed/",
    "https://www.marketingdive.com/feeds/news/",
  ],

  "product-tech": [
    "https://www.producthunt.com/feed",
  ],

  "healthtech-biotech": [
    "https://www.mobihealthnews.com/feed",
  ],

  "data-analytics": [
    "https://www.kdnuggets.com/feed",
  ],
};


// ===============================
// DOMAINS TO BLOCK FOR MVP
// ===============================
// These are either JS-heavy, anti-bot, or non-article containers.
export const BLOCKED_DOMAINS = [
  "producthunt.com",
  "cnbc.com",
  "jdsupra.com",
  "coindesk.com/index",
  "marketingdive.com",
  "feed",
  "rss",
  "xml",
  "amp",
];

export function isBlockedDomain(url: string): boolean {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some((d) => domain.includes(d));
  } catch {
    // malformed URL -> treat as blocked
    return true;
  }
}
