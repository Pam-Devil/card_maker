import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { createArtServers } from "./art-server.mjs";
import { validateCard, slug, parseDeck } from "./cards.mjs";
import { renderCard, renderText, renderBgText, cardHtml, resolveCardFontGroups } from "./render.mjs";
import { exportPng, MM } from "./export.mjs";
import { createPrintPdfs } from "./pdf.mjs";
import { CSS_DPI, pxToMm } from "./units.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function build(args) {
  const outDir = path.resolve(ROOT, args.out);
  const mode = args.trim ? "trim" : "bleed";
  const output = {
    cards: path.join(outDir, mode), text: path.join(outDir, "text"),
    bgText: path.join(outDir, "bg_text"), pdf: path.join(outDir, "pdf"), html: path.join(outDir, "html"),
  };
  const templateAbs = path.resolve(ROOT, args.template);
  const relative = path.relative(ROOT, templateAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("O template deve estar dentro do projeto");
  await fs.access(templateAbs);
  const templateName = relative.split(path.sep).map(encodeURIComponent).join("/");
  const directories = [output.cards];
  if (args.text || args.pdfText) directories.push(output.text);
  if (args.bgText) directories.push(output.bgText);
  if (args.saveHtml) directories.push(output.html);
  await Promise.all(directories.map(directory => fs.mkdir(directory, { recursive: true })));
  const server = await startServer(ROOT);
  const artServers = createArtServers(path.join(ROOT, "assets", "art"));
  let browser;
  let count = 0, failed = 0;
  const names = new Set();
  const entries = [];
  const selectedIds = args.ids ? new Set(args.ids.map(String)) : null;
  const foundIds = new Set();
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 500, height: 600 }, deviceScaleFactor: args.dpi / CSS_DPI });
    const page = await context.newPage();
    page.on("console", message => { if (message.type() === "warning") console.warn(`  ⚠ ${message.text()}`); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log(`DPI ${args.dpi} | ${mode}: ${args.trim ? MM.trimW : MM.bleedW} × ${args.trim ? MM.trimH : MM.bleedH} mm`);
    for (const file of args.files) {
      const raw = JSON.parse(await fs.readFile(path.resolve(ROOT, file), "utf8"));
      const cards = parseDeck(raw);
      const groupFonts = await resolveCardFontGroups(context, baseUrl, templateName, cards, selectedIds);
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
          const groupFont = groupFonts.get(card);
          const renderData = groupFont === undefined ? card : { ...card, font_size: groupFont };
          const png = await renderCard(page, baseUrl, templateName, renderData, args);
          const fontPixels = await page.evaluate(() => {
            const effect = document.querySelector(".card-bleed effect-text");
            return effect ? parseFloat(getComputedStyle(effect).fontSize) : null;
          });
          const fontSize = fontPixels == null ? null : pxToMm(fontPixels);
          const text = args.text || args.pdfText ? await renderText(page, args) : null;
          const bgText = args.bgText ? await renderBgText(page, args) : null;
          const filename = `${name}_${mode}_${args.dpi}dpi.png`;
          const textFilename = `${name}_text_${mode}_${args.dpi}dpi.png`;
          const bgTextFilename = `${name}_bg_text_${mode}_${args.dpi}dpi.png`;
          const imagePath = path.join(output.cards, filename);
          const textPath = path.join(output.text, textFilename);
          const bgTextPath = path.join(output.bgText, bgTextFilename);
          await exportPng(png, imagePath, args);
          if (text) {
            await exportPng(text.png, textPath, { ...args, rounded: false }, text.size);
          }
          if (bgText) {
            await exportPng(bgText.png, bgTextPath, { ...args, roundedBottomOnly: true }, bgText.size);
          }
          if (args.saveHtml) {
            const relativeRoot = path.relative(output.html, ROOT).split(path.sep).join("/") || ".";
            await fs.writeFile(path.join(output.html, `${name}.html`), await cardHtml(page, baseUrl, relativeRoot));
          }
          entries.push({ imagePath, quantity: card.quantity ?? 1,
            textPath: text ? textPath : null, textSize: text?.size, textBounds: text?.bounds,
            bgTextPath: bgText ? bgTextPath : null, bgTextSize: bgText?.size });
          const fontMode = groupFont !== undefined ? "mínima do grupo" : card.font_size == null ? "automática" : "fixa";
          const fontInfo = fontSize == null ? "" : ` | fonte: ${fontSize.toFixed(2)} mm (${fontMode})`;
          console.log(`✔ ${label} -> ${mode}/${filename}${text ? ` + text/${textFilename}` : ""}${bgText ? ` + bg_text/${bgTextFilename}` : ""}${fontInfo}`);
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
  if (args.pdf || args.pdfText) {
    if (failed) console.error("PDF não gerado: corrija as cartas ou os IDs com erro e execute novamente.");
    else await createPrintPdfs(entries, output.pdf, args);
  }
  console.log(`Concluído: ${count} carta(s) gerada(s), ${failed} com erro. Pasta: ${outDir}`);
  if (failed) process.exitCode = 1;
  return { count, failed };
}
