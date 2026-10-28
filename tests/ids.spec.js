import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outputFiles } from "./output-files.mjs";
import { ROOT } from "../src/build.mjs";
import { parseArgs } from "../src/options.mjs";

const run = promisify(execFile);
const card = { name: "Prismuff", element: "caelo", cost: 1, atk: 0, hp: 2, effect: "Descrição da carta." };

async function fixture(info) {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const first = path.join(directory, "first.json");
  const second = path.join(directory, "second.json");
  await fs.writeFile(first, JSON.stringify({ variables: { id: "01" }, cards: [
    { ...card, id: "${id}" },
    { id: "02", art: "http://localhost:1/should-not-load.png" },
    { ...card, id: "1" },
  ] }));
  await fs.writeFile(second, JSON.stringify([{ ...card, id: 3 }, { ...card, id: "04" }]));
  return { directory, first, second };
}

const generate = ({ directory, first, second }, ids, extra = []) => run(process.execPath,
  ["build.mjs", first, second, "--ids", ids, "--trim", "--out", directory, ...extra], { cwd: ROOT });

test("--ids aceita repetição e espaços e rejeita listas vazias", () => {
  expect(parseArgs(["cards/Fluffusion.json", "--ids", "01, 04", "--ids", "04,10"]).ids).toEqual(["01", "04", "10"]);
  for (const args of [["--ids"], ["--ids", ""], ["--ids", "01,,04"], ["--ids", "   "]]) {
    expect(() => parseArgs(["cards/Fluffusion.json", ...args])).toThrow();
  }
});

test("exporta só os IDs pedidos de vários JSONs, incluindo o texto separado", async ({}, info) => {
  const files = await fixture(info);
  const { stdout } = await generate(files, "01,3", ["--text", "--rounded"]);
  expect(stdout).toContain("2 carta(s) gerada(s), 0 com erro");
  expect(await outputFiles(files.directory, ".png")).toEqual([
    "text/01_text_trim_300dpi.png", "text/3_text_trim_300dpi.png", "trim/01_trim_300dpi.png", "trim/3_trim_300dpi.png",
  ]);
});

test("ID ausente gera erro sem exportar outras cartas", async ({}, info) => {
  const files = await fixture(info);
  let error;
  try { await generate(files, "missing"); } catch (caught) { error = caught; }
  expect(error?.code).toBe(1);
  expect(error?.stderr).toContain("IDs não encontrados nos JSONs: missing");
  expect(await outputFiles(files.directory, ".png")).toEqual([]);
});

test("informa IDs ausentes mesmo quando outros IDs foram encontrados", async ({}, info) => {
  const files = await fixture(info);
  let error;
  try { await generate(files, "01,missing"); } catch (caught) { error = caught; }
  expect(error?.code).toBe(1);
  expect(error?.stderr).toContain("IDs não encontrados nos JSONs: missing");
  expect(await outputFiles(files.directory, ".png")).toEqual(["trim/01_trim_300dpi.png"]);
});
