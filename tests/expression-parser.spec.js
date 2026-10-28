import { test, expect } from "@playwright/test";
import { evaluateExpression, integer, numericValue } from "../src/expressions.mjs";
import { parseDeck, validateCard } from "../src/cards.mjs";

function evaluate(source, values = {}, options = {}) {
  return evaluateExpression(source, name => {
    if (!Object.hasOwn(values, name)) throw new Error(`Variável não definida: ${name}`);
    return values[name];
  }, options);
}

for (const preserveDecimals of [false, true]) {
  test.describe(`parser: preserveDecimals=${preserveDecimals}`, () => {
    const options = { preserveDecimals };
    const result = value => preserveDecimals ? value : Math.trunc(value) || 0;

    test("números com expoente, ponto decimal e espaços", () => {
      for (const [source, expected] of [
        ["1e2", 100], ["1E+2", 100], ["2.58e0", 2.58], [".5e1", 5],
        ["1.e2", 100], ["2.5E-1", 0.25], ["-2.5e-1", -0.25],
        ["2e-3", 0.002], ["2E-3 * 1e3", 2], ["2e-3 + 3e-3", 0.005],
        ["1e-400", 0], ["  \t1e2 +\n 2.5 ", 102.5],
      ]) expect(evaluate(source, {}, options), source).toBeCloseTo(result(expected), 12);
    });

    test("identificadores Unicode e números no restante do nome", () => {
      const values = { "vida_٢": 5, "potência_2": 2, "生命2": 3, "α": 4, "𝛼": 6, "_ação2": 7, _: 1 };
      expect(evaluate("vida_٢ + potência_2 * 生命2 + α + 𝛼", values, options)).toBe(21);
      expect(evaluate("ceil(vida_٢ / potência_2)", values, options)).toBe(3);
      expect(evaluate("_ação2 + potência_2 + _", values, options)).toBe(10);
      expect(evaluate(" \t ceil ( _ação2 / 2 ) \n ", values, options)).toBe(4);
      expect(() => evaluate("ausência + 1", values, options)).toThrow("Variável não definida: ausência");
    });

    test("precedência, associatividade, sinais unários e resto", () => {
      for (const [source, expected] of [
        ["2 + 3 * 4", 14], ["(2 + 3) * 4", 20], ["10 - 3 - 2", 5],
        ["16 / 4 / 2", 2], ["-2 * 3 + 10", 4], ["-(2 + 3) * 2", -10],
        ["8 / -2 * -3", 12], ["--2", 2], ["-+2", -2], ["3---2", 1],
        ["+2 + -3", -1], ["-5 % 2", -1], ["5 % -2", 1],
        ["(5 / 2) * 2", 5], ["2.9 + 2.9", 5.8],
      ]) expect(evaluate(source, {}, options), source).toBeCloseTo(result(expected), 12);
    });

    test("arredondamento explícito e funções aninhadas", () => {
      for (const [source, expected] of [
        ["trunc(-2.9)", -2], ["floor(-2.1)", -3], ["ceil(-2.9)", -2],
        ["round(2.5)", 3], ["round(-2.5)", -2],
        ["ceil(round(2.5) / 2)", 2], ["trunc(floor(2.9) + ceil(.1))", 3],
      ]) expect(evaluate(source, {}, options), source).toBe(expected);
    });

    test("divisão e resto por zero e estouros são rejeitados", () => {
      for (const source of ["1 / 0", "0 / 0", "1 / -0", "1 % 0", "1 / (2 - 2)", "1e309", "1e308 * 10", "1e308 / 1e-308", "floor(1 / 0)"]) {
        expect(() => evaluate(source, {}, options), source).toThrow("Cálculo exige números finitos");
      }
      for (const value of [NaN, Infinity, -Infinity, null, "", " ", "X", "1e309"]) {
        for (const source of ["value + 1", "-value", "ceil(value)"]) {
          expect(() => evaluate(source, { value }, options), `${source}: ${String(value)}`).toThrow("Cálculo exige números finitos");
        }
      }
    });

    test("tokens inválidos e acesso a código não são aceitos", () => {
      for (const source of ["1 @ 2", "1; 2", "1 & 2", "1 = 2", "1 // 2", "2 ** 3", "process.exit()", "obj[0]", "'2'", "1e+", "1..2", "1 2"]) {
        expect(() => evaluate(source, {}, options), source).toThrow();
      }
      for (const token of ["@", "$", "×", "😀"]) {
        expect(() => evaluate(`2 ${token} 3`, {}, options)).toThrow(`Caractere inválido na expressão: ${token} 3`);
      }
      expect(() => evaluate("1 2", {}, options)).toThrow("Trecho inesperado na expressão: 2");
    });

    test("expressões incompletas e argumentos inválidos têm diagnóstico", () => {
      for (const source of ["", " ", "+", "1 +", "()", "1 + * 2", "round()", "round(,)"]) {
        expect(() => evaluate(source, {}, options), source).toThrow("Expressão inválida");
      }
      for (const source of ["(1 + 2", "round(2", "round(1, 2)"]) {
        expect(() => evaluate(source, {}, options), source).toThrow('Esperado ")" na expressão');
      }
      expect(() => evaluate("1)", {}, options)).toThrow("Trecho inesperado na expressão");
      for (const [source, name] of [
        ["abs(-2)", "abs"], ["sqrt(4)", "sqrt"], ["min(1, 2)", "min"],
        ["eval(1)", "eval"], ["constructor(1)", "constructor"], ["toString(1)", "toString"],
        ["ceil(abs(-2))", "abs"],
      ]) expect(() => evaluate(source, {}, options), source).toThrow(`Função não permitida: ${name}`);
    });
  });
}

