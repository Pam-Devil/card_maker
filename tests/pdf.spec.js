import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outputFiles } from "./output-files.mjs";
import { ROOT } from "../src/build.mjs";
import { pdfPython } from "../src/pdf.mjs";
import { parseArgs } from "../src/options.mjs";

const run = promisify(execFile);
const card = { id: "01", name: "Prismuff", archetype: "Filhote Fluffusion", element: "caelo", cost: 1, hp: 3, atk: 0, effect: "Descrição para impressão.", quantity: 1 };
const mm = value => value * 72 / 25.4;
async function fixture(info, cards) {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify(cards));
  return { directory, input };
}
const generate = (fixture, args) => run(process.execPath, ["build.mjs", fixture.input, "--out", fixture.directory, ...args], { cwd: ROOT });
async function inspect(filename) {
  const { stdout } = await run(await pdfPython(), [path.join(ROOT, "tests/pdf_inspect.py"), filename], { env: { ...process.env, PYTHONUTF8: "1" } });
  return JSON.parse(stdout);
}
function a4(page) {
  expect(page.width).toBeCloseTo(mm(210), 3);
  expect(page.height).toBeCloseTo(mm(297), 3);
}
function safeImages(page, width, height, precision = 3) {
  a4(page);
  for (const [w, b, c, h, x, y] of page.images) {
    expect(w).toBeCloseTo(mm(width), precision);
    expect(h).toBeCloseTo(mm(height), precision);
    expect(b).toBe(0); expect(c).toBe(0);
    expect(x).toBeGreaterThanOrEqual(mm(5) - 0.01);
    expect(y).toBeGreaterThanOrEqual(mm(5) - 0.01);
    expect(x + w).toBeLessThanOrEqual(page.width - mm(5) + 0.01);
    expect(y + h).toBeLessThanOrEqual(page.height - mm(5) + 0.01);
  }
}

test("PDF trim usa 3x3, respeita quantity e exporta descrições com --text", async ({}, info) => {
  const files = await fixture(info, [{ ...card, quantity: 11 }, { ...card, id: "02" }, { ...card, id: "03", quantity: 0 }]);
  const { stdout } = await generate(files, ["--pdf", "--trim", "--rounded", "--text"]);
  expect(stdout).toContain("12 cópia(s), 3 coluna(s)");
  const pages = await inspect(path.join(files.directory, "pdf", "input_trim_300dpi.pdf"));
  expect(pages.map(page => page.images.length)).toEqual([9, 3]);
  pages.forEach(page => safeImages(page, 63, 88));
  expect(new Set(pages[0].images.map(image => image[4])).size).toBe(3);
  expect(new Set(pages[0].images.map(image => image[5])).size).toBe(3);
  const first = pages[0].images[0], last = pages[0].images[8];
  expect(first[4]).toBeCloseTo(pages[0].width - last[4] - last[0], 3);
  expect(first[5] + first[3]).toBeCloseTo(pages[0].height - last[5], 3);
  const text = await inspect(path.join(files.directory, "pdf", "input_text_trim_300dpi.pdf"));
  expect(text.map(page => page.images.length)).toEqual([12]);
  expect(new Set(text[0].images.map(image => image[4])).size).toBe(3);
});

test("PDF bleed usa duas colunas e três linhas sem reduzir as cartas", async ({}, info) => {
  const files = await fixture(info, [{ ...card, quantity: 8 }]);
  await generate(files, ["--pdf"]);
  const pages = await inspect(path.join(files.directory, "pdf", "input_bleed_300dpi.pdf"));
  expect(pages.map(page => page.images.length)).toEqual([6, 2]);
  pages.forEach(page => safeImages(page, 69, 94));
  expect(new Set(pages[0].images.map(image => image[4])).size).toBe(2);
  expect(new Set(pages[0].images.map(image => image[5])).size).toBe(3);
});

