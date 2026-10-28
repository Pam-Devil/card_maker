import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { ROOT } from "../src/build.mjs";
import { MM, mmToPx } from "../src/export.mjs";
import { startServer } from "../src/server.mjs";
import { renderCard } from "../src/render.mjs";
import { ELEMENTS, parseDeck } from "../src/cards.mjs";
import { parseArgs } from "../src/options.mjs";

const run = promisify(execFile);
const fixtureArt = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#456789"/></svg>').toString("base64");
const card = {
  id: "sample", quantity: 1, name: "Prismuff", archetype: "Filhote Fluffusion", element: "caelo",
  cost: 1, atk: 0, hp: 2, art: fixtureArt,
  effect: "Primeira linha.\nSegunda linha com uma descrição.",
};

for (const dpi of [300, 600]) {
  for (const trim of [false, true]) {
    for (const rounded of [false, true]) {
      test(`CLI ${dpi} dpi trim=${trim} rounded=${rounded}`, async ({}, info) => {
        const directory = info.outputPath("cards");
        await fs.mkdir(directory, { recursive: true });
        const input = path.join(directory, "input.json");
        await fs.writeFile(input, JSON.stringify(card));
        const args = ["build.mjs", input, "--dpi", String(dpi), "--out", directory];
        if (trim) args.push("--trim");
        if (rounded) args.push("--rounded");
        const { stdout } = await run(process.execPath, args, { cwd: ROOT });
        const filename = `sample_${trim ? "trim" : "bleed"}_${dpi}dpi.png`;
        expect((await fs.readdir(path.join(directory, trim ? "trim" : "bleed"))).filter(name => name.endsWith(".png"))).toEqual([filename]);
        expect(stdout).toContain(filename);
        const png = path.join(directory, trim ? "trim" : "bleed", filename);
        const metadata = await sharp(png).metadata();
        const width = mmToPx(trim ? MM.trimW : MM.bleedW, dpi);
        const height = mmToPx(trim ? MM.trimH : MM.bleedH, dpi);
        expect(metadata.width).toBe(width);
        expect(metadata.height).toBe(height);
        expect(metadata.density).toBe(dpi);
        const { data, info: pixels } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const alpha = (x, y) => data[(y * pixels.width + x) * 4 + 3];
        for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
          expect(alpha(x, y)).toBe(rounded ? 0 : 255);
        }
        expect(alpha(Math.floor(width / 2), 0)).toBe(255);
        expect(alpha(Math.floor(width / 2), Math.floor(height / 2))).toBe(255);
      });
    }
  }
}

