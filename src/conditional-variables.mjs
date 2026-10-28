const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const scalar = value => value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
const cardGroups = new WeakMap();

class AutoFontGroup {
  constructor(label) { this.label = label; }
}
export const isAutoFontGroup = value => value instanceof AutoFontGroup;
export const getFontGroup = card => cardGroups.get(card) ?? null;
export function setFontGroup(card, group) { cardGroups.set(card, group); }

function keys(value, allowed, label) {
  const invalid = Object.keys(value).find(key => !allowed.includes(key));
  if (invalid) throw new Error(`${label}: campo desconhecido "${invalid}"`);
}

function selector(raw, label) {
  if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) {
    throw new Error(`${label}: cada ID deve ser texto ou número finito`);
  }
  const text = String(raw).trim();
  if (!text) throw new Error(`${label}: ID vazio`);
  const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!range) return id => id != null && String(id) === text;
  const [, first, last] = range;
  const start = BigInt(first), end = BigInt(last);
  if (start > end) throw new Error(`${label}: intervalo invertido "${text}"`);
  const padded = /^0\d/.test(first) || /^0\d/.test(last);
  if (padded && first.length !== last.length) {
    throw new Error(`${label}: os extremos do intervalo com zeros à esquerda devem ter a mesma largura`);
  }
  return id => {
    if (id == null) return false;
    const candidate = String(id);
    if (!/^\d+$/.test(candidate)) return false;
    const number = BigInt(candidate);
    if (padded ? candidate.length !== first.length : candidate !== number.toString()) return false;
    return number >= start && number <= end;
  };
}

function literal(value, label) {
  if (scalar(value)) return value;
  if (object(value) && value.auto === "min") {
    keys(value, ["auto"], label);
    return new AutoFontGroup(label);
  }
  throw new Error(`${label} deve ser texto, número finito ou null, ou {"auto":"min"}`);
}

/** Compila seletores sem expandir intervalos e sem modificar o JSON. */
export function compileVariables(variables) {
  return new Map(Object.entries(variables).map(([name, value]) => {
    const label = `A variável "${name}"`;
    if (!object(value) || value.auto === "min") return [name, literal(value, label)];
    if (!Object.hasOwn(value, "cases") && !Object.hasOwn(value, "default")) {
      throw new Error(`${label} deve ser texto, número finito ou null, ou uma seleção com default e cases`);
    }
    keys(value, ["default", "cases"], label);
    if (!Array.isArray(value.cases)) throw new Error(`${label}: cases deve ser uma lista`);
    const fallback = literal(Object.hasOwn(value, "default") ? value.default : null, `${label}.default`);
    const cases = value.cases.map((rule, index) => {
      const where = `${label}.cases[${index}]`;
      if (!object(rule)) throw new Error(`${where}: o caso deve ser um objeto`);
      keys(rule, ["ids", "value"], where);
      const ids = typeof rule.ids === "string" ? rule.ids.split(",") : typeof rule.ids === "number" ? [rule.ids] : rule.ids;
      if (!Array.isArray(ids) || !ids.length) throw new Error(`${where}: ids deve conter ao menos um ID ou intervalo`);
      if (!Object.hasOwn(rule, "value")) throw new Error(`${where}: informe value`);
      const matches = ids.map(id => selector(id, where));
      return { matches, value: literal(rule.value, `${where} (${ids.join(", ")})`) };
    });
    return [name, id => {
      const match = cases.find(rule => rule.matches.some(matches => matches(id)));
      return match ? match.value : fallback;
    }];
  }));
}
