// supabase/functions/on-demand-summarize-article/index.ts
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPA_URL")!,
  Deno.env.get("SUPA_SECRET_API_KEY")!
);

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors() });
  }

  try {
    const { article_id } = await req.json();

    if (!article_id) {
      return new Response(JSON.stringify({ error: "Missing article_id" }), {
        status: 400,
        headers: cors(),
      });
    }

    const { data: article } = await supabase
      .from("articles")
      .select("full_content, ai_summary")
      .eq("id", article_id)
      .single();

    if (!article) {
      return new Response(JSON.stringify({ error: "Article not found" }), {
        status: 404,
        headers: cors(),
      });
    }

    // Already summarized → return immediately
    if (article.ai_summary) {
      return new Response(
        JSON.stringify({ success: true, ai_summary: article.ai_summary }),
        { headers: cors() }
      );
    }

    if (!article.full_content) {
      return new Response(
        JSON.stringify({ error: "No full_content to summarize" }),
        { status: 400, headers: cors() }
      );
    }

    const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY")!);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const prompt = `
Write a concise, punchy, TechCrunch-style news summary.
Rules:
- 2–3 sentences max
- One paragraph
- No fluff
- No bullet points
- Do NOT copy sentences from article

Article:
${article.full_content}
    `;

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    await supabase
      .from("articles")
      .update({ ai_summary: summary, summary_status: "ready" })
      .eq("id", article_id);

    return new Response(JSON.stringify({ success: true, ai_summary: summary }), {
      headers: cors(),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: cors(),
    });
  }
});
