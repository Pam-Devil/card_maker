import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseDeck } from "../src/cards.mjs";
import { outputFiles } from "./output-files.mjs";
import { ROOT } from "../src/build.mjs";

const card = { name: "Prismuff", element: "caelo", cost: "-", atk: 0, hp: 5 };
const run = promisify(execFile);

test("efeitos compartilhados resolvem name, element e hp separadamente por carta", () => {
  const raw = {
    variables: { baseHp: 3, half: "${hp / 2}", label: "${name} (${element})", effect: "${label}: Recupero ${half} de vida de ${name}." },
    cards: [{ ...card, hp: "${baseHp + 2}", effect: "${effect}" }, { ...card, name: "Nebluff", element: "abysso", hp: "${baseHp * 3}", effect: "${effect}" }],
  };
  const copy = JSON.stringify(raw);
  expect(parseDeck(raw)).toMatchObject([
    { name: "Prismuff", hp: 5, effect: "Prismuff (caelo): Recupero 2 de vida de Prismuff." },
    { name: "Nebluff", hp: 9, effect: "Nebluff (abysso): Recupero 4 de vida de Nebluff." },
  ]);
  expect(JSON.stringify(raw)).toBe(copy);
});

test("trunca números e resultados finais, preservando frações intermediárias", () => {
  const [result] = parseDeck({ variables: { fraction: 3.9, negative: -3.9 }, cards: [{
    ...card, hp: 5.9, cost: "${fraction}", effect: "${hp / 2}|${-hp / 2}|${(hp / 2) * 2}|${2.9 + 2.9}|${negative}|${fraction}",
  }] });
  expect(result).toMatchObject({ hp: 5, cost: 3, effect: "2|-2|5|5|-3|3" });
});

test("arredondamento explícito, precedência, parênteses e resto", () => {
  const [result] = parseDeck({ ...card, effect: "${trunc(hp / 2)}|${floor(-hp / 2)}|${ceil(hp / 2)}|${round(hp / 2)}|${2 + 3 * 4}|${(2 + 3) * 4}|${hp % 2}|${ceil(round(2.5) / 2)}|${1e2 / 3}|${-.5}" });
  expect(result.effect).toBe("2|-3|3|3|14|20|1|2|33|0");
});

test("nome e elemento calculados a partir de variáveis e campos independentes da ordem", () => {
  const [result] = parseDeck({ variables: { title: "Prismuff", type: "caelo", base: 2, effect: "${name}/${element}/${hp}" }, cards: [{
    effect: "${effect}", hp: "${base + 3}", element: "${type}", name: "Adulto ${title}", cost: "?", atk: 0,
  }] });
  expect(result).toMatchObject({ hp: 5, effect: "Adulto Prismuff/caelo/5" });
  expect(parseDeck([{ ...card, effect: "${name}: ${hp / 2}" }])[0].effect).toBe("Prismuff: 2");
});

test("aliases de variáveis antigas continuam válidos, com prioridade da carta nos efeitos", () => {
  const variables = { name: "Nome comum", element: "caelo", hp: 7, effect: "${name}|${element}|${hp}" };
  expect(parseDeck({ variables, cards: [{ ...card, name: "${name}", element: "${element}", hp: "${hp}", effect: "${effect}" }] })[0])
    .toMatchObject({ name: "Nome comum", element: "caelo", hp: 7, effect: "Nome comum|caelo|7" });
  expect(parseDeck({ variables, cards: [{ ...card, effect: "${effect}" }] })[0].effect).toBe("Prismuff|caelo|5");
});

test("detecta dependências circulares entre atributos e variáveis", () => {
  for (const raw of [
    { ...card, hp: "${hp + 1}" },
    { variables: { bonus: "${hp / 2}" }, cards: [{ ...card, hp: "${bonus}" }] },
    { variables: { label: "${name}" }, cards: [{ ...card, name: "${label}" }] },
    { variables: { a: "${b + 1}", b: "${a + 1}" }, cards: [card] },
  ]) expect(() => parseDeck(raw)).toThrow("Referência circular");
});

