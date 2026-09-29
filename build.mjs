#!/usr/bin/env node
/**
 * JSON -> carta (template.html) -> PNG em resolução de impressão.
 *
 * Uso:
 *   node build.mjs cards/exemplo.json
 *   node build.mjs cards/exemplo.json --dpi 600 --trim --out saida
 *
 * Opções:
 *   --dpi <n>        300 (padrão) ou 600
 *   --out <pasta>    pasta de saída (padrão: out)
 *   --trim           gera também o PNG só da área de corte (sem sangria)
 *   --rounded        mantém os cantos arredondados na sangria (padrão: retangular)
 *   --guides         mantém a guia vermelha de corte do template
 *   --save-html      salva o HTML final de cada carta (debug)
 *   --template <f>   template alternativo (padrão: template.html)
 */
import { chromium } from "playwright";
import sharp from "sharp";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// ---------- medidas físicas (mm), conforme o CSS do template ----------
const MM = { bleedW: 65, bleedH: 92, trimW: 59, trimH: 86, bleedMargin: 3 };
const ELEMENTS = ["pyro", "hydro", "electro", "anemo", "cryo", "dendro", "geo"];
const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

// ---------- args ----------
function parseArgs(argv) {
  const args = { dpi: 300, out: "out", template: "template.html", files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dpi") args.dpi = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--template") args.template = argv[++i];
    else if (a === "--trim") args.trim = true;
    else if (a === "--rounded") args.rounded = true;
    else if (a === "--guides") args.guides = true;
    else if (a === "--save-html") args.saveHtml = true;
    else if (a.startsWith("--")) throw new Error(`Opção desconhecida: ${a}`);
    else args.files.push(a);
  }
  if (!args.files.length) throw new Error("Passe ao menos um arquivo JSON. Ex: node build.mjs cards/exemplo.json");
  if (!(args.dpi > 0)) throw new Error("--dpi inválido");
  return args;
}

// ---------- servidor estático (necessário p/ máscaras SVG: file:// bloqueia por CORS) ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".css": "text/css",
  ".js": "text/javascript", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const data = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// ---------- helpers ----------
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Texto -> string CSS válida. "\n" no JSON vira quebra de linha real. */
function cssString(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const esc = (l) => l.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${lines.map(esc).join("\\A ")}"`;
}

function validate(card, idx) {
  const label = card.id ?? card.name ?? `#${idx + 1}`;
  if (!ELEMENTS.includes(card.element))
    throw new Error(`[${label}] element inválido: "${card.element}". Use: ${ELEMENTS.join(", ")}`);
  for (const k of ["cost", "atk", "hp"])
    if (card[k] === undefined || card[k] === null) throw new Error(`[${label}] campo obrigatório ausente: ${k}`);
  return label;
}

const isRemote = (u) => /^(https?:|data:)/i.test(u);

