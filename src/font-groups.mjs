import { getFontGroup } from "./conditional-variables.mjs";

/** Mede todos os membros dos grupos necessários, mesmo com seleção parcial de IDs. */
export async function resolveGroupFontSizes(cards, measure, { selectedIds = null } = {}) {
  const groups = new Map();
  for (const card of cards) {
    const group = getFontGroup(card);
    if (!group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(card);
  }
  const sizes = new Map();
  for (const [group, members] of groups) {
    if (selectedIds && !members.some(card => card.id != null && selectedIds.has(String(card.id)))) continue;
    let minimum = Infinity;
    for (const card of members) {
      try {
        const size = await measure(card);
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
          throw new Error("O template precisa permitir a medição da fonte de effect-text");
        }
        minimum = Math.min(minimum, size);
      } catch (error) {
        throw new Error(`[${card.id ?? card.name ?? "sem ID"}] Não foi possível calcular a fonte mínima de ${group.label}: ${error.message}`);
      }
    }
    for (const card of members) sizes.set(card, minimum);
  }
  return sizes;
}
