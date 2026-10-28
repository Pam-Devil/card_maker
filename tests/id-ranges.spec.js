import { test, expect } from "@playwright/test";
import { compileVariables } from "../src/conditional-variables.mjs";
import { parseDeck } from "../src/cards.mjs";

function selected(ids) {
  return compileVariables({ choice: { default: null, cases: [{ ids, value: "selected" }] } }).get("choice");
}

for (const { range, accepted, rejected } of [
  { range: "01-05", accepted: ["01", "02", "05"], rejected: ["00", "06", "1", "5", "001", 1, 5] },
  { range: "1-5", accepted: ["1", "2", "5", 1, 5], rejected: ["0", "6", "01", "05", "001"] },
  { range: "1-12", accepted: ["1", "9", "10", "12", 12], rejected: ["0", "13", "01", "012"] },
  { range: "09-12", accepted: ["09", "10", "12", 10, 12], rejected: ["08", "13", "9", 9, "009", "012"] },
  { range: "001-010", accepted: ["001", "009", "010"], rejected: ["000", "011", "01", "1", "10", 1, 10] },
  { range: "0-0", accepted: [0, "0"], rejected: [1, "1", "00", "000"] },
  { range: "00-00", accepted: ["00"], rejected: [0, "0", "000", "01"] },
]) {
  test(`intervalo ${range}: extremos inclusivos e largura dos IDs`, () => {
    const select = selected(range);
    for (const id of accepted) expect(select(id), `aceitar ${JSON.stringify(id)}`).toBe("selected");
    for (const id of rejected) expect(select(id), `rejeitar ${JSON.stringify(id)}`).toBeNull();
  });
}

test("extremos com zeros à esquerda e larguras diferentes são rejeitados na compilação", () => {
  for (const range of ["01-5", "1-05", "009-10", "9-010", "00-0", "0-00"]) {
    expect(() => selected(range), range).toThrow("os extremos do intervalo com zeros à esquerda devem ter a mesma largura");
  }
  for (const range of ["5-1", "05-01", "100-99", "5-01"]) {
    expect(() => selected(range), range).toThrow("intervalo invertido");
  }
});

test("BigInt distingue IDs consecutivos acima do limite seguro, inclusive na mudança de largura", () => {
  const select = selected("999999999999999999999999999998-1000000000000000000000000000001");
  for (const id of ["999999999999999999999999999998", "999999999999999999999999999999", "1000000000000000000000000000000", "1000000000000000000000000000001"]) {
    expect(select(id), id).toBe("selected");
  }
  for (const id of ["999999999999999999999999999997", "1000000000000000000000000000002", "0999999999999999999999999999998"]) {
    expect(select(id), id).toBeNull();
  }
});

test("intervalos enormes não são expandidos e também validam largura com zeros", () => {
  const limit = "9".repeat(120);
  const select = selected(`0-${limit}`);
  expect(select("0")).toBe("selected");
  expect(select("1" + "0".repeat(119))).toBe("selected");
  expect(select(limit)).toBe("selected");
  expect(select("1" + "0".repeat(120))).toBeNull();
  expect(select("0" + limit)).toBeNull();
  const padded = selected("09007199254740992-09007199254740994");
  expect(padded("09007199254740992")).toBe("selected");
  expect(padded("09007199254740993")).toBe("selected");
  expect(padded("09007199254740994")).toBe("selected");
  expect(padded("9007199254740993")).toBeNull();
});

test("IDs não numéricos não entram em intervalos, mas podem ser seletores literais", () => {
  const range = selected("0-20");
  for (const id of [null, undefined, "", " 2", "2 ", "+2", "-1", "1.5", 1.5, "2e1", "0x10", "card-01", "A01"]) {
    expect(range(id), String(id)).toBeNull();
  }
  const literal = selected(["card-01", "A01", "-1", "1.5", "2e1"]);
  for (const id of ["card-01", "A01", "-1", -1, "1.5", 1.5, "2e1"]) {
    expect(literal(id), String(id)).toBe("selected");
  }
  expect(literal("card-1")).toBeNull();
  expect(literal(20)).toBeNull();
});

test("espaços dos seletores são aceitos sem normalizar os IDs das cartas", () => {
  const select = selected(" 01 - 05 , 8, card-x ");
  for (const id of ["01", "05", "8", 8, "card-x"]) expect(select(id)).toBe("selected");
  for (const id of ["1", 1, " 01", "01 ", "08", " card-x"]) expect(select(id)).toBeNull();
});

test("IDs numéricos lidos do JSON são comparados como texto, preservando o tipo original", () => {
  const ids = [1, "1", "01", 5, "5", "005", 7, "7", "07", null];
  const raw = JSON.parse(JSON.stringify({
    variables: { choice: { default: "other", cases: [
      { ids: "01-05", value: "padded" }, { ids: "1-5", value: "plain" },
      { ids: 7, value: "literal" }, { ids: "07", value: "zero" },
    ] } },
    cards: ids.map(id => ({ id, name: "Teste", element: "caelo", cost: 1, hp: 2, atk: 0, effect: "${choice}" })),
  }));
  const before = JSON.stringify(raw);
  const result = parseDeck(raw);
  expect(result.map(card => card.effect)).toEqual(["plain", "plain", "padded", "plain", "plain", "other", "literal", "literal", "zero", "other"]);
  expect(result.map(card => card.id)).toEqual(ids);
  expect(JSON.stringify(raw)).toBe(before);
});

test("sobreposições respeitam o primeiro caso e seletores repetidos não mudam o resultado", () => {
  const select = compileVariables({ choice: { default: "other", cases: [
    { ids: ["01-03", "03", "01-03"], value: "first" },
    { ids: "03-05", value: "second" },
    { ids: "1-5", value: "plain" },
  ] } }).get("choice");
  expect(["01", "03", "04", "05", "1", 3, "003", "06"].map(select))
    .toEqual(["first", "first", "second", "second", "plain", "plain", "other", "other"]);
});
