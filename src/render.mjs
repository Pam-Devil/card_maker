import { applyCard } from "./layout.mjs";
import { resolveGroupFontSizes } from "./font-groups.mjs";
import { pxToMm } from "./units.mjs";

// Com fullPage, clip usa coordenadas da página, inclusive fora do viewport.
async function documentBox(locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { x: box.left + window.scrollX, y: box.top + window.scrollY,
      width: box.width, height: box.height };
  });
}

// A calibração não carrega artes de cartas fora de --ids.
export async function resolveCardFontGroups(context, baseUrl, templateName, cards, selectedIds = null) {
  let probe;
  try {
    return await resolveGroupFontSizes(cards, async card => {
      if (!probe) {
        probe = await context.newPage();
        await probe.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });
      }
      return probe.evaluate(async ({ card, layoutUrl }) => {
        const { applyCard } = await import(layoutUrl);
        await applyCard({ card, art: null });
        const effect = document.querySelector("effect-text");
        if (!effect) throw new Error("Template sem effect-text para medir a fonte");
        // applyCard define a fonte inline em mm; não depende de seu retorno.
        return parseFloat(effect.style.fontSize);
      }, { card, layoutUrl: `${baseUrl}/src/layout.mjs` });
    }, { selectedIds });
  } finally { await probe?.close(); }
}

export async function renderCard(page, baseUrl, templateName, card, opts) {
  await page.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });
  const art = card.art ? new URL(card.art.replaceAll("\\", "/"), `${baseUrl}/`).href : null;
  await page.evaluate(applyCard, { card, art, guides: !opts.trim || !!opts.guides });
  await page.locator("card-data").evaluate((el, separate) => el.toggleAttribute("data-separate-text", separate), !!(opts.text || opts.noDescription));
  // Captura a área solicitada diretamente: o recorte não depende de arredondamentos da sangria.
  const box = await documentBox(page.locator(opts.trim ? ".trim" : ".card-bleed"));
  if (!box) throw new Error("Template sem área de exportação visível");
  return page.screenshot({ clip: box, fullPage: true, omitBackground: false });
}

// A altura acompanha a caixa e o espaço até a borda inferior da área exportada.
export async function renderText(page, opts) {
  let backgroundStyle;
  try {
    const geometry = await page.evaluate(({ trim }) => {
      const data = document.querySelector("card-data");
      const area = data.querySelector(trim ? ".trim" : ".card-bleed");
      const source = data.querySelector(".card-bleed effect");
      if (!source?.querySelector("effect-text") || !source.querySelector("effect-box")) {
        throw new Error("O template precisa de effect, effect-text e effect-box para usar --text");
      }
      const cardBox = area.getBoundingClientRect();
      const effectBox = source.getBoundingClientRect();
      const gap = cardBox.bottom - effectBox.bottom;
      if (gap < 0) throw new Error("A caixa de descrição ultrapassa a área da carta");
      const height = effectBox.height + 2 * gap;
      const stage = document.createElement("text-export");
      stage.style.width = `${cardBox.width}px`;
      stage.style.height = `${height}px`;
      stage.append(source.cloneNode(true));
      data.append(stage);
      data.setAttribute("data-render-text", "");
      const stageBox = stage.getBoundingClientRect();
      const border = stage.querySelector("effect-box").getBoundingClientRect();
      // Retorna pixels CSS; a conversão compartilhada ocorre fora de page.evaluate.
      return {
        size: { width: cardBox.width, height },
        bounds: { left: border.left - stageBox.left, top: border.top - stageBox.top,
          width: border.width, height: border.height },
      };
    }, { trim: !!opts.trim });
    backgroundStyle = await page.addStyleTag({ content: "html, body { background: transparent !important; }" });
    const box = await documentBox(page.locator("text-export"));
    if (!box) throw new Error("Template sem área de exportação de texto visível (--text)");
    const png = await page.screenshot({ clip: box, fullPage: true, omitBackground: true });
    return {
      png,
      size: { width: pxToMm(geometry.size.width), height: pxToMm(geometry.size.height) },
      bounds: Object.fromEntries(Object.entries(geometry.bounds).map(([key, value]) => [key, pxToMm(value)])),
    };
  } finally {
    await backgroundStyle?.evaluate(el => el.remove());
    await page.evaluate(() => {
      document.querySelector("text-export")?.remove();
      document.querySelector("card-data")?.removeAttribute("data-render-text");
    });
  }
}

// Recorta a própria carta, preservando a posição da arte e das molduras.
export async function renderBgText(page, opts) {
  const geometry = await page.evaluate(({ trim }) => {
    const data = document.querySelector("card-data");
    const area = data?.querySelector(trim ? ".trim" : ".card-bleed");
    const source = data?.querySelector(".card-bleed effect-box");
    if (!area || !source) throw new Error("O template precisa da área da carta e de effect-box para usar --bg-text");
    const cardBox = area.getBoundingClientRect();
    const textBox = source.getBoundingClientRect();
    const gap = cardBox.bottom - textBox.bottom;
    const top = textBox.top - gap;
    if (gap < 0 || top < cardBox.top) throw new Error("A região inferior ultrapassa a área da carta");
    const clip = { x: cardBox.left + window.scrollX, y: top + window.scrollY,
      width: cardBox.width, height: cardBox.bottom - top };
    const separate = data.hasAttribute("data-separate-text");
    data.removeAttribute("data-separate-text");
    return { clip, separate };
  }, { trim: !!opts.trim });
  try {
    const png = await page.screenshot({ clip: geometry.clip, fullPage: true, omitBackground: false });
    return { png, size: { width: pxToMm(geometry.clip.width), height: pxToMm(geometry.clip.height) } };
  } finally {
    await page.locator("card-data").evaluate((el, separate) => el.toggleAttribute("data-separate-text", separate), geometry.separate);
  }
}

// Rebaseia os recursos para que a prévia não dependa da porta temporária do exportador.
export async function cardHtml(page, baseUrl, relativeRoot) {
  const html = await page.evaluate(({ baseUrl, relativeRoot }) => {
    const clone = document.documentElement.cloneNode(true);
    for (const element of clone.querySelectorAll("[src], [href]")) {
      for (const attribute of ["src", "href"]) {
        if (!element.hasAttribute(attribute)) continue;
        const url = new URL(element.getAttribute(attribute), document.baseURI).href;
        if (url.startsWith(`${baseUrl}/`)) {
          element.setAttribute(attribute, `${relativeRoot}/${url.slice(baseUrl.length + 1)}`);
        }
      }
    }
    return `<!DOCTYPE html>\n${clone.outerHTML}`;
  }, { baseUrl, relativeRoot });
  return html.replaceAll(`${baseUrl}/`, `${relativeRoot}/`);
}
