import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { ROOT } from "../src/build.mjs";
import { startServer } from "../src/server.mjs";
import { renderCard, renderText } from "../src/render.mjs";

const run = promisify(execFile);
const mm = value => value * 96 / 25.4;
const card = { id: "separator", name: "Prismuff", element: "caelo", cost: 1, atk: 0, hp: 3 };
async function withCard(page, effect, check, options = {}) {
  const server = await startServer(ROOT);
  try {
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", { ...card, effect }, { trim: true, ...options });
    await check();
  } finally { await new Promise(resolve => server.close(resolve)); }
}

test("separador ocupa menos que uma linha e preserva quebras, justificação e texto literal", async ({ page }) => {
  await withCard(page, "Primeiro --- efeito.\r\nLinha <hr> literal.\r\n  --- \t\r\nSegundo efeito.", async () => {
    expect(await page.locator("effect-text hr").count()).toBe(1);
    expect(await page.locator("effect-text .effect-section").allTextContents()).toEqual([
      "Primeiro --- efeito.\nLinha <hr> literal.", "Segundo efeito.",
    ]);
    // Este cenário confere a opção de largura total, independente da preferência no CSS.
    await page.locator("effect-text hr").evaluate(el => el.style.setProperty("--effect-separator-width", "100%"));
    const metrics = await page.locator("effect-text").evaluate(el => {
      const [first, second] = el.querySelectorAll(".effect-section");
      const hr = el.querySelector("hr");
      return { gap: second.getBoundingClientRect().top - first.getBoundingClientRect().bottom,
        line: parseFloat(getComputedStyle(el).lineHeight),
        width: hr.getBoundingClientRect().width,
        textWidth: first.getBoundingClientRect().width,
        thickness: hr.getBoundingClientRect().height,
        margin: parseFloat(getComputedStyle(hr).marginTop),
        align: getComputedStyle(first).textAlign,
      };
    });
    expect(metrics.gap).toBeCloseTo(metrics.thickness + 2 * metrics.margin, 1);
    expect(metrics.gap).toBeLessThan(metrics.line);
    expect(metrics.width).toBeCloseTo(metrics.textWidth, 1);
    expect(metrics.align).toBe("justify");
  });
});

test("parâmetros ajustam a linha e --text preserva o separador na imagem transparente", async ({ page }) => {
  await withCard(page, "Primeiro efeito.\n---\nSegundo efeito.", async () => {
    await page.locator(":root").evaluate(el => {
      el.style.setProperty("--effect-separator-thickness", "0.4mm");
      el.style.setProperty("--effect-separator-gap", "0.2mm");
      el.style.setProperty("--effect-separator-width", "60%");
      el.style.setProperty("--effect-separator-color", "#c00000");
    });
    const metrics = await page.locator("effect-text").evaluate(el => {
      const hr = el.querySelector("hr"), border = hr.getBoundingClientRect();
      const text = el.querySelector(".effect-section").getBoundingClientRect();
      const box = el.closest("effect").getBoundingClientRect();
      const style = getComputedStyle(hr);
      return { width: border.width, textWidth: text.width,
        centerOffset: (border.left + border.right - text.left - text.right) / 2,
        thickness: border.height, gap: parseFloat(style.marginTop), color: getComputedStyle(hr, "::after").backgroundColor,
        centerX: (border.left + border.right) / 2 - box.left,
        centerY: (border.top + border.bottom) / 2 - box.top,
        font: getComputedStyle(el).fontSize,
      };
    });
    expect(metrics.width).toBeCloseTo(metrics.textWidth * 0.6, 1);
    expect(metrics.centerOffset).toBeCloseTo(0, 1);
    expect(metrics.thickness).toBeCloseTo(mm(0.4), 1);
    expect(metrics.gap).toBeCloseTo(mm(0.2), 1);
    expect(metrics.color).toBe("rgb(192, 0, 0)");
    const result = await renderText(page, { trim: true });
    const { data, info } = await sharp(result.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / result.size.width;
    const x = Math.round((result.bounds.left + metrics.centerX * 25.4 / 96) * scale);
    const y = Math.round((result.bounds.top + metrics.centerY * 25.4 / 96) * scale);
    let red = false;
    for (let row = y - 2; row <= y + 2; row++) {
      const offset = (row * info.width + x) * 4;
      if (data[offset] > 150 && data[offset + 1] < 50 && data[offset + 2] < 50 && data[offset + 3] > 100) red = true;
    }
    expect(red).toBe(true);
    expect(data[3]).toBe(0);
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).fontSize)).toBe(metrics.font);
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
    expect(await page.locator("text-export").count()).toBe(0);
  }, { text: true });
});