for (const trim of [false, true]) {
  test(`PDF de texto recorta a caixa e reserva oito linhas com identificação: trim=${trim}`, async ({}, info) => {
    const files = await fixture(info, [{ ...card, quantity: 28 }]);
    await generate(files, ["--pdf-text", "--save-html", ...(trim ? ["--trim"] : [])]);
    const pdfs = await outputFiles(files.directory, ".pdf");
    expect(pdfs).toEqual([`pdf/input_text_${trim ? "trim" : "bleed"}_300dpi.pdf`]);
    const pages = await inspect(path.join(files.directory, pdfs[0]));
    expect(pages.map(page => page.images.length)).toEqual([24, 4]);
    for (const page of pages) {
      a4(page);
      expect(page.clips).toHaveLength(page.images.length);
      for (const [index, [x, y, width, height]] of page.clips.entries()) {
        expect(width).toBeCloseTo(mm(57), 1);
        expect(height).toBeCloseTo(mm(31), 1);
        expect(x).toBeGreaterThan(mm(5)); expect(y).toBeGreaterThan(mm(5));
        expect(x + width).toBeLessThan(page.width - mm(5));
        expect(y + height).toBeLessThan(page.height - mm(5));
        const [imageW, , , imageH, imageX, imageY] = page.images[index];
        expect(imageW).toBeCloseTo(mm(trim ? 63 : 69), 1);
        expect(imageH).toBeCloseTo(mm(trim ? 37 : 43), 1);
        expect(x - imageX).toBeCloseTo(mm(trim ? 3 : 6), 1);
        expect(y - imageY).toBeCloseTo(mm(trim ? 3 : 6), 1);
      }
    }
    const clips = pages[0].clips;
    expect(new Set(clips.map(clip => clip[0])).size).toBe(3);
    expect(new Set(clips.map(clip => clip[1])).size).toBe(8);
    expect(clips[1][0] - clips[0][0] - clips[0][2]).toBeCloseTo(1, 3);
    expect(clips[0][1] - clips[3][1] - clips[3][3]).toBeCloseTo(12, 3);
    const html = await fs.readFile(path.join(files.directory, "html", "01.html"), "utf8");
    expect(html).not.toContain("data-separate-text");
  });
}

test("PDF de texto com gap zero encosta as colunas e preserva a faixa de identificação", async ({}, info) => {
  const files = await fixture(info, [{ ...card, quantity: 6 }]);
  await generate(files, ["--pdf-text", "--trim", "--pdf-gap", "0"]);
  const [page] = await inspect(path.join(files.directory, "pdf", "input_text_trim_300dpi.pdf"));
  expect(page.clips).toHaveLength(6);
  expect(page.clips[1][0] - page.clips[0][0] - page.clips[0][2]).toBeCloseTo(0, 3);
  expect(page.clips[0][1] - page.clips[3][1] - page.clips[3][3]).toBeCloseTo(11, 3);
});

test("PDF segue --ids e não imprime quantity zero", async ({}, info) => {
  const files = await fixture(info, [{ ...card, quantity: 10 }, { ...card, id: "02", quantity: 2 }, { ...card, id: "03", quantity: 0 }]);
  await generate(files, ["--pdf", "--trim", "--ids", "02,03"]);
  const pages = await inspect(path.join(files.directory, "pdf", "input_trim_300dpi.pdf"));
  expect(pages.map(page => page.images.length)).toEqual([2]);
});

test("PDF não é criado se nenhuma carta tiver cópias ou houver IDs inválidos", async ({}, info) => {
  const files = await fixture(info, [{ ...card, quantity: 0 }]);
  const { stdout } = await generate(files, ["--pdf", "--pdf-text", "--bg-text", "--trim"]);
  expect(stdout).toContain("nenhuma carta selecionada");
  expect(await outputFiles(files.directory, ".pdf")).toEqual([]);
  await expect(generate(files, ["--pdf", "--ids", "missing"])).rejects.toMatchObject({ code: 1 });
  expect(await outputFiles(files.directory, ".pdf")).toEqual([]);
});

test("PDF valida margem e espaçamento e informa se três colunas não couberem", async ({}, info) => {
  for (const args of [["--pdf-margin", "-1"], ["--pdf-gap", "Infinity"], ["--pdf-gap", "abc"]]) {
    expect(() => parseArgs(["cards/Fluffusion.json", ...args])).toThrow();
  }
  const files = await fixture(info, [card]);
  await expect(generate(files, ["--pdf-text", "--pdf-margin", "20"])).rejects.toMatchObject({ code: 1 });
});


