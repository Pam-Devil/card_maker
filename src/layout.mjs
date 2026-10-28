// Executada no navegador; compartilhada pela prévia e pelo exportador.
// Retorna a fonte final da descrição em mm, ou null se o template não tiver effect-text.
export async function applyCard({ card, art, guides = false }) {
  const el = document.querySelector("card-data");
  if (!el) throw new Error("Template sem card-data");
  for (const field of ["element", "name", "archetype", "cost", "atk", "hp", "effect"]) {
    el.setAttribute(`data-${field}`, String(card[field] ?? ""));
  }
  for (const field of ["cost", "atk", "hp", "archetype"]) {
    el.style.setProperty(`--card-${field}`, JSON.stringify(String(card[field] ?? "")));
  }
  el.style.setProperty("--card-art", art ? `url(${JSON.stringify(art)})` : "none");
  el.style.setProperty("--art-position", card.artPosition ?? "50% 30%");
  el.toggleAttribute("data-guides", guides);
  const name = el.querySelector("card-name span");
  const effect = el.querySelector("effect-text");
  const hp = el.querySelector("hp span");
  const cost = el.querySelector("cost span");
  if (name) name.textContent = card.name ?? "";
  if (effect) {
    const text = String(card.effect ?? "");
    const lines = text.split(/\r\n|\n|\r/);
    if (!lines.some(line => line.trim() === "---")) effect.textContent = text;
    else {
      const nodes = [];
      let section = [];
      function flushSection() {
        if (!section.length) return;
        const block = document.createElement("span");
        block.className = "effect-section";
        block.textContent = section.join("\n");
        nodes.push(block);
        section = [];
      }
      for (const line of lines) {
        if (line.trim() === "---") {
          flushSection();
          const separator = document.createElement("hr");
          separator.className = "effect-separator";
          nodes.push(separator);
        } else section.push(line);
      }
      flushSection();
      effect.replaceChildren(...nodes);
    }
  }
  if (hp) hp.textContent = String(card.hp);
  if (cost) cost.textContent = String(card.cost);

  await document.fonts.ready;
  if (art) await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Falha ao carregar a arte: ${art}`));
    image.src = art;
  });

  function textFits(element, { mode = "both", target = element } = {}) {
    const width = target.scrollWidth <= target.clientWidth + 0.5;
    const height = target.scrollHeight <= target.clientHeight + 0.5;
    return mode === "width" ? width : width && height;
  }

  function warnOverflow(element, current, options = {}) {
    const original = element.style.fontSize;
    let recommended = "indisponível";
    function fits(size) {
      element.style.fontSize = `${size}mm`;
      return textFits(element, options);
    }
    try {
      // Mede também abaixo do mínimo automático, sem alterar a fonte exportada.
      let low = 0.01, high = current;
      if (high >= low && fits(low)) {
        while (high - low > 0.001) {
          const mid = (low + high) / 2;
          if (fits(mid)) low = mid;
          else high = mid;
        }
        // Arredonda para baixo para que o valor informado ainda caiba na caixa.
        recommended = `${(Math.floor(low * 100) / 100).toFixed(2)} mm`;
      }
    } finally { element.style.fontSize = original; }
    console.warn(`[ID ${card.id ?? "sem ID"}] Texto excede a caixa | fonte atual: ${current.toFixed(2)} mm | fonte máxima recomendada: ${recommended}`);
  }

  function fitText(element, { max, min, mode = "both", target = element }) {
    if (!element) return;
    function fits(size) {
      element.style.fontSize = `${size}mm`;
      return textFits(element, { mode, target });
    }
    if (fits(max)) return;
    if (!fits(min)) {
      warnOverflow(element, min, { mode, target });
      return;
    }
    let low = min, high = max;
    while (high - low > 0.01) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid;
      else high = mid;
    }
    element.style.fontSize = `${low}mm`;
  }

  fitText(name, { max: 4, min: 2, mode: "width", target: name?.parentElement });
  if (effect && card.font_size != null) {
    effect.style.fontSize = `${card.font_size}mm`;
    if (!textFits(effect)) warnOverflow(effect, card.font_size);
  } else fitText(effect, { max: 2.8, min: 1.5 });
  fitText(hp, { max: 5.4, min: 1.5, mode: "width" });
  fitText(cost, { max: 9, min: 1.5 });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return effect ? parseFloat(effect.style.fontSize) : null;
}