test("modo padrão trunca somente o resultado final e respeita inteiros seguros", () => {
  expect(evaluate("(5 / 2) * 2")).toBe(5);
  expect(evaluate("-5 / 2")).toBe(-2);
  expect(Object.is(evaluate("-.5"), -0)).toBe(false);
  expect(evaluate("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  expect(evaluate("-9007199254740991")).toBe(Number.MIN_SAFE_INTEGER);
  expect(evaluate("9007199254740992 / 2")).toBe(4503599627370496);
  for (const source of ["9007199254740992", "-9007199254740992", "9007199254740991 + 1"]) {
    expect(() => evaluate(source), source).toThrow("limite de inteiros seguros");
  }
});

test("preserveDecimals conserva frações e permite números finitos fora do intervalo de inteiros seguros", () => {
  expect(evaluate("5 / 2", {}, { preserveDecimals: true })).toBe(2.5);
  expect(evaluate("-5 / 2", {}, { preserveDecimals: true })).toBe(-2.5);
  expect(evaluate("decimal / 2", { decimal: "2.58" }, { preserveDecimals: true })).toBe(1.29);
  expect(evaluate("9007199254740992", {}, { preserveDecimals: true })).toBe(9007199254740992);
  expect(evaluate("1e308", {}, { preserveDecimals: true })).toBe(1e308);
});

test("integer valida finitude, limite seguro e normaliza zero negativo", () => {
  expect(integer(2.9)).toBe(2);
  expect(integer(-2.9)).toBe(-2);
  expect(Object.is(integer(-0), -0)).toBe(false);
  for (const value of [NaN, Infinity, -Infinity]) expect(() => integer(value)).toThrow("número finito");
  for (const value of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    expect(() => integer(value)).toThrow("limite de inteiros seguros");
  }
});

test("numericValue converte só texto decimal finito e preserva outros tipos", () => {
  for (const [input, expected] of [[" 2.58 ", 2.58], ["+2e1", 20], ["-.5", -0.5], ["002", 2]]) {
    expect(numericValue(input), input).toBe(expected);
  }
  for (const input of [null, undefined, true, false, "", " ", "X", "-", "2mm", "2,5", "0x10", "1e309"]) {
    expect(numericValue(input)).toBe(input);
  }
});

test("font_size usa preserveDecimals através de aliases Unicode sem contaminar outros campos", () => {
  const base = { id: "01", name: "Teste", element: "caelo", hp: 3, atk: 0, cost: "X" };
  const variables = { "potência_2": 5.16, fonte: "${potência_2 / 2e0}", alias: "${fonte}" };
  for (const fields of [
    { font_size: "${alias}", effect: "${alias}", quantity: "${alias}" },
    { quantity: "${alias}", effect: "${alias}", font_size: "${alias}" },
  ]) {
    const [card] = parseDeck({ variables, cards: [{ ...base, ...fields }] });
    expect(card).toMatchObject({ font_size: 2.58, effect: 2, quantity: 2 });
    expect(() => validateCard(card, 0)).not.toThrow();
  }
});
