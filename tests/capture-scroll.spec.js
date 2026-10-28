import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "../src/build.mjs";
import { startServer } from "../src/server.mjs";
import { renderCard, renderBgText, renderText } from "../src/render.mjs";

const card = {
  id: "scroll", name: "Prismuff", archetype: "Fluffusion", element: "caelo",
  cost: "X", atk: 0, hp: 3, font_size: 2.33,
  effect: "Primeiro efeito.\n---\nSegundo efeito.",
  art: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="690" height="940"><rect width="690" height="940" fill="#456789"/><rect y="500" width="690" height="80" fill="#ee8833"/><rect y="580" width="690" height="360" fill="#24887b"/></svg>').toString("base64"),
};

for (const trim of [false, true]) {
  test(`recortes preservam todos os pixels com rolagem nos dois eixos: trim=${trim}`, async ({ page }) => {
    const server = await startServer(ROOT);
    try {
      await page.setViewportSize({ width: 500, height: 600 });
      const template = await fs.readFile(path.join(ROOT, "template.html"), "utf8");
      let initialScroll = { x: 600, y: 700 };
      await page.route("**/scroll-template.html", route => route.fulfill({ contentType: "text/html", body: template
        .replace("</head>", `<style>body { width: 1800px; height: 2200px; } card-data { position: relative; left: 640px; top: 760px; }</style></head>`)
        .replace("</body>", `<script>scrollTo(${initialScroll.x}, ${initialScroll.y})</script></body>`) }));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      async function capture() {
        const main = await renderCard(page, baseUrl, "scroll-template.html", card, { trim });
        const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        const bg = await renderBgText(page, { trim });
        const text = await renderText(page, { trim });
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll);
        expect(await page.locator("text-export").count()).toBe(0);
        return { main, bg, text };
      }
      const reference = await capture();
      // Referência: carta inteira visível. Demais casos: fora da tela, acima e à esquerda.
      for (initialScroll of [{ x: 0, y: 0 }, { x: 725, y: 900 }, { x: 600, y: 0 }, { x: 0, y: 700 }]) {
        const actual = await capture();
        expect(actual.main.equals(reference.main), `carta: ${JSON.stringify(initialScroll)}`).toBe(true);
        expect(actual.bg.png.equals(reference.bg.png), `fundo: ${JSON.stringify(initialScroll)}`).toBe(true);
        expect(actual.text.png.equals(reference.text.png), `texto: ${JSON.stringify(initialScroll)}`).toBe(true);
        expect(actual.bg.size).toEqual(reference.bg.size);
        expect(actual.text.size).toEqual(reference.text.size);
        expect(actual.text.bounds).toEqual(reference.text.bounds);
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
}