for (const trim of [false, true]) {
  test(`PDF de --bg-text mantém o recorte completo e quantity: trim=${trim}`, async ({}, info) => {
    const capacity = trim ? 21 : 12;
    const files = await fixture(info, [{ ...card, quantity: capacity }, { ...card, id: "02", quantity: 1 }, { ...card, id: "03", quantity: 0 }]);
    const args = ["--bg-text", "--pdf", "--rounded"];
    if (trim) args.push("--trim", "--pdf-gap", "0");
    const { stdout } = await generate(files, args);
    const mode = trim ? "trim" : "bleed";
    const pdfs = await outputFiles(files.directory, ".pdf");
    expect(pdfs).toEqual([`pdf/input_bg_text_${mode}_300dpi.pdf`, `pdf/input_${mode}_300dpi.pdf`]);
    expect(stdout).toContain(`${capacity + 1} cópia(s), ${trim ? 3 : 2} coluna(s)`);
    const pages = await inspect(path.join(files.directory, `pdf/input_bg_text_${mode}_300dpi.pdf`));
    expect(pages.map(page => page.images.length)).toEqual([capacity, 1]);
    pages.forEach(page => {
      safeImages(page, trim ? 63 : 69, trim ? 37 : 43, 1);
      expect(page.clips).toEqual([]);
    });
    expect(new Set(pages[0].images.map(image => image[4])).size).toBe(trim ? 3 : 2);
    expect(new Set(pages[0].images.map(image => image[5])).size).toBe(trim ? 7 : 6);
    const first = pages[0].images[0], nextColumn = pages[0].images[1];
    const nextRow = pages[0].images[trim ? 3 : 2];
    expect(nextColumn[4] - first[4] - first[0]).toBeCloseTo(trim ? 0 : 1, 3);
    expect(first[5] - nextRow[5] - nextRow[3]).toBeCloseTo(trim ? 11 : 12, 3);
  });
}

test("--text --bg-text --pdf gera três PDFs e respeita --ids e quantity zero", async ({}, info) => {
  const files = await fixture(info, [{ ...card, name: "Não selecionar", quantity: 50 }, { ...card, id: "02", name: "Voltuff", archetype: "Adulto Fluffusion", quantity: 2 }, { ...card, id: "03", name: "Não imprimir", quantity: 0 }]);
  await generate(files, ["--pdf", "--text", "--bg-text", "--trim", "--ids", "02,03"]);
  const pdfs = await outputFiles(files.directory, ".pdf");
  expect(pdfs).toEqual(["pdf/input_bg_text_trim_300dpi.pdf", "pdf/input_text_trim_300dpi.pdf", "pdf/input_trim_300dpi.pdf"]);
  for (const pdf of pdfs) {
    const pages = await inspect(path.join(files.directory, pdf));
    expect(pages.map(page => page.images.length)).toEqual([2]);
    if (pdf.includes("_text_")) {
      expect(pages[0].labels.map(label => label.text)).toEqual(["Voltuff | Adulto Fluffusion", "Voltuff | Adulto Fluffusion"]);
      const boxes = pages[0].clips.length ? pages[0].clips : pages[0].images.map(image => [image[4], image[5], image[0], image[3]]);
      for (const [index, [x, y, width, height]] of boxes.entries()) {
        for (const label of pages[0].labels.slice(index, index + 1)) {
          expect(label.fontSize).toBe(7);
          expect(label.x).toBeGreaterThanOrEqual(x);
          expect(label.x).toBeLessThan(x + width);
          expect(label.y).toBeGreaterThan(y + height);
          expect(label.y + label.fontSize).toBeLessThan(pages[0].height - mm(5));
        }
      }
    } else expect(pages[0].labels).toEqual([]);
  }
});


test("identificação usa linha única, ajusta nomes longos e aceita arquétipo ausente", async ({}, info) => {
  const longName = "Família de uma carta com um nome bastante longo para caber em uma linha";
  const files = await fixture(info, [
    { ...card, name: "Ação & Reação <Carta>", archetype: null },
    { ...card, id: "02", name: longName, archetype: "Arquétipo & União <Especial>" },
  ]);
  await generate(files, ["--pdf", "--text", "--bg-text", "--trim"]);
  for (const kind of ["text", "bg_text"]) {
    const [page] = await inspect(path.join(files.directory, "pdf", `input_${kind}_trim_300dpi.pdf`));
    expect(page.text).toContain("Ação & Reação <Carta>");
    expect(page.text.replace(/\s+/g, " ")).toContain(longName);
    expect(page.text).toContain("Arquétipo & União <Especial>");
    expect(page.text).not.toContain("null");
    expect(page.labels.map(label => label.text)).toEqual(["Ação & Reação <Carta>", `${longName} | Arquétipo & União <Especial>`]);
    expect(page.labels[0].fontSize).toBe(7);
    expect(page.labels[1].fontSize).toBeLessThan(7);
    expect(page.labels[1].fontSize).toBeGreaterThan(0);
    const boxes = page.clips.length ? page.clips : page.images.map(image => [image[4], image[5], image[0], image[3]]);
    expect(boxes[0][1]).toBeCloseTo(boxes[1][1], 3);
    expect(page.labels.every(label => label.y > boxes[0][1] + boxes[0][3])).toBe(true);
  }
});


