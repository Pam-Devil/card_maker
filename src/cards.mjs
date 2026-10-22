export const ELEMENTS = ["pyro", "hydro", "electro", "anemo", "cryo", "dendro", "geo", "abysso", "caelo"];

export const slug = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function validateCard(card, index) {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error(`Carta #${index + 1} inválida`);
  const label = card.id ?? card.name ?? `#${index + 1}`;
  if (!ELEMENTS.includes(card.element)) throw new Error(`[${label}] element inválido: "${card.element}". Use: ${ELEMENTS.join(", ")}`);
  for (const field of ["cost", "atk", "hp"]) {
    if (card[field] === undefined || card[field] === null) throw new Error(`[${label}] campo obrigatório ausente: ${field}`);
  }
  if (card.art != null && typeof card.art !== "string") throw new Error(`[${label}] art deve ser um caminho ou URL`);
  return String(label);
}

/** Aceita carta única, lista de cartas ou { variables, cards }. */
export function parseDeck(raw) {
  if (Array.isArray(raw)) return raw;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(raw) || (!Object.hasOwn(raw, "cards") && !Object.hasOwn(raw, "variables"))) return [raw];
  if (!Array.isArray(raw.cards)) throw new Error('O bloco "cards" deve ser uma lista de cartas');
  const variables = raw.variables ?? {};
  if (!object(variables)) throw new Error('O bloco "variables" deve ser um objeto');
  const resolved = new Map();
  const resolving = [];
  const reference = /\$\{([^{}]+)\}/g;

  function variable(name) {
    if (!Object.hasOwn(variables, name)) throw new Error(`Variável não definida: ${name}`);
    if (resolved.has(name)) return resolved.get(name);
    if (resolving.includes(name)) throw new Error(`Referência circular entre variáveis: ${[...resolving, name].join(" -> ")}`);
    const value = variables[name];
    if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) {
      throw new Error(`A variável "${name}" deve ser texto ou número`);
    }
    resolving.push(name);
    const result = interpolate(value);
    resolving.pop();
    resolved.set(name, result);
    return result;
  }

  function interpolate(value) {
    if (typeof value !== "string") return value;
    // Uma referência isolada mantém o tipo, por exemplo hp: "${life}" vira número.
    const exact = value.match(/^\$\{([^{}]+)\}$/);
    if (exact) return variable(exact[1]);
    return value.replace(reference, (_, name) => String(variable(name)));
  }

  function expand(value) {
    if (Array.isArray(value)) return value.map(expand);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item)]));
    return interpolate(value);
  }

  for (const name of Object.keys(variables)) variable(name);
  return raw.cards.map(expand);
}
