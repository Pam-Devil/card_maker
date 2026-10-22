import { applyCard } from "./layout.mjs";

export async function renderCard(page, baseUrl, templateName, card, opts) {
  await page.goto(`${baseUrl}/${templateName}`, { waitUntil: "load" });
  const art = card.art ? new URL(card.art.replaceAll("\\", "/"), `${baseUrl}/`).href : null;
  await page.evaluate(applyCard, { card, art, guides: !opts.trim || !!opts.guides });
  await page.locator("card-data").evaluate((el, separate) => el.toggleAttribute("data-separate-text", separate), !!opts.text);
  // Captura a área solicitada diretamente: o recorte não depende de arredondamentos da sangria.
  const box = await page.locator(opts.trim ? ".trim" : ".card-bleed").boundingBox();
  if (!box) throw new Error("Template sem área de exportação visível");
  return page.screenshot({ clip: box, omitBackground: false });
}

// A altura acompanha a caixa e o espaço até a borda inferior da área exportada.
export async function renderText(page, opts) {
  let backgroundStyle;
  try {
    const size = await page.evaluate(({ trim }) => {
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
      return { width: cardBox.width * 25.4 / 96, height: height * 25.4 / 96 };
    }, { trim: !!opts.trim });
    backgroundStyle = await page.addStyleTag({ content: "html, body { background: transparent !important; }" });
    const box = await page.locator("text-export").boundingBox();
    const png = await page.screenshot({ clip: box, omitBackground: true });
    return { png, size };
  } finally {
    await backgroundStyle?.evaluate(el => el.remove());
    await page.evaluate(() => {
      document.querySelector("text-export")?.remove();
      document.querySelector("card-data")?.removeAttribute("data-render-text");
    });
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
