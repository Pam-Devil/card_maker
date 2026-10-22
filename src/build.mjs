import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { createArtServers } from "./art-server.mjs";
import { validateCard, slug, parseDeck } from "./cards.mjs";
import { renderCard, renderText, cardHtml } from "./render.mjs";
import { exportPng, MM } from "./export.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function build(args) {
  const outDir = path.resolve(ROOT, args.out);
  const templateAbs = path.resolve(ROOT, args.template);
  const relative = path.relative(ROOT, templateAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("O template deve estar dentro do projeto");
  await fs.access(templateAbs);
  const templateName = relative.split(path.sep).map(encodeURIComponent).join("/");
  await fs.mkdir(outDir, { recursive: true });
  const server = await startServer(ROOT);
  const artServers = createArtServers(path.join(ROOT, "assets", "art"));
  let browser;
  let count = 0, failed = 0;
  const names = new Set();
  const selectedIds = args.ids ? new Set(args.ids.map(String)) : null;
  const foundIds = new Set();
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 500, height: 600 }, deviceScaleFactor: args.dpi / 96 });
    const page = await context.newPage();
    page.on("console", message => { if (message.type() === "warning") console.warn(`  ⚠ ${message.text()}`); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const mode = args.trim ? "trim" : "bleed";
    console.log(`DPI ${args.dpi} | ${mode}: ${args.trim ? MM.trimW : MM.bleedW} × ${args.trim ? MM.trimH : MM.bleedH} mm`);
    for (const file of args.files) {
      const raw = JSON.parse(await fs.readFile(path.resolve(ROOT, file), "utf8"));
      const cards = parseDeck(raw);
      for (const [index, card] of cards.entries()) {
        if (selectedIds) {
          const id = card?.id == null ? null : String(card.id);
          if (!selectedIds.has(id)) continue;
          foundIds.add(id);
        }
        let label = `#${index + 1}`;
        try {
          label = validateCard(card, index);
          const name = slug(card.id ?? card.name ?? `card-${index + 1}`);
          if (!name) throw new Error(`[${label}] nome de arquivo vazio`);
          if (names.has(name)) throw new Error(`[${label}] nome de saída duplicado: ${name}`);
          names.add(name);
          await artServers.ensure(card.art);
          const png = await renderCard(page, baseUrl, templateName, card, args);
          const text = args.text ? await renderText(page, args) : null;
          const filename = `${name}_${mode}_${args.dpi}dpi.png`;
          const textFilename = `${name}_text_${mode}_${args.dpi}dpi.png`;
          await exportPng(png, path.join(outDir, filename), args);
          if (text) {
            await exportPng(text.png, path.join(outDir, textFilename), { ...args, rounded: false }, text.size);
          }
          if (args.saveHtml) {
            const relativeRoot = path.relative(outDir, ROOT).split(path.sep).join("/") || ".";
            await fs.writeFile(path.join(outDir, `${name}.html`), await cardHtml(page, baseUrl, relativeRoot));
          }
          console.log(`✔ ${label} -> ${filename}${text ? ` + ${textFilename}` : ""}`);
          count++;
        } catch (error) {
          failed++;
          console.error(`✘ ${label}: ${error.message}`);
        }
      }
    }
    if (selectedIds) {
      const missing = [...selectedIds].filter(id => !foundIds.has(id));
      if (missing.length) {
        failed += missing.length;
        console.error(`✘ IDs não encontrados nos JSONs: ${missing.join(", ")}`);
      }
    }
  } finally {
    try { await browser?.close(); }
    finally {
      try { await artServers.close(); }
      finally { await new Promise(resolve => server.close(resolve)); }
    }
  }
  console.log(`Concluído: ${count} carta(s) gerada(s), ${failed} com erro. Pasta: ${outDir}`);
  if (failed) process.exitCode = 1;
  return { count, failed };
}
