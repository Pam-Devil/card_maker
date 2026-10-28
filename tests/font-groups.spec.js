import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT } from "../src/build.mjs";
import { parseDeck } from "../src/cards.mjs";
import { resolveCardFontGroups } from "../src/render.mjs";
import { startServer } from "../src/server.mjs";
import { outputFiles } from "./output-files.mjs";

const run = promisify(execFile);
const base = { name: "Prismuff", element: "caelo", hp: 3, cost: 1, atk: 0, effect: "Efeito curto." };
function deck() {
  return { variables: { fonte: { default: null, cases: [
    { ids: ["01-02"], value: { auto: "min" } }, { ids: ["03-04"], value: { auto: "min" } },
    { ids: ["05"], value: 2.25 },
  ] }, alias: "${fonte}" }, cards: ["01", "02", "03", "04", "05", "06"].map(id => ({ ...base, id, font_size: "${alias}",
    quantity: id === "02" ? 0 : 1,
    effect: id === "02" ? "Uma descrição longa com várias regras de efeito. ".repeat(12) : base.effect,
  })) };
}
async function htmlSize(directory, id) {
  const html = await fs.readFile(path.join(directory, "html", `${id}.html`), "utf8");
  expect(html).not.toContain("${");
  return Number(html.match(/<effect-text style="font-size: ([\d.]+)mm;/)[1]);
}
const generate = (input, out, extra = []) => run(process.execPath,
  ["build.mjs", input, "--trim", "--text", "--bg-text", "--save-html", "--out", out, ...extra], { cwd: ROOT });

test("CLI usa uma fonte por grupo em todos os formatos e mantém o mínimo com --ids", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const raw = deck(), input = path.join(directory, "input.json"), full = path.join(directory, "full");
  await fs.writeFile(input, JSON.stringify(raw));
  const { stdout } = await generate(input, full);
  const sizes = await Promise.all(raw.cards.map(card => htmlSize(full, card.id)));
  expect(sizes[0]).toBe(sizes[1]);
  expect(sizes[0]).toBeLessThan(2.8);
  expect(sizes[0]).toBeGreaterThanOrEqual(1.5);
  expect(sizes.slice(2)).toEqual([2.8, 2.8, 2.25, 2.8]);
  expect(stdout).toContain("mínima do grupo");
  expect(stdout).toContain("fonte: 2.25 mm (fixa)");
  expect(await outputFiles(full, ".png")).toHaveLength(18);
  // A arte de uma carta fora de --ids não deve ser aberta nem impedir a medição do grupo.
  raw.cards[1].art = "http://localhost:1/should-not-load.png";
  await fs.writeFile(input, JSON.stringify(raw));
  const partial = path.join(directory, "partial");
  const result = await generate(input, partial, ["--ids", "01", "--no-description"]);
  expect(await htmlSize(partial, "01")).toBe(sizes[0]);
  expect(await outputFiles(partial, ".png")).toEqual([
    "bg_text/01_bg_text_trim_300dpi.png", "text/01_text_trim_300dpi.png", "trim/01_trim_300dpi.png",
  ]);
  expect(result.stdout).not.toContain("Servidor Python de arte iniciado");
});

test("o mesmo cálculo de grupos funciona na prévia do navegador", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/template.html`);
    const result = await page.evaluate(async raw => {
      const { parseDeck } = await import("/src/cards.mjs");
      const { applyCard } = await import("/src/layout.mjs");
      const { resolveGroupFontSizes } = await import("/src/font-groups.mjs");
      const cards = parseDeck(raw), measured = new Map();
      const sizes = await resolveGroupFontSizes(cards, async card => {
        const size = await applyCard({ card, art: null });
        measured.set(card.id, size);
        return size;
      });
      const returned = await applyCard({ card: { ...cards[0], font_size: sizes.get(cards[0]) }, art: null });
      return { group: cards.slice(0, 4).map(card => sizes.get(card)),
        minimum: Math.min(measured.get("01"), measured.get("02")), returned,
        rendered: parseFloat(document.querySelector("effect-text").style.fontSize) };
    }, deck());
    expect(result.group[0]).toBe(result.minimum);
    expect(result.group[1]).toBe(result.minimum);
    expect(result.group.slice(2)).toEqual([2.8, 2.8]);
    expect(result.rendered).toBe(result.minimum);
    expect(result.returned).toBe(result.rendered);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test("calibração lê a fonte do DOM mesmo quando applyCard não retorna um número", async ({ context }) => {
  const server = await startServer(ROOT);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cards = parseDeck(deck());
    const expected = await resolveCardFontGroups(context, baseUrl, "template.html", cards);
    let imported = 0;
    await context.route(`${baseUrl}/src/layout.mjs`, async route => {
      imported++;
      await route.fulfill({ contentType: "text/javascript", body: `
        import { applyCard as original } from "/src/layout.mjs?original";
        export async function applyCard(input) { await original(input); }
      ` });
    });
    const measured = await resolveCardFontGroups(context, baseUrl, "template.html", cards);
    expect(imported).toBe(1);
    expect([...measured.values()]).toEqual([...expected.values()]);
    expect(measured.get(cards[0])).toBeLessThan(2.8);
    for (const size of measured.values()) {
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
