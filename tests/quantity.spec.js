import { test, expect } from "@playwright/test";
import { parseDeck, validateCard } from "../src/cards.mjs";

const card = { name: "Prismuff", element: "caelo", cost: 1, atk: 0, hp: 5 };

test("quantity assume uma cópia em cartas e decks antigos sem alterar o JSON de origem", () => {
  for (const raw of [card, [card], { cards: [card] }]) {
    const before = JSON.stringify(raw);
    const [result] = parseDeck(raw);
    expect(result.quantity).toBe(1);
    expect(() => validateCard(result, 0)).not.toThrow();
    expect(JSON.stringify(raw)).toBe(before);
  }
});

test("quantity aceita zero e quantidades inteiras explícitas", () => {
  for (const quantity of [0, 1, 3, 40]) {
    const [result] = parseDeck({ ...card, quantity });
    expect(result.quantity).toBe(quantity);
    expect(() => validateCard(result, 0)).not.toThrow();
  }
});

test("quantity aceita variáveis e cálculos com arredondamento", () => {
  const result = parseDeck({ variables: { copies: 3.9 }, cards: [
    { ...card, quantity: "${copies}" },
    { ...card, quantity: "${ceil(hp / 2)}" },
    { ...card, quantity: "${copies - 1}" },
  ] });
  expect(result.map(card => card.quantity)).toEqual([3, 3, 2]);
  result.forEach((card, index) => expect(() => validateCard(card, index)).not.toThrow());
});

test("quantity rejeita quantidades negativas, fracionárias ou não numéricas", () => {
  for (const quantity of [-1, 1.5, "3", null, true, {}, [], Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => validateCard({ ...card, quantity }, 0)).toThrow("quantity deve ser um número inteiro maior ou igual a zero");
  }
});