// ---------- render ----------
async function renderCard(page, baseUrl, templateName, card, opts) {
  await page.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });

  const art = card.art
    ? (isRemote(card.art) ? card.art : `${baseUrl}/${card.art.replace(/^\.?\//, "")}`)
    : null;

  await page.evaluate(({ card, art, effectCss, nameCss, rounded, guides }) => {
    const el = document.querySelector("card-data");
    el.setAttribute("data-element", card.element);
    el.setAttribute("data-cost", card.cost);
    el.setAttribute("data-atk", card.atk);
    el.setAttribute("data-hp", card.hp);
    el.setAttribute("data-effect", card.effect ?? "");

    // strings CSS explícitas (não dependem do suporte a attr() do navegador)
    el.style.setProperty("--card-cost", JSON.stringify(String(card.cost)));
    el.style.setProperty("--card-atk", JSON.stringify(String(card.atk)));
    el.style.setProperty("--card-hp", JSON.stringify(String(card.hp)));
    el.style.setProperty("--card-effect", effectCss);
    if (art) el.style.setProperty("--card-art", `url("${art}")`);

    // nome: o texto vem do CSS (::after com var(--card-name)); mede com um span invisível
    // e reduz a fonte até caber (nomes longos não invadem custo/elemento)
    el.setAttribute("data-name", card.name ?? "");
    el.style.setProperty("--card-name", nameCss);
    const nameEl = document.querySelector("card-name");
    if (nameEl) {
      if (!card.name) nameEl.style.display = "none";
      else {
        const cs = getComputedStyle(nameEl);
        const avail = nameEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const minPx = (2.2 * 96) / 25.4; // ~2.2mm
        let size = parseFloat(cs.fontSize);

        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
        probe.textContent = card.name;
        nameEl.appendChild(probe);

        while (probe.getBoundingClientRect().width > avail && size > minPx) {
          size *= 0.95;
          nameEl.style.fontSize = size + "px";
        }
        if (probe.getBoundingClientRect().width > avail)
          console.warn("nome grande demais mesmo na fonte mínima: " + card.name);
        probe.remove();
      }
    }

    const st = document.createElement("style");
    st.textContent = `
      body { padding: 0 !important; }
      effect-text::before { white-space: pre-line; }
      ${rounded ? "" : ".card-bleed { border-radius: 0 !important; }"}
      ${guides ? "" : "card { outline: none !important; }"}
    `;
    document.head.appendChild(st);
  }, { card, art, effectCss: cssString(card.effect), nameCss: cssString(card.name), rounded: !!opts.rounded, guides: !!opts.guides });

  // espera fontes + arte carregarem
  await page.evaluate(async (art) => {
    await document.fonts.ready;
    if (art) await new Promise((res, rej) => {
      const img = new Image();
      img.onload = res; img.onerror = () => rej(new Error("Falha ao carregar a arte: " + art));
      img.src = art;
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, art);

  const box = await page.locator(".card-bleed").boundingBox();
  const buf = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    omitBackground: !!opts.rounded,
  });
  return buf;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, args.out);
  await fs.mkdir(outDir, { recursive: true });

  const templateAbs = path.resolve(ROOT, args.template);
  const templateName = path.relative(ROOT, templateAbs).split(path.sep).join("/");

  const W = mmToPx(MM.bleedW, args.dpi);
  const H = mmToPx(MM.bleedH, args.dpi);
  console.log(`DPI ${args.dpi} -> sangria ${W}x${H}px | corte ${mmToPx(MM.trimW, args.dpi)}x${mmToPx(MM.trimH, args.dpi)}px`);

  const server = await startServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 500, height: 600 },
    deviceScaleFactor: args.dpi / 96, // 1 px CSS = 1/96 in
  });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "warning") console.warn("  ⚠", m.text()); });

  let count = 0, failed = 0;
  try {
    for (const file of args.files) {
      const raw = JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
      const cards = Array.isArray(raw) ? raw : [raw];

      for (const [i, card] of cards.entries()) {
        let label = `#${i + 1}`;
        try {
          label = validate(card, i);
          const name = slug(card.id ?? card.name ?? `card-${i + 1}`);

          let png = await renderCard(page, baseUrl, templateName, card, args);

          // garante dimensão exata em px (o Chromium pode errar ±1px por causa do arredondamento de mm)
          const meta = await sharp(png).metadata();
          let img = sharp(png);
          if (meta.width !== W || meta.height !== H) img = img.resize(W, H, { fit: "fill" });
          const bleedBuf = await img.png().toBuffer();

          await sharp(bleedBuf).withMetadata({ density: args.dpi })
            .toFile(path.join(outDir, `${name}_bleed_${args.dpi}dpi.png`));

          if (args.trim) {
            const left = mmToPx(MM.bleedMargin, args.dpi);
            const top = left;
            const width = mmToPx(MM.trimW, args.dpi);
            const height = mmToPx(MM.trimH, args.dpi);
            await sharp(bleedBuf).extract({ left, top, width, height })
              .withMetadata({ density: args.dpi })
              .toFile(path.join(outDir, `${name}_trim_${args.dpi}dpi.png`));
          }

          if (args.saveHtml)
            await fs.writeFile(path.join(outDir, `${name}.html`), await page.content());

          console.log(`✔ ${label} -> ${name}_bleed_${args.dpi}dpi.png`);
          count++;
        } catch (err) {
          failed++;
          console.error(`✘ ${label}: ${err.message}`);
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\nConcluído: ${count} carta(s) gerada(s)${failed ? `, ${failed} com erro` : ""}. Pasta: ${outDir}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e.message); process.exit(1); });