test("rejeita operações inválidas e acesso a código ou propriedades", () => {
  for (const expression of ["hp / 0", "hp % 0", "name + 1", "trunc(name)", "unknown + 1", "hp +", "(hp + 2", "round(2, 1)", "abs(-2)", "2 ** 3", "process.exit()", "globalThis", "constructor.constructor(1)", "hp = 2", "1; 2", "toString", "1e309", "9007199254740992"]) {
    expect(() => parseDeck({ ...card, effect: "${" + expression + "}" }), expression).toThrow();
  }
});

test("a CLI exporta o efeito compartilhado com os atributos e cálculos resolvidos", async ({}, info) => {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify({ variables: { baseHp: 3, caelo_name: "Luz", abysso_name: "Trevas", effect: "${name} (${${element}_name}): Recupero ${ceil(hp / 2)} de vida para ${archetype}." }, cards: [
    { ...card, id: "01", archetype: "Filhote Fluffusion", hp: "${baseHp + 2}", effect: "${effect}" },
    { ...card, id: "02", name: "Nebluff", archetype: "Família Fluffusion", element: "abysso", hp: "${baseHp * 3}", effect: "${effect}" },
  ] }));
  await run(process.execPath, ["build.mjs", input, "--trim", "--text", "--save-html", "--out", directory], { cwd: ROOT });
  const first = await fs.readFile(path.join(directory, "html", "01.html"), "utf8");
  const second = await fs.readFile(path.join(directory, "html", "02.html"), "utf8");
  expect(first).toContain("Prismuff (Luz): Recupero 3 de vida para Filhote Fluffusion.");
  expect(second).toContain("Nebluff (Trevas): Recupero 5 de vida para Família Fluffusion.");
  expect(first).toContain('data-hp="5"');
  expect(second).toContain('data-hp="9"');
  expect(first + second).not.toContain("${");
  expect(await outputFiles(directory, ".png")).toHaveLength(4);
});


test("nomes dinâmicos usam o elemento de cada carta em variáveis e atributos", () => {
  const raw = {
    variables: {
      cryo_name: "Flurruff", pyro_name: "Brasa",
      shared: "${name}: Invoco ${${element}_name}.",
    },
    cards: ["cryo", "pyro"].map(element => ({ ...card, element,
      name: "Adulto ${${element}_name}", effect: "${shared}", art: "assets/art/${${element}_name}.png",
    })),
  };
  const original = JSON.stringify(raw);
  expect(parseDeck(raw)).toMatchObject([
    { name: "Adulto Flurruff", effect: "Adulto Flurruff: Invoco Flurruff.", art: "assets/art/Flurruff.png" },
    { name: "Adulto Brasa", effect: "Adulto Brasa: Invoco Brasa.", art: "assets/art/Brasa.png" },
  ]);
  expect(JSON.stringify(raw)).toBe(original);
});

test("referências dinâmicas preservam números, cálculos e várias partes do nome", () => {
  const [result] = parseDeck({ variables: { caelo_hp: 7.9, caelo_copies: 2, prefix: "base", base_caelo_7: "especial" }, cards: [{
    ...card, hp: "${${element}_hp}", quantity: "${${element}_copies}", cost: "${${${element}_hp} / 2}",
    effect: "${${element}_hp} / ${hp} / ${${prefix}_${element}_${hp}} / ${ceil(${${element}_hp} / 2)}",
  }] });
  expect(result).toMatchObject({ hp: 7, quantity: 2, cost: 3, effect: "7 / 7 / especial / 4" });
});

test("referências dinâmicas aceitam vários níveis e nomes com espaços", () => {
  const [result] = parseDeck({ variables: {
    selector: "attribute", attribute: "${element}", caelo_name: "Luz",
    "caelo label": "Brilho", dollar: "$",
  }, cards: [{ ...card, effect: "${${${selector}}_name}: ${${element} label}. ${dollar}{literal}" }] });
  expect(result.effect).toBe("Luz: Brilho. ${literal}");
});

test("referências dinâmicas detectam ciclos entre variáveis e atributos", () => {
  for (const raw of [
    { variables: { caelo_name: "${${element}_name}" }, cards: [card] },
    { variables: { caelo_a: "${${element}_b}", caelo_b: "${${element}_a}" }, cards: [card] },
    { variables: { caelo_name: "${name}" }, cards: [{ ...card, name: "${${element}_name}" }] },
    { variables: { caelo_hp: "${hp}" }, cards: [{ ...card, hp: "${${element}_hp}" }] },
  ]) expect(() => parseDeck(raw)).toThrow("Referência circular");
});

