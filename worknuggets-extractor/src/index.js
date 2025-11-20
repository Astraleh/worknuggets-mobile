import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return Response.json({ error: "Missing ?url=" }, { status: 400 });
    }

    try {
      const browser = await puppeteer.launch(env.BROWSER);

      const page = await browser.newPage();
      await page.goto(targetUrl, {
        waitUntil: "networkidle2",
        timeout: 20000
      });

      // Basic readable extraction: prefer <article>, else all <p>
      const result = await page.evaluate(() => {
        const articleEl = document.querySelector("article");
        let text = "";

        if (articleEl) {
          text = articleEl.innerText;
        } else {
          text = Array.from(document.querySelectorAll("p"))
            .map((p) => p.innerText)
            .join("\n\n");
        }

        const title = document.title || "";
        return { title, text };
      });

      await browser.close();

      if (!result || !result.text || result.text.trim().length < 200) {
        return Response.json(
          { error: "Extraction too short or failed" },
          { status: 422 }
        );
      }

      return Response.json({
        success: true,
        url: targetUrl,
        title: result.title,
        content: result.text
      });
    } catch (e) {
      const msg = String(e || "");

      if (msg.includes("429")) {
        return Response.json(
          { error: "Browser Rendering rate limit (429)" },
          { status: 429 }
        );
      }

      return Response.json({ error: msg }, { status: 500 });
    }
  }
};