test("PDFs reúnem todos os JSONs com IDs repetidos, variáveis próprias e quantidade de cada carta", async ({}, info) => {
  const directory = info.outputPath("decks");
  await fs.mkdir(directory, { recursive: true });
  const sources = [
    { file: "primeiro.json", title: "Carta A", quantity: 2 },
    { file: "segundo.json", title: "Carta B", quantity: 3 },
  ];
  for (const source of sources) {
    await fs.writeFile(path.join(directory, source.file), JSON.stringify({
      variables: { title: source.title, family: `Grupo ${source.title}`, description: `Descrição de ${source.title}.` },
      cards: [
        { ...card, id: "01", name: "${title}", archetype: "${family}", effect: "${description}", quantity: source.quantity },
        { id: "02", art: "http://localhost:1/should-not-load.png" },
      ],
    }));
  }
  const { stdout } = await run(process.execPath, ["build.mjs", ...sources.map(source => path.join(directory, source.file)),
    "--trim", "--text", "--bg-text", "--pdf", "--save-html", "--ids", "01", "--out", directory], { cwd: ROOT });
  expect(stdout).toContain("2 carta(s) gerada(s), 0 com erro");
  expect(await outputFiles(directory, ".png")).toEqual([
    "bg_text/primeiro_01_bg_text_trim_300dpi.png", "bg_text/segundo_01_bg_text_trim_300dpi.png",
    "text/primeiro_01_text_trim_300dpi.png", "text/segundo_01_text_trim_300dpi.png",
    "trim/primeiro_01_trim_300dpi.png", "trim/segundo_01_trim_300dpi.png",
  ]);
  expect(await outputFiles(directory, ".html")).toEqual(["html/primeiro_01.html", "html/segundo_01.html"]);
  const first = await fs.readFile(path.join(directory, "trim", "primeiro_01_trim_300dpi.png"));
  const second = await fs.readFile(path.join(directory, "trim", "segundo_01_trim_300dpi.png"));
  expect(first.equals(second)).toBe(false);
  const pdfs = await outputFiles(directory, ".pdf");
  expect(pdfs).toEqual(["pdf/deck_bg_text_trim_300dpi.pdf", "pdf/deck_text_trim_300dpi.pdf", "pdf/deck_trim_300dpi.pdf"]);
  for (const pdf of pdfs) {
    const pages = await inspect(path.join(directory, pdf));
    expect(pages.map(page => page.images.length)).toEqual([5]);
    if (pdf.includes("_text_")) {
      expect(pages[0].labels.map(label => label.text)).toEqual([
        "Carta A | Grupo Carta A", "Carta A | Grupo Carta A",
        "Carta B | Grupo Carta B", "Carta B | Grupo Carta B", "Carta B | Grupo Carta B",
      ]);
    } else {
      safeImages(pages[0], 63, 88);
      expect(pages[0].labels).toEqual([]);
    }
  }
});

test("JSONs de pastas diferentes com o mesmo nome recebem prefixos distintos", async ({}, info) => {
  const directory = info.outputPath("same-names");
  const sources = [];
  for (const [folder, name] of [["a", "Primeira"], ["b", "Segunda"]]) {
    const parent = path.join(directory, folder);
    await fs.mkdir(parent, { recursive: true });
    const file = path.join(parent, "deck.json");
    await fs.writeFile(file, JSON.stringify([{ ...card, name }]));
    sources.push(file);
  }
  await run(process.execPath, ["build.mjs", ...sources, "--pdf-text", "--trim", "--out", directory], { cwd: ROOT });
  expect(await outputFiles(directory, ".png")).toEqual([
    "text/deck-2_01_text_trim_300dpi.png", "text/deck_01_text_trim_300dpi.png",
    "trim/deck-2_01_trim_300dpi.png", "trim/deck_01_trim_300dpi.png",
  ]);
  const [page] = await inspect(path.join(directory, "pdf", "deck_text_trim_300dpi.pdf"));
  expect(page.images).toHaveLength(2);
  expect(page.labels.map(label => label.text)).toEqual(["Primeira | Filhote Fluffusion", "Segunda | Filhote Fluffusion"]);
});

test("IDs repetidos dentro do mesmo JSON continuam gerando erro e impedem o PDF", async ({}, info) => {
  const files = await fixture(info, [card, { ...card, name: "Outra carta" }]);
  await expect(generate(files, ["--pdf", "--trim"])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("nome de saída duplicado") });
  expect(await outputFiles(files.directory, ".pdf")).toEqual([]);
});