test("referências dinâmicas rejeitam nomes ausentes, blocos incompletos e código", () => {
  expect(() => parseDeck({ ...card, effect: "${${element}_name}" })).toThrow("Variável não definida: caelo_name");
  expect(() => parseDeck({ ...card, effect: "${${element}_name" })).toThrow("Referência de variável sem fechamento");
  expect(() => parseDeck({ ...card, effect: "${element" })).toThrow("Referência de variável sem fechamento");
  expect(() => parseDeck({ variables: { key: "process.exit()" }, cards: [{ ...card, effect: "${${key}}" }] })).toThrow();
  expect(() => parseDeck({ variables: { key: "toString" }, cards: [{ ...card, effect: "${${key}}" }] })).toThrow("Variável não definida: toString");
});


test("archetype interno resolve o valor completo de cada carta em efeitos e nomes dinâmicos", () => {
  const raw = { variables: {
    baseArchetype: "Fluffusion",
    shared: "${name}: Busque uma carta ${archetype}. ${${archetype}_bonus}",
    "Filhote Fluffusion_bonus": "Bônus jovem.", "Família Fluffusion_bonus": "Bônus familiar.",
  }, cards: [
    { ...card, effect: "${shared}", archetype: "Filhote ${baseArchetype}" },
    { ...card, name: "Nebluff", effect: "${shared}", archetype: "Família ${baseArchetype}" },
  ] };
  const original = JSON.stringify(raw);
  expect(parseDeck(raw)).toMatchObject([
    { archetype: "Filhote Fluffusion", effect: "Prismuff: Busque uma carta Filhote Fluffusion. Bônus jovem." },
    { archetype: "Família Fluffusion", effect: "Nebluff: Busque uma carta Família Fluffusion. Bônus familiar." },
  ]);
  expect(parseDeck({ ...card, archetype: "Teste", effect: "${archetype}" })[0].effect).toBe("Teste");
  expect(JSON.stringify(raw)).toBe(original);
});

test("archetype mantém aliases antigos e prioriza o campo completo fora da sua composição", () => {
  const result = parseDeck({ variables: {
    archetype: "Fluffusion", label: "Adulto ${archetype}", shared: "Invoco ${archetype}.",
  }, cards: [
    { ...card, archetype: "${archetype}", effect: "${shared}" },
    { ...card, archetype: "Filhote ${archetype}", effect: "${shared}" },
    { ...card, archetype: "${label}", effect: "${shared}" },
    { ...card, archetype: "Outro arquétipo", effect: "${shared}" },
    { ...card, effect: "${shared}" },
  ] });
  expect(result.map(card => card.effect)).toEqual([
    "Invoco Fluffusion.", "Invoco Filhote Fluffusion.", "Invoco Adulto Fluffusion.",
    "Invoco Outro arquétipo.", "Invoco Fluffusion.",
  ]);
});

test("archetype detecta referências circulares e referências ausentes", () => {
  for (const raw of [
    { ...card, archetype: "${archetype}" },
    { variables: { label: "${archetype}" }, cards: [{ ...card, archetype: "${label}" }] },
    { ...card, name: "${archetype}", archetype: "${name}" },
    { variables: { archetype: "${archetype}" }, cards: [{ ...card, archetype: "${archetype}" }] },
  ]) expect(() => parseDeck(raw)).toThrow("Referência circular");
  expect(() => parseDeck({ ...card, effect: "${archetype}" })).toThrow("Variável não definida: archetype");
});


test("variáveis null preservam o tipo em aliases, referências dinâmicas e campos opcionais", () => {
  const raw = { variables: { auto_font: null, alias: "${auto_font}", caelo_font: "${alias}" }, cards: [{
    ...card, font_size: "${${element}_font}", art: "${auto_font}",
    extra: ["${auto_font}", { value: "${alias}" }],
  }] };
  const original = JSON.stringify(raw);
  expect(parseDeck(raw)[0]).toMatchObject({ font_size: null, art: null, extra: [null, { value: null }] });
  expect(JSON.stringify(raw)).toBe(original);
  expect(parseDeck({ variables: { unused: null }, cards: [] })).toEqual([]);
});

