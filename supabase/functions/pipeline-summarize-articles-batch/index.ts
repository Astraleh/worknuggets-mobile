// supabase/functions/pipeline-summarize-articles-batch/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai?target=deno";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY")!);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: cors() });

  try {
    const { data } = await supabase
      .from("articles")
      .select("id, full_content")
      .eq("content_status", "ready")
      .in("summary_status", ["pending", "failed"])
      .order("created_at", { ascending: true })
      .limit(1);

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ success: true, summarized: 0 }),
        { headers: cors() }
      );
    }

    const article = data[0];

    await supabase
      .from("articles")
      .update({ summary_status: "summarizing" })
      .eq("id", article.id);

    const prompt = `
Write a punchy, newsroom-style TechCrunch summary.

Rules:
- 2–3 sentences
- One short paragraph
- No recycled article lines
- Focus on what happened, who is involved, why it matters

Article:
${article.full_content}
    `;

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase
      .from("articles")
      .update({
        ai_summary: summary,
        summary_status: "ready",
      })
      .eq("id", article.id);

    return new Response(
      JSON.stringify({ success: true, summarized: 1 }),
      { headers: cors() }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: cors(),
    });
  }
});
