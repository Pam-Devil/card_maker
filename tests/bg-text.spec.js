import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { ROOT } from "../src/build.mjs";
import { mmToPx } from "../src/export.mjs";
import { startServer } from "../src/server.mjs";
import { renderCard, renderBgText, renderText } from "../src/render.mjs";

const run = promisify(execFile);
const card = {
  id: "lower", name: "Prismuff", archetype: "Filhote Fluffusion", element: "caelo", cost: 1, atk: 0, hp: 3,
  font_size: 2.33, effect: "Primeiro efeito.\n---\nSegundo efeito.",
  art: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="690" height="940"><rect width="690" height="940" fill="#456789"/><rect y="500" width="690" height="80" fill="#ee8833"/><rect y="580" width="690" height="360" fill="#24887b"/></svg>').toString("base64"),
};

for (const dpi of [300, 600]) {
  for (const trim of [false, true]) {
    for (const rounded of [false, true]) {
      test(`--bg-text mantém o recorte original: ${dpi} DPI trim=${trim} rounded=${rounded}`, async ({}, info) => {
        const directory = info.outputPath("cards");
        await fs.mkdir(directory, { recursive: true });
        const input = path.join(directory, "input.json");
        await fs.writeFile(input, JSON.stringify([card, { id: "skip", art: "http://localhost:1/missing.png" }]));
        const args = ["build.mjs", input, "--bg-text", "--ids", "lower", "--dpi", String(dpi), "--out", directory];
        if (trim) args.push("--trim");
        if (rounded) args.push("--rounded");
        const { stdout } = await run(process.execPath, args, { cwd: ROOT });
        const mode = trim ? "trim" : "bleed";
        const name = `lower_bg_text_${mode}_${dpi}dpi.png`;
        expect(await fs.readdir(path.join(directory, "bg_text"))).toEqual([name]);
        expect(await fs.readdir(path.join(directory, mode))).toEqual([`lower_${mode}_${dpi}dpi.png`]);
        expect(stdout).toContain(`bg_text/${name}`);
        const filename = path.join(directory, "bg_text", name);
        const image = await sharp(filename).metadata();
        expect(image.width).toBe(mmToPx(trim ? 63 : 69, dpi));
        expect(image.height).toBe(mmToPx(trim ? 37 : 43, dpi));
        expect(image.density).toBe(dpi);
        const { data, info: pixels } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const at = (x, y) => [...data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)];
        // O topo do recorte é reto; somente os cantos inferiores recebem --rounded.
        expect(at(0, 0)[3]).toBe(255);
        expect(at(pixels.width - 1, 0)[3]).toBe(255);
        expect(at(0, pixels.height - 1)[3]).toBe(rounded ? 0 : 255);
        expect(at(pixels.width - 1, pixels.height - 1)[3]).toBe(rounded ? 0 : 255);
        // Faixa da arte acima da caixa: mantém a posição vertical original da imagem.
        expect(at(Math.floor(pixels.width / 2), 0)).toEqual([238, 136, 51, 255]);
        // A caixa com preenchimento continua presente sobre a parte verde da arte.
        const background = at(Math.floor(pixels.width / 2), mmToPx(trim ? 22 : 25, dpi));
        background.slice(0, 3).forEach(channel => expect(channel).toBeGreaterThan(180));
      });
    }
  }
}

test("região inferior acompanha o template e preserva o texto junto de --text", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", card, { trim: true });
    await page.locator("effect").evaluate(el => { el.style.height = "25mm"; el.style.bottom = "2mm"; });
    const font = await page.locator("effect-text").evaluate(el => getComputedStyle(el).fontSize);
    const visible = await renderBgText(page, { trim: true });
    expect(visible.size.width).toBeCloseTo(63, 1);
    expect(visible.size.height).toBeCloseTo(35, 1);
    await page.locator("card-data").evaluate(el => el.setAttribute("data-separate-text", ""));
    const separate = await renderBgText(page, { trim: true });
    expect(separate.png.equals(visible.png)).toBe(true);
    expect(await page.locator("card-data").getAttribute("data-separate-text")).toBe("");
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).fontSize)).toBe(font);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("CLI combina --bg-text e --text preservando a descrição na carta e no HTML", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify(card));
  await run(process.execPath, ["build.mjs", input, "--trim", "--bg-text", "--text", "--save-html", "--out", directory], { cwd: ROOT });
  expect(await fs.readdir(path.join(directory, "bg_text"))).toEqual(["lower_bg_text_trim_300dpi.png"]);
  expect(await fs.readdir(path.join(directory, "text"))).toEqual(["lower_text_trim_300dpi.png"]);
  const html = await fs.readFile(path.join(directory, "html", "lower.html"), "utf8");
  expect(html).not.toContain("data-separate-text");
  expect(html).not.toContain("data-render-text");
  expect(html).not.toContain("<text-export");
});


test("--no-description oculta apenas a carta e preserva descrições em --bg-text e --text", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await renderCard(page, baseUrl, "template.html", card, { trim: true, noDescription: true });
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
    const bgWithoutMainText = await renderBgText(page, { trim: true, noDescription: true });
    const textWithoutMainText = await renderText(page, { trim: true });
    expect(await page.locator("card-data").getAttribute("data-separate-text")).toBe("");
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
    await renderCard(page, baseUrl, "template.html", card, { trim: true });
    const bg = await renderBgText(page, { trim: true });
    const text = await renderText(page, { trim: true });
    expect(bgWithoutMainText.png.equals(bg.png)).toBe(true);
    expect(textWithoutMainText.png.equals(text.png)).toBe(true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