test("null dentro de uma frase vira texto e não pode ser usado em cálculos", () => {
  const [result] = parseDeck({ variables: { empty: null, literal: "null" }, cards: [{
    ...card, effect: "Valor: ${empty}.", extra: ["${empty}", "${literal}"],
  }] });
  expect(result.effect).toBe("Valor: null.");
  expect(result.extra).toEqual([null, "null"]);
  for (const source of ["empty + 1", "1 * empty", "ceil(empty)", "-empty"]) {
    expect(() => parseDeck({ variables: { empty: null }, cards: [{ ...card, effect: "${" + source + "}" }] }))
      .toThrow("Cálculo exige números finitos");
  }
});


test("hp textual numérico é convertido antes do truncamento e dos cálculos", () => {
  for (const [input, hp] of [["2", 2], [" 5.9 ", 5], ["-5.9", -5], ["+2", 2], [".9", 0], ["2e1", 20], ["002", 2]]) {
    const original = { ...card, id: "002", name: "002", hp: input, effect: "${hp / 2}|${ceil(hp / 2)}|${hp}" };
    const before = JSON.stringify(original);
    const [result] = parseDeck(original);
    expect(result).toMatchObject({ id: "002", name: "002", hp,
      effect: `${Math.trunc(hp / 2)}|${Math.ceil(hp / 2)}|${hp}` });
    expect(JSON.stringify(original)).toBe(before);
  }
});

test("hp numérico textual resolve aliases, condições e fonte sem perder suas regras de precisão", () => {
  const variables = { base: "5.9", hp: "${base}", half: "${hp / 2}",
    chosen: { cases: [{ ids: "01", value: "${half}" }], default: "${hp}" } };
  const result = parseDeck({ variables, cards: [
    { ...card, id: "01", hp: "${hp}", font_size: "${hp / 2}", effect: "${chosen}" },
    { ...card, id: "02", hp: "${base}", effect: "${chosen}" },
  ] });
  expect(result).toMatchObject([{ hp: 5, font_size: 2.5, effect: 2 }, { hp: 5, effect: 5 }]);
});

test("expressões aceitam variáveis numéricas textuais e preservam custos e referências textuais", () => {
  const [result] = parseDeck({ variables: { cost: "2", decimal: "2.58", label: "002" }, cards: [{
    ...card, cost: "${cost}", font_size: "${decimal / 2}",
    effect: "${cost + 1}|${ceil(decimal)}|${-cost}|${decimal * 2}|${label}",
  }] });
  expect(result).toMatchObject({ cost: "2", font_size: 1.29, effect: "3|3|-2|5|002" });
  for (const cost of ["X", "-", "?", "2X"]) {
    expect(parseDeck({ ...card, cost })[0].cost).toBe(cost);
    expect(parseDeck({ variables: { cost }, cards: [{ ...card, cost: "${cost}", effect: "Custo: ${cost}" }] })[0])
      .toMatchObject({ cost, effect: `Custo: ${cost}` });
    expect(() => parseDeck({ variables: { cost }, cards: [{ ...card, effect: "${cost / 2}" }] })).toThrow("Cálculo exige números finitos");
  }
});

test("texto não numérico e coerções implícitas continuam proibidos nos cálculos", () => {
  for (const value of ["", " ", "X", "-", "2mm", "2,5", "0x10", "Infinity", "NaN", "1e309", null]) {
    for (const expression of ["value + 1", "value / 2", "ceil(value)", "-value"]) {
      expect(() => parseDeck({ variables: { value }, cards: [{ ...card, effect: "${" + expression + "}" }] }), `${value}: ${expression}`)
        .toThrow("Cálculo exige números finitos");
    }
  }
  expect(parseDeck({ ...card, hp: "X" })[0].hp).toBe("X");
  expect(() => parseDeck({ ...card, hp: "X", effect: "${hp / 2}" })).toThrow("Cálculo exige números finitos");
  expect(() => parseDeck({ ...card, hp: "9007199254740992" })).toThrow("limite de inteiros seguros");
});