test("ajuste automático da fonte inclui o espaço dos separadores", async ({ page }) => {
  const text = Array(4).fill("Quando sou invocado, recupero uma carta do meu deck e ganho 1 de energia.").join("\n---\n");
  await withCard(page, text, async () => {
    expect(await page.locator("effect-text hr").count()).toBe(3);
    const result = await page.locator("effect-text").evaluate(el => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      fits: el.scrollHeight <= el.clientHeight + 0.5 && el.scrollWidth <= el.clientWidth + 0.5,
    }));
    expect(result.size).toBeLessThan(mm(2.8));
    expect(result.size).toBeGreaterThanOrEqual(mm(1.5) - 0.1);
    expect(result.fits).toBe(true);
  });
});

test("CLI renderiza separador vindo de variável e mantém HTML e exportações", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify({ variables: {
    divider: "---", shared: "Primeiro efeito de ${name}.\n${divider}\nSegundo efeito.",
  }, cards: [{ ...card, effect: "${shared}" }] }));
  await run(process.execPath, ["build.mjs", input, "--trim", "--text", "--save-html", "--out", directory], { cwd: ROOT });
  const html = await fs.readFile(path.join(directory, "html", "separator.html"), "utf8");
  expect(html).toContain('<hr class="effect-separator">');
  expect(html).toContain("Primeiro efeito de Prismuff.");
  expect(html).not.toContain("${");
  expect((await sharp(path.join(directory, "text", "separator_text_trim_300dpi.png")).metadata()).hasAlpha).toBe(true);
  expect((await sharp(path.join(directory, "trim", "separator_trim_300dpi.png")).metadata()).width).toBe(744);
});


for (const dpi of [300, 600]) {
  test(`espessuras 0.01 a 0.06 mm variam gradualmente na carta e em --text (${dpi} DPI)`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 500, height: 600 }, deviceScaleFactor: dpi / 96 });
    const page = await context.newPage();
    try {
      await withCard(page, "Primeiro efeito.\n---\nSegundo efeito.", async () => {
        // Fundo branco na carta e transparente em --text permitem medir a cobertura do traço.
        await page.locator(":root").evaluate(el => el.style.setProperty("--effect-background-opacity", "0%"));
        async function ink(png, center, transparent) {
          const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const x = Math.round(center.x), y = Math.round(center.y);
          const radius = Math.ceil(0.2 * dpi / 25.4) + 2;
          let coverage = 0;
          for (let row = y - radius; row <= y + radius; row++) {
            const offset = (row * info.width + x) * 4;
            coverage += transparent ? data[offset + 3] / 255 : (255 - data[offset]) / 255;
          }
          return coverage;
        }
        for (const phase of [0, 0.5]) {
          let previousCard = 0, previousText = 0;
          for (const thickness of [0.01, 0.02, 0.03, 0.06]) {
            await page.locator("effect-text hr").evaluate((el, { thickness, phase }) => {
              el.style.setProperty("--effect-separator-thickness", `${thickness}mm`);
              el.style.transform = `translateY(${phase}px)`;
            }, { thickness, phase });
            const center = await page.locator("effect-text hr").evaluate(el => {
              const hr = el.getBoundingClientRect();
              const card = el.closest(".trim").getBoundingClientRect();
              const effect = el.closest("effect").getBoundingClientRect();
              return { cardX: (hr.left + hr.right) / 2 - card.left,
                cardY: (hr.top + hr.bottom) / 2 - card.top,
                effectX: (hr.left + hr.right) / 2 - effect.left,
                effectY: (hr.top + hr.bottom) / 2 - effect.top };
            });
            const cardCoverage = await ink(await page.locator(".trim").screenshot(), {
              x: center.cardX * dpi / 96, y: center.cardY * dpi / 96,
            }, false);
            const text = await renderText(page, { trim: true });
            const textCoverage = await ink(text.png, {
              x: (text.bounds.left + center.effectX * 25.4 / 96) * dpi / 25.4,
              y: (text.bounds.top + center.effectY * 25.4 / 96) * dpi / 25.4,
            }, true);
            const expected = thickness * dpi / 25.4;
            for (const coverage of [cardCoverage, textCoverage]) {
              expect(coverage).toBeGreaterThan(0);
              expect(Math.abs(coverage - expected)).toBeLessThan(0.05);
            }
            expect(cardCoverage).toBeGreaterThan(previousCard);
            expect(textCoverage).toBeGreaterThan(previousText);
            previousCard = cardCoverage;
            previousText = textCoverage;
          }
        }
      });
    } finally { await context.close(); }
  });
}
