// Executada no navegador; compartilhada pela prévia e pelo exportador.
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
  if (effect) effect.textContent = card.effect ?? "";
  if (hp) hp.textContent = String(card.hp);
  if (cost) cost.textContent = String(card.cost);

  await document.fonts.ready;
  if (art) await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Falha ao carregar a arte: ${art}`));
    image.src = art;
  });

  function fitText(element, { max, min, mode = "both", target = element }) {
    if (!element) return;
    function fits(size) {
      element.style.fontSize = `${size}mm`;
      const width = target.scrollWidth <= target.clientWidth + 0.5;
      const height = target.scrollHeight <= target.clientHeight + 0.5;
      return mode === "width" ? width : width && height;
    }
    if (fits(max)) return;
    if (!fits(min)) {
      console.warn(`Texto excede a caixa na fonte mínima: ${element.textContent}`);
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
  fitText(effect, { max: 2.8, min: 1.5 });
  fitText(hp, { max: 5.4, min: 1.5, mode: "width" });
  fitText(cost, { max: 9, min: 1.5 });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
