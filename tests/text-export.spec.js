import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { ROOT } from "../src/build.mjs";
import { mmToPx } from "../src/export.mjs";
import { startServer } from "../src/server.mjs";
import { renderCard, renderText } from "../src/render.mjs";

const run = promisify(execFile);
const card = {
  id: "split", name: "Prismuff", archetype: "Adulto Fluffusion", element: "caelo", cost: "X", atk: 0, hp: 3,
  art: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#456789"/></svg>').toString("base64"),
  effect: "Primeira linha de descrição.\nSegunda linha de efeito.",
};

for (const dpi of [300, 600]) {
  for (const trim of [false, true]) {
    for (const rounded of [false, true]) {
      test(`--text ${dpi} dpi trim=${trim} rounded=${rounded}`, async ({}, info) => {
        const directory = info.outputPath("cards");
        await fs.mkdir(directory, { recursive: true });
        const input = path.join(directory, "input.json");
        await fs.writeFile(input, JSON.stringify(card));
        const args = ["build.mjs", input, "--dpi", String(dpi), "--text", "--out", directory, "--save-html"];
        if (trim) args.push("--trim");
        if (rounded) args.push("--rounded");
        const { stdout } = await run(process.execPath, args, { cwd: ROOT });
        const mode = trim ? "trim" : "bleed";
        const mainName = `split_${mode}_${dpi}dpi.png`;
        const textName = `split_text_${mode}_${dpi}dpi.png`;
        expect(await fs.readdir(path.join(directory, mode))).toEqual([mainName]);
        expect(await fs.readdir(path.join(directory, "text"))).toEqual([textName]);
        expect((await fs.readdir(directory)).filter(name => /\.(png|pdf|html)$/.test(name))).toEqual([]);
        expect(stdout).toContain(textName);
        const main = await sharp(path.join(directory, mode, mainName)).metadata();
        const text = await sharp(path.join(directory, "text", textName)).metadata();
        expect(text.width).toBe(main.width);
        expect(text.height).toBe(mmToPx(trim ? 37 : 43, dpi));
        expect(text.density).toBe(dpi);
        const { data, info: pixels } = await sharp(path.join(directory, "text", textName)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const alpha = (x, y) => data[(y * pixels.width + x) * 4 + 3];
        expect(alpha(0, 0)).toBe(0);
        expect(alpha(Math.floor(pixels.width / 2), 0)).toBe(0);
        // O centro, abaixo do texto curto, não contém o preenchimento da caixa.
        expect(alpha(Math.floor(pixels.width / 2), Math.floor(pixels.height / 2))).toBe(0);
        expect(data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
        // A borda superior fica à mesma distância do topo e do fundo da imagem.
        const gap = mmToPx(trim ? 3 : 6, dpi);
        const borderY = gap + Math.floor(mmToPx(0.25, dpi));
        expect(alpha(Math.floor(pixels.width / 2), borderY)).toBeGreaterThan(200);
        const { data: mainPixels, info: mainInfo } = await sharp(path.join(directory, mode, mainName)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const center = (Math.floor(mainInfo.height * 0.85) * mainInfo.width + Math.floor(mainInfo.width / 2)) * mainInfo.channels;
        // A caixa mantém o fundo claro mesmo quando só o texto é exportado à parte.
        for (let channel = 0; channel < 3; channel++) {
          expect(mainPixels[center + channel]).toBeGreaterThan(180);
          expect(mainPixels[center + channel]).toBeLessThan(220);
        }
        const html = await fs.readFile(path.join(directory, "html", "split.html"), "utf8");
        expect(html).toContain("data-separate-text");
        expect(html).not.toContain("<text-export");
        expect(html).not.toContain("data-render-text");
      });
    }
  }
}

test("a imagem de texto acompanha a geometria do template e preserva a fonte", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", card, { trim: true, text: true });
    const before = await page.locator("effect-text").evaluate(el => getComputedStyle(el).fontSize);
    await page.locator("effect").evaluate(el => { el.style.height = "25mm"; el.style.bottom = "2mm"; });
    const result = await renderText(page, { trim: true });
    expect(result.size.width).toBeCloseTo(63, 1);
    expect(result.bounds.width).toBeCloseTo(57, 1);
    expect(result.bounds.height).toBeCloseTo(25, 1);
    expect(result.bounds.left).toBeCloseTo(3, 1);
    expect(result.bounds.top).toBeCloseTo(5, 1);
    // safe-area termina 3 mm antes da carta; caixa termina 2 mm antes do safe-area.
    expect(result.size.height).toBeCloseTo(25 + 2 * (3 + 2), 1);
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).fontSize)).toBe(before);
    expect(await page.locator("effect").evaluate(el => getComputedStyle(el).visibility)).toBe("visible");
    expect(await page.locator("effect-box").evaluate(el => getComputedStyle(el).visibility)).toBe("visible");
    expect(await page.locator("effect-text").evaluate(el => getComputedStyle(el).visibility)).toBe("hidden");
    expect(await page.locator("text-export").count()).toBe(0);
    expect(await page.locator("card-name span").textContent()).toBe(card.name);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test("--no-description mantém a caixa e o fundo sem exportar texto separado", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify(card));
  await run(process.execPath, ["build.mjs", input, "--trim", "--rounded", "--no-description", "--save-html", "--out", directory], { cwd: ROOT });
  const directories = (await fs.readdir(directory, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
  expect(directories).toEqual(["html", "trim"]);
  const html = await fs.readFile(path.join(directory, "html", "split.html"), "utf8");
  expect(html).toContain("data-separate-text");
  expect(html).toContain("<effect-box>");
  const { data } = await sharp(path.join(directory, "trim", "split_trim_300dpi.png"))
    .extract({ left: mmToPx(5, 300), top: mmToPx(56, 300), width: mmToPx(50, 300), height: mmToPx(12, 300) })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([...data].some(channel => channel < 100)).toBe(false);
});


test("exportação de texto invisível informa o erro e limpa o estado temporário", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", card, { trim: true, text: true });
    const hidden = await page.addStyleTag({ content: "text-export { display: none !important; }" });
    const stylesBefore = await page.locator("style").count();
    await expect(renderText(page, { trim: true })).rejects.toThrow("Template sem área de exportação de texto visível (--text)");
    expect(await page.locator("text-export").count()).toBe(0);
    expect(await page.locator("card-data").getAttribute("data-render-text")).toBeNull();
    expect(await page.locator("style").count()).toBe(stylesBefore);
    expect(await page.locator("card-data").getAttribute("data-separate-text")).not.toBeNull();
    await hidden.evaluate(el => el.remove());
    const result = await renderText(page, { trim: true });
    expect((await sharp(result.png).metadata()).width).toBeGreaterThan(0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
