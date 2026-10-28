import { applyCard } from "./layout.mjs";
import { resolveGroupFontSizes } from "./font-groups.mjs";

// A calibração não carrega artes de cartas fora de --ids.
export async function resolveCardFontGroups(context, baseUrl, templateName, cards, selectedIds = null) {
  let probe;
  try {
    return await resolveGroupFontSizes(cards, async card => {
      if (!probe) {
        probe = await context.newPage();
        await probe.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });
      }
      await probe.evaluate(applyCard, { card, art: null });
      return probe.evaluate(() => {
        const effect = document.querySelector("effect-text");
        return effect ? parseFloat(effect.style.fontSize) : null;
      });
    }, { selectedIds });
  } finally { await probe?.close(); }
}

export async function renderCard(page, baseUrl, templateName, card, opts) {
  await page.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });
  const art = card.art ? new URL(card.art.replaceAll("\\", "/"), `${baseUrl}/`).href : null;
  await page.evaluate(applyCard, { card, art, guides: !opts.trim || !!opts.guides });
  await page.locator("card-data").evaluate((el, separate) => el.toggleAttribute("data-separate-text", separate), !!(opts.text || opts.noDescription));
  // Captura a área solicitada diretamente: o recorte não depende de arredondamentos da sangria.
  const box = await page.locator(opts.trim ? ".trim" : ".card-bleed").boundingBox();
  if (!box) throw new Error("Template sem área de exportação visível");
  return page.screenshot({ clip: box, omitBackground: false });
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
      const mm = px => px * 25.4 / 96;
      return {
        size: { width: mm(cardBox.width), height: mm(height) },
        bounds: { left: mm(border.left - stageBox.left), top: mm(border.top - stageBox.top),
          width: mm(border.width), height: mm(border.height) },
      };
    }, { trim: !!opts.trim });
    backgroundStyle = await page.addStyleTag({ content: "html, body { background: transparent !important; }" });
    const box = await page.locator("text-export").boundingBox();
    const png = await page.screenshot({ clip: box, omitBackground: true });
    return { png, ...geometry };
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
    const clip = { x: cardBox.left, y: top, width: cardBox.width, height: cardBox.bottom - top };
    const separate = data.hasAttribute("data-separate-text");
    data.removeAttribute("data-separate-text");
    return { clip, separate, size: { width: clip.width * 25.4 / 96, height: clip.height * 25.4 / 96 } };
  }, { trim: !!opts.trim });
  try {
    const png = await page.screenshot({ clip: geometry.clip, omitBackground: false });
    return { png, size: geometry.size };
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
