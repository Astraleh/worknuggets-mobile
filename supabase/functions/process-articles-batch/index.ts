// supabase/functions/process-articles-batch/index.ts
// === THROTTLED MVP PIPELINE ===
// - Extracts ONLY 1 article per run (Cloudflare-safe)
// - Summarizes ONLY 1 article per run
// - Recovers from failures
// - Avoids 429 Browser Rendering limits
// - Perfect for MVP, ultra-stable

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai?target=deno";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXTRACTOR_URL = Deno.env.get("EXTRACTOR_URL")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ---------- CLIENT ----------
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors() });
  }

  console.log("=== MVP PIPELINE START ===");

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    // =====================================================
    // 1) EXTRACTION (THROTTLED: ONLY 1)
    // =====================================================
    const { data: extractList, error: extractErr } = await supabase
      .from("articles")
      .select("id, link")
      .in("content_status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(1); // <-- throttle to 1

    if (extractErr) throw extractErr;

    let extractedCount = 0;

    if (extractList.length === 1) {
      const art = extractList[0];
      console.log("EXTRACT → id:", art.id, "url:", art.link);

      // mark as extracting
      await supabase
        .from("articles")
        .update({ content_status: "extracting", last_error: null })
        .eq("id", art.id);

      try {
        const res = await fetch(
          `${EXTRACTOR_URL}?url=${encodeURIComponent(art.link)}`
        );

        const json = await res.json();
        console.log("Extractor JSON:", json);

        const extracted =
          json.content || json.summary || json.text || json.data || null;

        if (!res.ok || !extracted || extracted.length < 50) {
          throw new Error(json.error || "Extractor returned invalid text");
        }

        await supabase
          .from("articles")
          .update({
            full_content: extracted,
            content_status: "ready",
          })
          .eq("id", art.id);

        extractedCount = 1;
        console.log("EXTRACT SUCCESS:", art.id);
      } catch (e) {
        console.log("EXTRACT FAILED:", e.message);
        await supabase
          .from("articles")
          .update({
            content_status: "failed",
            last_error: `extract: ${e.message}`,
          })
          .eq("id", art.id);
      }
    } else {
      console.log("No articles needing extraction.");
    }

    // =====================================================
    // 2) SUMMARIZATION (THROTTLED: ONLY 1)
    // =====================================================
    const { data: sumList, error: sumErr } = await supabase
      .from("articles")
      .select("id, full_content")
      .eq("content_status", "ready")
      .in("summary_status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(1); // <-- throttle to 1

    if (sumErr) throw sumErr;

    let summarizedCount = 0;

    if (sumList.length === 1) {
      const art = sumList[0];
      console.log("SUMMARY → id:", art.id);

      await supabase
        .from("articles")
        .update({ summary_status: "summarizing", last_error: null })
        .eq("id", art.id);

      try {
        const prompt = `
Write a concise, punchy, TechCrunch-style news summary.

Rules:
- 2–3 sentences max
- One paragraph
- No bullet points
- No fluff
- Do NOT copy sentences
- Tone: modern newsroom
- Focus: what happened, who is involved, why it matters

Article:
${art.full_content}
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        if (!text || text.length < 20) {
          throw new Error("Gemini returned empty summary");
        }

        await supabase
          .from("articles")
          .update({
            ai_summary: text,
            summary_status: "ready",
          })
          .eq("id", art.id);

        summarizedCount = 1;
        console.log("SUMMARY SUCCESS:", art.id);
      } catch (e) {
        console.log("SUMMARY FAILED:", e.message);
        await supabase
          .from("articles")
          .update({
            summary_status: "failed",
            last_error: `summary: ${e.message}`,
          })
          .eq("id", art.id);
      }
    } else {
      console.log("No articles needing summary.");
    }

    console.log("=== MVP PIPELINE DONE ===");

    return new Response(
      JSON.stringify(
        {
          success: true,
          extracted: extractedCount,
          summarized: summarizedCount,
        },
        null,
        2
      ),
      {
        headers: {
          ...cors(),
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err: any) {
    console.error("PIPELINE ERROR:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: cors(),
    });
  }
});
