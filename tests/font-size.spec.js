import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { parseDeck, validateCard } from "../src/cards.mjs";
import { applyCard } from "../src/layout.mjs";
import { ROOT } from "../src/build.mjs";
import { startServer } from "../src/server.mjs";
import { renderText } from "../src/render.mjs";
import { mmToPx } from "../src/export.mjs";

const run = promisify(execFile);
const card = { id: "font", name: "Prismuff", element: "caelo", cost: 1, atk: 0, hp: 3, effect: "Descrição da carta." };
const mm = px => px * 25.4 / 96;
async function withTemplate(page, check) {
  const server = await startServer(ROOT);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/template.html`);
    await check();
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const apply = (page, value) => page.evaluate(applyCard, { card: value, art: null });
const size = page => page.locator("effect-text").evaluate(el => parseFloat(getComputedStyle(el).fontSize));

test("font_size preserva decimais e aceita null ou campo omitido", () => {
  for (const font_size of [null, 0.5, 1.2, 2.33, 2.58, 4]) {
    const raw = { ...card, font_size }, before = JSON.stringify(raw);
    const [result] = parseDeck(raw);
    expect(result.font_size).toBe(font_size);
    expect(() => validateCard(result, 0)).not.toThrow();
    expect(JSON.stringify(raw)).toBe(before);
  }
  expect(() => validateCard(parseDeck(card)[0], 0)).not.toThrow();
});

test("font_size rejeita números inválidos, zero, negativos e texto", () => {
  for (const font_size of [0, -1, Infinity, NaN, "2.58", "2.58mm", true, {}, []]) {
    expect(() => validateCard({ ...card, font_size }, 0)).toThrow("font_size deve ser um número finito maior que zero");
  }
});

test("font_size fixa a fonte e null restaura o ajuste automático entre cartas", async ({ page }) => {
  await withTemplate(page, async () => {
    const long = { ...card, effect: "Uma descrição longa com várias regras de efeito. ".repeat(12) };
    await apply(page, long);
    const automatic = await size(page);
    expect(mm(automatic)).toBeLessThan(2.8);
    await apply(page, { ...long, font_size: 1.2 });
    expect(mm(await size(page))).toBeCloseTo(1.2, 3);
    await apply(page, { ...long, font_size: null });
    expect(await size(page)).toBe(automatic);
    await apply(page, { ...card, font_size: 3.25 });
    expect(mm(await size(page))).toBeCloseTo(3.25, 3);
    await apply(page, card);
    expect(mm(await size(page))).toBeCloseTo(2.8, 3);
  });
});

for (const font_size of [4, null]) {
  test(`alerta de excesso informa ID e fontes sem repetir a descrição: font_size=${font_size}`, async ({ page }) => {
    const warnings = [];
    page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
    await withTemplate(page, async () => {
      const overflowing = { ...card, font_size, effect: "Uma descrição muito longa. ".repeat(50) };
      await apply(page, overflowing);
      const current = font_size ?? 1.5;
      expect(mm(await size(page))).toBeCloseTo(current, 3);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(new RegExp(`^\\[ID font\\] Texto excede a caixa \\| fonte atual: ${current.toFixed(2)} mm \\| fonte máxima recomendada: [0-9]+\\.[0-9]{2} mm$`));
      expect(warnings[0]).not.toContain("Uma descrição");
      const recommended = Number(warnings[0].match(/recomendada: ([\d.]+)/)[1]);
      expect(recommended).toBeGreaterThan(0);
      expect(recommended).toBeLessThan(1.5);
      warnings.length = 0;
      await apply(page, { ...overflowing, font_size: recommended });
      expect(warnings).toHaveLength(0);
      expect(await page.locator("effect-text").evaluate(el => el.scrollHeight <= el.clientHeight + 0.5 && el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
      await apply(page, { ...overflowing, font_size: recommended + 0.02 });
      expect(warnings).toHaveLength(1);
    });
  });
}

test("alerta lida com separadores que não cabem mesmo reduzindo a fonte", async ({ page }) => {
  const warnings = [];
  page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await withTemplate(page, async () => {
    await apply(page, { ...card, font_size: 2.58, effect: Array(100).fill("---").join("\n") });
    expect(warnings).toEqual(["[ID font] Texto excede a caixa | fonte atual: 2.58 mm | fonte máxima recomendada: indisponível"]);
    expect(mm(await size(page))).toBeCloseTo(2.58, 3);
  });
});

test("font_size mantém a fonte decimal em --text e no HTML exportado", async ({ page }, info) => {
  await withTemplate(page, async () => {
    await apply(page, { ...card, font_size: 2.58, effect: "Primeiro efeito.\n---\nSegundo efeito." });
    const before = await size(page);
    const exported = await renderText(page, { trim: true });
    expect(mm(await size(page))).toBeCloseTo(2.58, 3);
    expect(await size(page)).toBe(before);
    expect((await sharp(exported.png).metadata()).hasAlpha).toBe(true);
  });
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify({ variables: { font: 2.58, alias: "${font}" },
    cards: [{ ...card, font_size: "${alias}" }] }));
  const { stdout } = await run(process.execPath, ["build.mjs", input, "--trim", "--text", "--save-html", "--out", directory], { cwd: ROOT });
  const html = await fs.readFile(path.join(directory, "html", "font.html"), "utf8");
  expect(html).toContain('font-size: 2.58mm;');
  expect(stdout).toContain("fonte: 2.58 mm (fixa)");
  expect(html).not.toContain("<text-export");
  const text = await sharp(path.join(directory, "text", "font_text_trim_300dpi.png")).metadata();
  expect(text.width).toBe(mmToPx(63, 300));
  expect(text.height).toBe(mmToPx(37, 300));
});


test("CLI aceita variável null em font_size e gera a descrição com ajuste automático", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  const raw = { variables: { auto_font: null, alias: "${auto_font}" },
    cards: [{ ...card, font_size: "${alias}", effect: "Uma descrição longa com várias regras de efeito. ".repeat(12) }] };
  const [resolved] = parseDeck(raw);
  expect(resolved.font_size).toBeNull();
  expect(() => validateCard(resolved, 0)).not.toThrow();
  // A variável null não contorna as validações de campos obrigatórios.
  for (const field of ["cost", "hp", "quantity"]) {
    const [invalid] = parseDeck({ variables: { empty: null }, cards: [{ ...card, [field]: "${empty}" }] });
    expect(() => validateCard(invalid, 0)).toThrow();
  }
  await fs.writeFile(input, JSON.stringify(raw));
  const { stdout } = await run(process.execPath, ["build.mjs", input, "--trim", "--text", "--save-html", "--out", directory], { cwd: ROOT });
  const html = await fs.readFile(path.join(directory, "html", "font.html"), "utf8");
  const adjusted = Number(html.match(/<effect-text style="font-size: ([\d.]+)mm;/)[1]);
  expect(adjusted).toBeLessThan(2.8);
  expect(stdout).toContain(`fonte: ${adjusted.toFixed(2)} mm (automática)`);
  expect(html).not.toContain("${");
  expect((await sharp(path.join(directory, "text", "font_text_trim_300dpi.png")).metadata()).hasAlpha).toBe(true);
});


test("font_size preserva variáveis decimais sem alterar a precisão dos outros campos", () => {
  const raw = { variables: { "fonte base": 2.58, alias: "${fonte base}" }, cards: [
    { ...card, font_size: "${alias}", hp: "${alias}", quantity: "${alias}", effect: "${alias}" },
    { ...card, effect: "${alias}", font_size: "${alias}", hp: "${alias}" },
  ] };
  const before = JSON.stringify(raw);
  const result = parseDeck(raw);
  expect(result).toMatchObject([
    { font_size: 2.58, hp: 2, quantity: 2, effect: 2 },
    { font_size: 2.58, hp: 2, effect: 2 },
  ]);
  result.forEach((card, index) => expect(() => validateCard(card, index)).not.toThrow());
  expect(JSON.stringify(raw)).toBe(before);
});

test("font_size mantém frações nas dependências, nomes dinâmicos e cálculos", () => {
  const variables = { base: 2.58, half: "${base / 2}", factor: 0.5,
    caelo_font: "${half * 2}", divided: "${base / factor}", automatic: null };
  const result = parseDeck({ variables, cards: [
    { ...card, font_size: "${${element}_font}", effect: "${caelo_font}" },
    { ...card, font_size: "${divided}" },
    { ...card, font_size: "${hp / 2}", hp: 5.9 },
    { ...card, font_size: "${round(base)}" },
    { ...card, font_size: "${automatic}" },
  ] });
  expect(result.map(card => card.font_size)).toEqual([2.58, 5.16, 2.5, 3, null]);
  expect(result[0].effect).toBe(2);
  result.forEach((card, index) => expect(() => validateCard(card, index)).not.toThrow());
});

test("font_size decimal mantém erros de cálculos, referências e valores inválidos", () => {
  for (const variables of [
    { font: "${1 / 0}" }, { font: "${missing}" }, { font: "${font}" },
  ]) expect(() => parseDeck({ variables, cards: [{ ...card, font_size: "${font}" }] })).toThrow();
  for (const font of [0, -0.5, "2.58mm"]) {
    const [result] = parseDeck({ variables: { font }, cards: [{ ...card, font_size: "${font}" }] });
    expect(() => validateCard(result, 0)).toThrow("font_size deve ser um número finito maior que zero");
  }
  // Uma fórmula compartilhada ainda usa truncamento e validação quando lida fora de font_size.
  expect(() => parseDeck({ variables: { base: 2.58, factor: 0.5, font: "${base / factor}" },
    cards: [{ ...card, font_size: "${font}", effect: "${font}" }] })).toThrow("Cálculo exige números finitos");
});


test("CLI mostra um alerta resumido de excesso e preserva a fonte exportada", async ({}, info) => {
  const directory = info.outputPath("overflow");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify([{ ...card, id: "015", font_size: 4,
    effect: "Conteúdo que não deve ser repetido no console. ".repeat(50) }]));
  const { stderr, stdout } = await run(process.execPath,
    ["build.mjs", input, "--trim", "--save-html", "--out", directory], { cwd: ROOT });
  expect(stderr.match(/Texto excede a caixa/g)).toHaveLength(1);
  expect(stderr).toContain("[ID 015] Texto excede a caixa | fonte atual: 4.00 mm | fonte máxima recomendada:");
  expect(stderr + stdout).not.toContain("Conteúdo que não deve ser repetido");
  expect(stdout).toContain("fonte: 4.00 mm (fixa)");
  expect(await fs.readFile(path.join(directory, "html", "015.html"), "utf8")).toContain('font-size: 4mm;');
});