test("todos os elementos carregam e os indicadores mantêm o centro", async ({ page }) => {
  const server = await startServer(ROOT);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on("response", response => { if (!response.ok()) errors.push(response.url()); });
  try {
    for (const element of ELEMENTS) {
      await renderCard(page, baseUrl, "template.html", { ...card, element, hp: 1200 }, { trim: true, guides: true });
      const metrics = await page.evaluate(() => {
        const attribute = document.querySelector("attribute");
        const rect = attribute.getBoundingClientRect();
        const after = getComputedStyle(attribute, "::after");
        const hp = document.querySelector("hp");
        const hpRect = hp.getBoundingClientRect();
        const number = hp.querySelector("span");
        const numberRect = number.getBoundingClientRect();
        const carta = document.querySelector("carta");
        const cardBox = carta.getBoundingClientRect();
        const effectBox = document.querySelector("effect-box").getBoundingClientRect();
        const description = getComputedStyle(document.querySelector("effect-text"));
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = getComputedStyle(document.querySelector("effect-box")).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return {
          descriptionColor: description.color,
          bottomGap: (cardBox.bottom - effectBox.bottom) * 25.4 / 96,
          leftGap: (effectBox.left - cardBox.left) * 25.4 / 96,
          rightGap: (cardBox.right - effectBox.right) * 25.4 / 96,
          descriptionBackground: [...ctx.getImageData(0, 0, 1, 1).data],
          backgroundOpacity: parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue("--effect-background-opacity")) / 100,
          circleDifference: Math.abs(rect.width - rect.height),
          iconInsets: [after.top, after.right, after.bottom, after.left],
          mask: after.maskImage,
          hpCenterDifference: Math.abs((numberRect.left + numberRect.right - hpRect.left - hpRect.right) / 2),
          hpOverflow: number.scrollWidth > number.clientWidth + 0.5,
          hpMask: getComputedStyle(hp).maskImage,
          transform: getComputedStyle(carta).transform,
          outline: getComputedStyle(carta).outlineStyle,
          effect: document.querySelector("effect-text").textContent,
        };
      });
      expect(metrics.descriptionColor).toBe("rgb(0, 0, 0)");
      expect(metrics.bottomGap).toBeCloseTo(3, 2);
      expect(Math.abs(metrics.bottomGap - metrics.leftGap)).toBeLessThan(0.01);
      expect(Math.abs(metrics.bottomGap - metrics.rightGap)).toBeLessThan(0.01);
      for (const channel of metrics.descriptionBackground.slice(0, 3)) expect(channel).toBeGreaterThan(205);
      expect(metrics.backgroundOpacity).toBeGreaterThan(0);
      expect(metrics.backgroundOpacity).toBeLessThan(1);
      expect(Math.abs(metrics.descriptionBackground[3] - metrics.backgroundOpacity * 255)).toBeLessThanOrEqual(1);
      expect(metrics.circleDifference).toBeLessThan(0.1);
      expect(new Set(metrics.iconInsets).size).toBe(1);
      expect(metrics.mask).toContain(`${element}.svg`);
      expect(metrics.hpCenterDifference).toBeLessThan(0.1);
      expect(metrics.hpOverflow).toBe(false);
      expect(metrics.hpMask).toBe("none");
      expect(metrics.transform).toBe("none");
      expect(metrics.outline).toBe("solid");
      expect(metrics.effect).toBe(card.effect);
    }
    expect(errors).toEqual([]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("nome e efeito longos cabem, artPosition e guia respeitam as opções", async ({ page }) => {
  const server = await startServer(ROOT);
  try {
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", {
      ...card, name: "Nome bastante comprido", effect: "Uma descrição longa com várias regras de efeito. ".repeat(12), artPosition: "49% 35%",
    }, { trim: true });
    const result = await page.evaluate(() => {
      const name = document.querySelector("card-name");
      const effect = document.querySelector("effect-text");
      return {
        nameFits: name.scrollWidth <= name.clientWidth + 0.5,
        effectFits: effect.scrollHeight <= effect.clientHeight + 0.5,
        position: getComputedStyle(document.querySelector(".card-bleed")).backgroundPosition,
        outline: getComputedStyle(document.querySelector("carta")).outlineStyle,
      };
    });
    expect(result).toEqual({ nameFits: true, effectFits: true, position: "49% 35%", outline: "none" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("argumentos incompletos e DPI não finito são rejeitados", () => {
  for (const args of [["cards/Fluffusion.json", "--dpi"], ["cards/Fluffusion.json", "--out", ""], ["cards/Fluffusion.json", "--dpi", "Infinity"]]) {
    expect(() => parseArgs(args)).toThrow();
  }
});

test("HTML salvo carrega recursos após o encerramento do exportador", async ({ page }, info) => {
  const directory = info.outputPath("saved");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify(card));
  await run(process.execPath, ["build.mjs", input, "--out", directory, "--trim", "--save-html"], { cwd: ROOT });
  const server = await startServer(ROOT);
  const errors = [];
  page.on("response", response => { if (!response.ok()) errors.push(response.url()); });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const route = path.relative(ROOT, path.join(directory, "html", "sample.html")).split(path.sep).map(encodeURIComponent).join("/");
    await page.goto(`${baseUrl}/${route}`);
    const style = await page.locator(".card-bleed").evaluate(el => ({ width: el.getBoundingClientRect().width, art: getComputedStyle(el).backgroundImage }));
    expect(style.width).toBeCloseTo(69 / 25.4 * 96, 1);
    expect(style.art).toContain(fixtureArt);
    await expect(page.locator("card-name span")).toHaveText(card.name);
    expect(errors).toEqual([]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("o desenho visível de cada SVG está centralizado no viewBox", async () => {
  const size = 1024;
  for (const element of ELEMENTS) {
    const { data, info } = await sharp(path.join(ROOT, `assets/icons/${element}.svg`))
      .resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = size, top = size, right = -1, bottom = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[(y * size + x) * info.channels + info.channels - 1] <= 127) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    expect(right, element).toBeGreaterThan(left);
    expect(Math.abs((left + right + 1) / 2 - size / 2), `${element}: centro horizontal`).toBeLessThanOrEqual(1);
    expect(Math.abs((top + bottom + 1) / 2 - size / 2), `${element}: centro vertical`).toBeLessThanOrEqual(1);
  }
});

test("custo aceita números, letras e símbolos e ajusta o texto ao círculo", async ({ page }, info) => {
  const server = await startServer(ROOT);
  try {
    for (const cost of [0, 3, "X", "X+1", "∞", "?", "2/3", 'A&B', '<X>']) {
      await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", { ...card, cost }, { trim: true });
      const result = await page.locator("cost > span").evaluate(el => ({
        text: el.textContent,
        widthFits: el.scrollWidth <= el.clientWidth + 0.5,
        heightFits: el.scrollHeight <= el.clientHeight + 0.5,
      }));
      expect(result, String(cost)).toEqual({ text: String(cost), widthFits: true, heightFits: true });
    }
    await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", { ...card, cost: "X+1" }, { trim: true });
    await page.locator(".card-bleed").screenshot({ path: info.outputPath("cost-symbol.png") });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("variáveis se repetem nos campos, referenciam outras variáveis e preservam números", () => {
  const raw = {
    variables: { archetype: "Fluffusion", energy: "2-En", label: "Adulto ${archetype}", life: 3, zero: 0 },
    cards: [{ ...card, archetype: "${label}", cost: "${zero}", hp: "${life}", effect: "(${energy}): Recupero 1 ${archetype}. ${archetype}!", extra: ["${life}", { label: "${label}" }] }],
  };
  const original = JSON.stringify(raw);
  const [result] = parseDeck(raw);
  expect(result).toMatchObject({ archetype: "Adulto Fluffusion", cost: 0, hp: 3, effect: "(2-En): Recupero 1 Adulto Fluffusion. Adulto Fluffusion!", extra: [3, { label: "Adulto Fluffusion" }] });
  expect(JSON.stringify(raw)).toBe(original);
  expect(parseDeck(card)).toEqual([card]);
  expect(parseDeck([card])).toEqual([card]);
});

test("variáveis inválidas, ausentes e circulares produzem mensagens claras", () => {
  expect(() => parseDeck({ variables: {}, cards: [{ ...card, effect: "${missing}" }] })).toThrow("Variável não definida: missing");
  expect(() => parseDeck({ variables: {}, cards: [{ ...card, effect: "${toString}" }] })).toThrow("Variável não definida: toString");
  expect(() => parseDeck({ variables: { a: "${b}", b: "${a}" }, cards: [] })).toThrow("Referência circular");
  expect(() => parseDeck({ variables: { a: {} }, cards: [] })).toThrow('deve ser texto, número finito ou null');
  expect(() => parseDeck({ variables: [], cards: [] })).toThrow('"variables" deve ser um objeto');
  expect(() => parseDeck({ variables: {} })).toThrow('"cards" deve ser uma lista');
});

test("CLI exporta um deck com variáveis nos dados e no HTML salvo", async ({}, info) => {
  const directory = info.outputPath("variables");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify({
    variables: { archetype: "Fluffusion", energy: "2-En", element: "caelo", cost: "∞", art: fixtureArt },
    cards: [{ ...card, archetype: "Filhote ${archetype}", cost: "${cost}", element: "${element}", art: "${art}", effect: "(${energy}): Recupero 1 ${archetype}." }],
  }));
  await run(process.execPath, ["build.mjs", input, "--out", directory, "--trim", "--save-html"], { cwd: ROOT });
  const html = await fs.readFile(path.join(directory, "html", "sample.html"), "utf8");
  expect(html).toContain('data-archetype="Filhote Fluffusion"');
  expect(html).toContain('data-cost="∞"');
  expect(html).toContain('(2-En): Recupero 1 Filhote Fluffusion.');
  expect(html).not.toContain("${");
  expect(await fs.readdir(path.join(directory, "trim"))).toContain("sample_trim_300dpi.png");
});

test("bleed mostra a linha de corte por padrão e trim só com --guides", async ({ page }, info) => {
  const server = await startServer(ROOT);
  try {
    for (const [options, expected] of [[{}, "solid"], [{ rounded: true }, "solid"], [{ trim: true }, "none"], [{ trim: true, guides: true }, "solid"]]) {
      const png = await renderCard(page, `http://127.0.0.1:${server.address().port}`, "template.html", card, options);
      expect(await page.locator("carta").evaluate(el => getComputedStyle(el).outlineStyle)).toBe(expected);
      if (!options.trim) {
        const { data, info: pixels } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const edge = Math.round(MM.bleedMargin / 25.4 * 96);
        const y = Math.floor(pixels.height / 2);
        const reds = [edge - 1, edge, edge + 1].map(x => data[(y * pixels.width + x) * pixels.channels]);
        expect(Math.min(...reds)).toBeLessThan(0x45 - 5);
        expect(data[(y * pixels.width + edge - 4) * pixels.channels]).toBe(0x45);
        await fs.writeFile(info.outputPath("bleed-guide.png"), png);
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test("--out aceita pasta opcional e mantém os demais argumentos", () => {
  const file = "cards/Fluffusion.json";
  expect(parseArgs([file]).out).toBe("out");
  expect(parseArgs([file, "--out"]).out).toBe(path.join("out", "Fluffusion"));
  const options = parseArgs([file, "--out", "--trim", "--ids", "01"]);
  expect(options.out).toBe(path.join("out", "Fluffusion"));
  expect(options.trim).toBe(true);
  expect(options.ids).toEqual(["01"]);
  expect(parseArgs([file, "--out", "custom/output"]).out).toBe("custom/output");
  expect(parseArgs(["cards/Meu Deck.json", "--out"]).out).toBe(path.join("out", "Meu Deck"));
  expect(parseArgs([file, "cards/exemplo1.json", "--out"]).out).toBe(path.join("out", "deck"));
  expect(parseArgs([file, "--out", "custom", "--out"]).out).toBe(path.join("out", "Fluffusion"));
  expect(parseArgs([file, "--out", "--trim", "--out", "custom"]).out).toBe("custom");
});

test("CLI com --out sem pasta cria subpastas por tipo no nome do JSON", async ({}, info) => {
  const directory = info.outputPath("automatic-output");
  await fs.mkdir(directory, { recursive: true });
  const name = `Deck de teste ${process.pid}`;
  const input = path.join(directory, `${name}.json`);
  await fs.writeFile(input, JSON.stringify(card));
  const output = path.resolve(ROOT, "out", name);
  expect(path.dirname(output)).toBe(path.resolve(ROOT, "out"));
  try {
    await run(process.execPath, ["build.mjs", input, "--out", "--trim", "--text", "--save-html"], { cwd: ROOT });
    expect(await fs.readdir(output)).toEqual(["html", "text", "trim"]);
    expect(await fs.readdir(path.join(output, "trim"))).toEqual(["sample_trim_300dpi.png"]);
    expect(await fs.readdir(path.join(output, "text"))).toEqual(["sample_text_trim_300dpi.png"]);
    expect(await fs.readdir(path.join(output, "html"))).toEqual(["sample.html"]);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});
