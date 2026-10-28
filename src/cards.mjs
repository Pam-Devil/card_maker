import { evaluateExpression, integer, numericValue } from "./expressions.mjs";
import { compileVariables, isAutoFontGroup, setFontGroup } from "./conditional-variables.mjs";

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
  const quantity = Object.hasOwn(card, "quantity") ? card.quantity : 1;
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(`[${label}] quantity deve ser um número inteiro maior ou igual a zero`);
  }
  if (card.font_size != null && (typeof card.font_size !== "number" || !Number.isFinite(card.font_size) || card.font_size <= 0)) {
    throw new Error(`[${label}] font_size deve ser um número finito maior que zero, em mm, ou null para ajuste automático`);
  }
  if (card.art != null && typeof card.art !== "string") throw new Error(`[${label}] art deve ser um caminho ou URL`);
  return String(label);
}

const CARD_FIELDS = new Set(["name", "element", "hp", "archetype"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Resolve variáveis por carta, para que um mesmo efeito possa usar name/element/hp/archetype distintos. */
function expandCard(card, variables, compiled) {
  const cache = new Map();
  const stack = [];
  function cached(key, compute) {
    if (cache.has(key)) return cache.get(key);
    if (stack.includes(key)) throw new Error(`Referência circular entre variáveis: ${[...stack, key].join(" -> ")}`);
    stack.push(key);
    try {
      const value = compute();
      cache.set(key, value);
      return value;
    } finally { stack.pop(); }
  }
  const variableKey = (name, preserveDecimals) => `${preserveDecimals ? "font_size.variables" : "variables"}.${name}`;
  function global(name, preserveDecimals = false) {
    if (!Object.hasOwn(variables, name)) throw new Error(`Variável não definida: ${name}`);
    return cached(variableKey(name, preserveDecimals), () => {
      const definition = compiled.get(name);
      const selected = typeof definition === "function" ? definition(cardId()) : definition;
      const value = interpolate(selected, preserveDecimals);
      return preserveDecimals ? value : integer(value);
    });
  }
  function cardId() {
    return cached("card.id", () => object(card) ? expand(card.id) : undefined);
  }
  function text(value) {
    if (isAutoFontGroup(value)) throw new Error('{"auto":"min"} só pode ser usado como valor completo de font_size');
    return String(value);
  }
  function rejectAutoFont(value) {
    if (isAutoFontGroup(value)) throw new Error('{"auto":"min"} só pode ser usado em font_size');
    if (Array.isArray(value)) value.forEach(rejectAutoFont);
    else if (object(value)) Object.values(value).forEach(rejectAutoFont);
  }
  function field(name) {
    return cached(`card.${name}`, () => {
      const result = expand(card[name]);
      return name === "hp" ? integer(numericValue(result)) : result;
    });
  }
  function resolve(name, preserveDecimals = false) {
    if (CARD_FIELDS.has(name) && object(card) && Object.hasOwn(card, name)) {
      // Durante a composição do próprio atributo, mantém aliases de variáveis gerais antigas.
      // Ex.: archetype: "Filhote ${archetype}" usa variables.archetype como base.
      if (stack.includes(`card.${name}`) && Object.hasOwn(variables, name)) return global(name, preserveDecimals);
      return field(name);
    }
    return global(name, preserveDecimals);
  }
  function expression(source, preserveDecimals) {
    const name = source.trim();
    const reference = name => resolve(name, preserveDecimals);
    // Mantém referências antigas cujos nomes contenham espaços ou pontuação.
    if (CARD_FIELDS.has(name) || Object.hasOwn(variables, name)) {
      const value = reference(name);
      return preserveDecimals ? value : integer(value);
    }
    return evaluateExpression(source, reference, { preserveDecimals });
  }
  function interpolate(value, preserveDecimals = false) {
    if (typeof value !== "string") return value;
    // Consome cada referência inteira, resolvendo os blocos internos antes do externo.
    function reference(start) {
      let source = "", position = start + 2;
      while (position < value.length) {
        if (value.startsWith("${", position)) {
          const nested = reference(position);
          source += text(nested.value);
          position = nested.end;
        } else if (value[position] === "}") {
          return { value: expression(source, preserveDecimals), end: position + 1 };
        } else source += value[position++];
      }
      throw new Error(`Referência de variável sem fechamento: ${value.slice(start)}`);
    }
    let result = "", position = 0, start;
    while ((start = value.indexOf("${", position)) !== -1) {
      const resolved = reference(start);
      if (start === 0 && resolved.end === value.length) return resolved.value;
      result += value.slice(position, start) + text(resolved.value);
      position = resolved.end;
    }
    return result + value.slice(position);
  }
  function expand(value, preserveDecimals = false) {
    if (Array.isArray(value)) return value.map(item => expand(item, preserveDecimals));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, preserveDecimals)]));
    return interpolate(value, preserveDecimals);
  }

  // Atributos são resolvidos antes de expandir os efeitos compartilhados.
  for (const name of CARD_FIELDS) if (object(card) && Object.hasOwn(card, name)) field(name);
  const hasFontSize = object(card) && Object.hasOwn(card, "font_size");
  // A fonte usa sua própria resolução e cache, sem truncar as dependências decimais.
  const fontSize = hasFontSize ? expand(card.font_size, true) : undefined;
  // Valida as dependências sem arredondá-las antes de saber qual campo usará o valor.
  // Os demais campos continuam resolvendo seus próprios valores inteiros em outro cache.
  for (const name of Object.keys(variables)) global(name, true);
  if (!object(card)) return card;
  const result = Object.fromEntries(Object.entries(card).map(([key, value]) => {
    const resolved = CARD_FIELDS.has(key) ? field(key) : key === "id" ? cardId() : key === "font_size" ? fontSize : expand(value);
    if (key === "font_size" && isAutoFontGroup(resolved)) return [key, null];
    rejectAutoFont(resolved);
    return [key, resolved];
  }));
  if (isAutoFontGroup(fontSize)) setFontGroup(result, fontSize);
  return result;
}

/** Aceita carta única, lista de cartas ou { variables, cards }. */
export function parseDeck(raw) {
  let variables = {}, cards;
  if (Array.isArray(raw)) cards = raw;
  else if (object(raw) && (Object.hasOwn(raw, "cards") || Object.hasOwn(raw, "variables"))) {
    if (!Array.isArray(raw.cards)) throw new Error('O bloco "cards" deve ser uma lista de cartas');
    variables = raw.variables ?? {};
    if (!object(variables)) throw new Error('O bloco "variables" deve ser um objeto');
    cards = raw.cards;
  } else cards = [raw];
  const compiled = compileVariables(variables);
  if (!cards.length) expandCard(null, variables, compiled);
  return cards.map((card, index) => {
    try {
      const result = expandCard(card, variables, compiled);
      if (object(result) && !Object.hasOwn(result, "quantity")) result.quantity = 1;
      return result;
    }
    catch (error) { throw new Error(`[${card?.id ?? `#${index + 1}`}] ${error.message}`); }
  });
}
