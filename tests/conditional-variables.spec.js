import { test, expect } from "@playwright/test";
import { parseDeck, validateCard } from "../src/cards.mjs";
import { resolveGroupFontSizes } from "../src/font-groups.mjs";

const card = { name: "Prismuff", element: "caelo", hp: 3, atk: 0, cost: 1 };
const selection = (cases, fallback = null) => ({ default: fallback, cases });

test("seleções aceitam vários IDs, intervalos inclusivos e prioridade do primeiro caso", () => {
  const raw = { variables: {
    choice: selection([
      { ids: ["01-03", "08", "card-x"], value: "Primeiro" },
      { ids: ["03-05"], value: "Segundo" },
    ], "Padrão"),
  }, cards: ["01", "02", "03", "04", "05", "08", "card-x", "1", "09"].map(id => ({ ...card, id, effect: "${choice}" })) };
  const before = JSON.stringify(raw);
  expect(parseDeck(raw).map(card => card.effect)).toEqual([
    "Primeiro", "Primeiro", "Primeiro", "Segundo", "Segundo", "Primeiro", "Primeiro", "Padrão", "Padrão",
  ]);
  expect(JSON.stringify(raw)).toBe(before);
});

test("intervalos preservam zeros à esquerda e comparam IDs grandes sem expandir listas", () => {
  const variables = { label: selection([
    { ids: ["01-05"], value: "padded" },
    { ids: ["1-5"], value: "normal" },
    { ids: ["9007199254740992-9007199254740994"], value: "big" },
    { ids: [7], value: "numeric" },
  ], "other") };
  const result = parseDeck({ variables, cards: ["01", "05", "001", 1, "5", "00", "9007199254740993", 7].map(id => ({ ...card, id, effect: "${label}" })) });
  expect(result.map(card => card.effect)).toEqual(["padded", "padded", "other", "normal", "normal", "other", "big", "numeric"]);
});

test("casos podem retornar null, números, texto, aliases e referências dinâmicas por carta", () => {
  const variables = {
    base: 2.58, alias: "${chosen}",
    chosen: selection([{ ids: ["01"], value: "${base}" }, { ids: ["02"], value: "${hp / 2}" }]),
    caelo_label: selection([{ ids: ["01"], value: "${name}" }], "Outro"),
  };
  const result = parseDeck({ variables, cards: ["01", "02", "03"].map(id => ({ ...card, id, hp: 5,
    font_size: "${alias}", effect: "${${element}_label}", extra: "${chosen}",
  })) });
  expect(result).toMatchObject([
    { font_size: 2.58, effect: "Prismuff", extra: 2 },
    { font_size: 2.5, effect: "Outro", extra: 2 },
    { font_size: null, effect: "Outro", extra: null },
  ]);
  result.forEach(validateCard);
});

test("seleção usa o ID resolvido e só expande o ramo escolhido", () => {
  const variables = { id: "03", label: selection([{ ids: ["01-05"], value: "${name}" }], "${missing}") };
  expect(parseDeck({ variables, cards: [{ ...card, id: "${id}", effect: "${label}" }] })[0])
    .toMatchObject({ id: "03", effect: "Prismuff" });
  expect(() => parseDeck({ variables, cards: [{ ...card, id: "06", effect: "${label}" }] })).toThrow("Variável não definida: missing");
  expect(() => parseDeck({ variables: { code: selection([{ ids: ["01"], value: "01" }], "02") }, cards: [{ ...card, id: "${code}" }] }))
    .toThrow("Referência circular");
});

test("seleções mantêm aliases de atributos e detectam ciclos nas variáveis condicionais", () => {
  expect(parseDeck({ variables: { archetype: selection([{ ids: ["01"], value: "Fluffusion" }], "Outro") },
    cards: [{ ...card, id: "01", archetype: "Filhote ${archetype}", effect: "${archetype}" }] })[0].effect)
    .toBe("Filhote Fluffusion");
  expect(() => parseDeck({ variables: { a: selection([{ ids: ["01"], value: "${b}" }]), b: "${a}" },
    cards: [{ ...card, id: "01" }] })).toThrow("Referência circular");
});

test("definições inválidas produzem erros antes da geração", () => {
  const invalid = [
    { default: null, cases: {} },
    selection([{ ids: [], value: 1 }]), selection([{ ids: null, value: 1 }]),
    selection([{ ids: [true], value: 1 }]), selection([{ ids: [""], value: 1 }]),
    selection([{ ids: ["05-01"], value: 1 }]), selection([{ ids: ["01-5"], value: 1 }]),
    selection([{ ids: ["01"] }]), selection([{ ids: ["01"], value: {} }]),
    selection([{ ids: ["01"], value: { auto: "min", unexpected: true } }]),
    { default: null, cases: [], typo: 1 },
  ];
  for (const value of invalid) expect(() => parseDeck({ variables: { choice: value }, cards: [] })).toThrow();
});

