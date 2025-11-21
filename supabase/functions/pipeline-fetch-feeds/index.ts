// supabase/functions/fetch-feeds/index.ts

import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import Parser from "https://esm.sh/rss-parser@3.12.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { FEEDS, isBlockedDomain } from "./domainConfig.ts";

function extractText(html: string | null | undefined, max = 400): string {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function calculateReadTime(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.min(Math.ceil(words / 200), 30));
}

serve(async () => {
  const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("URL");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Missing PROJECT_URL or SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const parser = new Parser({ timeout: 8000 });

  const collected: any[] = [];

  for (const [category, urls] of Object.entries(FEEDS)) {
    for (const feedUrl of urls) {
      try {
        const xml = await fetch(feedUrl).then((r) => r.text());
        const feed = await parser.parseString(xml);

        for (const item of feed.items ?? []) {
          const link = item.link?.trim();
          if (!link?.startsWith("http")) continue;
          if (isBlockedDomain(link)) continue;

          const title = item.title?.trim();
          if (!title || title.length < 10) continue;

          const snippet = extractText(item.contentSnippet || item.content, 400);
          const pubDate = new Date(
            item.isoDate || item.pubDate || new Date().toISOString()
          ).toISOString();

          collected.push({
            title,
            link,
            category,
            source: feed.title ?? new URL(feedUrl).hostname,
            pub_date: pubDate,
            summary: snippet,
            full_content: null,
            read_time: calculateReadTime(snippet || title),
            content_status: "pending",
            summary_status: "pending",
            last_error: null,
            created_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.log("Feed error:", feedUrl, String(e));
      }
    }
  }

  if (collected.length) {
    const { error } = await supabase
      .from("articles")
      .upsert(collected, { onConflict: "link" });

    if (error) {
      console.log("Upsert error:", error.message);
    }
  }

  return new Response(
    JSON.stringify(
      { success: true, fetched: collected.length },
      null,
      2
    ),
    { headers: { "Content-Type": "application/json" } }
  );
});
