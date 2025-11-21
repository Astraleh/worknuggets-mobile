// cloudflare/worknuggets-extractor/src/index.js
/**
 * Cloudflare Worker: worknuggets-extractor (Final MVP Version)
 * -------------------------------------------------------------
 * Strategy:
 * 1) Pick ONE article with content_status = 'pending'
 * 2) Try cheap HTTP fetch + <p> extraction (no browser)
 * 3) If too short/empty, fall back to Browser Rendering (env.BROWSER)
 * 4) If still bad, mark as failed and move on
 */

// ---------- Supabase helpers ----------

async function getNextArticle(env) {
  const url = new URL("/rest/v1/articles", env.SUPABASE_URL);
  url.searchParams.set("select", "id,link,content_status");
  url.searchParams.set("content_status", "eq.pending");
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation",
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase select error: HTTP ${res.status}`);
  }

  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function updateArticle(env, id, patch) {
  const url = new URL("/rest/v1/articles", env.SUPABASE_URL);
  url.searchParams.set("id", `eq.${id}`);

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase update error: HTTP ${res.status} - ${body}`);
  }
}

// ---------- HTML extraction (no browser) ----------

function cleanHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function extractParagraphsFromHTML(html) {
  const cleaned = cleanHTML(html);
  const matches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];

  const paras = matches
    .map((m) =>
      m[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((p) => p.length > 40);

  const text = paras.join("\n\n");
  return text.slice(0, 8000);
}

async function extractWithHttpFetch(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WorkNuggetsBot/1.0 (+https://worknuggets.com)",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    const extracted = extractParagraphsFromHTML(html);
    return extracted;
  } catch (e) {
    console.log("HTTP extractor failed:", url, String(e));
    return "";
  }
}

// ---------- Browser Rendering extraction ----------

async function extractWithBrowser(env, url) {
  const browser = await env.BROWSER.launch();
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const content = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll(
          "article p, main p, div[role='main'] p, section p, p"
        )
      );

      const paras = candidates
        .map((p) => p.innerText.trim())
        .filter((t) => t.length > 40);

      return paras.join("\n\n").slice(0, 8000);
    });

    return content;
  } finally {
    await browser.close();
  }
}

// ---------- Main runner ----------

async function runOnce(env) {
  const art = await getNextArticle(env);
  if (!art) {
    console.log("No articles needing extraction.");
    return { extracted: false };
  }

  console.log("EXTRACTOR picked:", art.id, art.link);

  await updateArticle(env, art.id, {
    content_status: "extracting",
    last_error: null,
  });

  try {
    let extracted = "";

    // Step 1: cheap HTTP extraction
    extracted = await extractWithHttpFetch(art.link);

    if (extracted && extracted.length >= 200) {
      console.log("EXTRACTOR: HTTP mode succeeded for", art.id);
    } else {
      console.log(
        "EXTRACTOR: HTTP mode insufficient; falling back to Browser for",
        art.id
      );
      try {
        extracted = await extractWithBrowser(env, art.link);
      } catch (browserErr) {
        console.log(
          "EXTRACTOR: Browser mode threw error for",
          art.id,
          String(browserErr)
        );
        extracted = "";
      }
    }

    if (!extracted || extracted.length < 120) {
      throw new Error("Final extracted content too short or empty");
    }

    await updateArticle(env, art.id, {
      full_content: extracted,
      content_status: "ready",
      last_error: null,
    });

    console.log("EXTRACTOR success:", art.id);
    return { extracted: true };
  } catch (e) {
    console.log("EXTRACTOR failure:", art.id, String(e));
    await updateArticle(env, art.id, {
      content_status: "failed",
      last_error: `extract: ${String(e)}`,
    });
    return { extracted: false };
  }
}

// ---------- Cloudflare worker handlers ----------

export default {
  async fetch(request, env) {
    const result = await runOnce(env);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOnce(env));
  },
};