test("auto min só pode ocupar o campo completo de font_size", () => {
  const variables = { fonte: selection([{ ids: ["01-03"], value: { auto: "min" } }]) };
  for (const value of [
    { ...card, id: "01", effect: "${fonte}" },
    { ...card, id: "01", effect: "Fonte ${fonte}" },
    { ...card, id: "01", font_size: "${fonte + 1}" },
    { ...card, id: "01", font_size: "${${fonte}}" },
    { ...card, id: "01", extra: ["${fonte}"] },
  ]) expect(() => parseDeck({ variables, cards: [value] })).toThrow();
  expect(() => validateCard(parseDeck({ variables, cards: [{ ...card, id: "01", font_size: "${fonte}" }] })[0], 0)).not.toThrow();
});

test("mínimo é calculado por caso, inclui quantity zero e permanece estável com --ids", async () => {
  const variables = { fonte: selection([
    { ids: ["01-02"], value: { auto: "min" } }, { ids: ["03-04"], value: { auto: "min" } },
  ]), alias: "${fonte}" };
  const cards = parseDeck({ variables, cards: ["01", "02", "03", "04", "05"].map((id, i) => ({ ...card, id,
    quantity: i === 1 ? 0 : 1, font_size: "${alias}", measured: [2.8, 2.37, 2.5, 2.6, 2.8][i],
  })) });
  const measured = [];
  const partial = await resolveGroupFontSizes(cards, async card => { measured.push(card.id); return card.measured; }, { selectedIds: new Set(["01"]) });
  expect(measured).toEqual(["01", "02"]);
  expect([...partial.values()]).toEqual([2.37, 2.37]);
  const all = await resolveGroupFontSizes(cards, async card => card.measured);
  expect(cards.map(card => all.get(card))).toEqual([2.37, 2.37, 2.5, 2.5, undefined]);
});

test("grupos têm escopo por JSON, inclusive default e auto min sem cases", async () => {
  const raw = measured => ({ variables: { fonte: { auto: "min" } },
    cards: measured.map((size, i) => ({ ...card, id: String(i), measured: size, font_size: "${fonte}" })) });
  const first = parseDeck(raw([2.8, 2.5])), second = parseDeck(raw([1.8, 2.1]));
  const joined = [...first, ...second];
  const sizes = await resolveGroupFontSizes(joined, async card => card.measured);
  expect(joined.map(card => sizes.get(card))).toEqual([2.5, 2.5, 1.8, 1.8]);
  const fallback = parseDeck({ variables: { fonte: selection([{ ids: ["01"], value: 2.58 }], { auto: "min" }) },
    cards: ["01", "02", "03"].map((id, i) => ({ ...card, id, measured: [2.8, 2.3, 2.6][i], font_size: "${fonte}" })) });
  const fallbackSizes = await resolveGroupFontSizes(fallback, async card => card.measured);
  expect(fallback[0].font_size).toBe(2.58);
  expect(fallback.map(card => fallbackSizes.get(card))).toEqual([undefined, 2.3, 2.3]);
});

test("grupos sem exportação são ignorados e falhas de medição identificam a carta", async () => {
  const cards = parseDeck({ variables: { fonte: { auto: "min" } }, cards: [{ ...card, id: "01", font_size: "${fonte}" }] });
  const skipped = await resolveGroupFontSizes(cards, async () => { throw new Error("Não deveria medir"); }, { selectedIds: new Set(["02"]) });
  expect(skipped.size).toBe(0);
  await expect(resolveGroupFontSizes(cards, async () => null)).rejects.toThrow("[01]");
});


test("formato compacto aceita ids como texto, CSV ou número e default omitido", () => {
  const variables = { choice: { cases: [
    { ids: "01-03, 08, card-x", value: "A" },
    { ids: "04-05", value: "B" },
    { ids: 7, value: "C" },
  ] } };
  const result = parseDeck({ variables, cards: ["01", "03", "04", "05", "08", "card-x", 7, "09"].map(id => ({ ...card, id, effect: "${choice}" })) });
  expect(result.map(card => card.effect)).toEqual(["A", "A", "B", "B", "A", "A", "C", null]);
  expect(parseDeck({ variables: { empty: { cases: [] } }, cards: [{ ...card, font_size: "${empty}" }] })[0].font_size).toBeNull();
  for (const ids of ["", ",", "01,,03"]) {
    expect(() => parseDeck({ variables: { invalid: { cases: [{ ids, value: 1 }] } }, cards: [] })).toThrow("ID vazio");
  }
});
