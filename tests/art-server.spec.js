import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ROOT } from "../src/build.mjs";

const run = promisify(execFile);
const card = { name: "Arte local", element: "caelo", cost: "-", atk: 0, hp: 2, effect: "Teste de servidor local." };
const png = () => sharp({ create: { width: 40, height: 60, channels: 3, background: "#456789" } }).png().toBuffer();

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function inputFile(info, deck) {
  const directory = info.outputPath("cards");
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, "input.json");
  await fs.writeFile(input, JSON.stringify(deck));
  return { directory, input };
}

const generate = ({ directory, input }, extra = []) => run(process.execPath,
  ["build.mjs", input, ...extra, "--trim", "--out", directory], { cwd: ROOT, timeout: 20_000 });

test("inicia Python em assets/art para portas locais e encerra ambos após exportar", async ({}, info) => {
  const filename = `.art-test-${randomUUID()}.png`;
  const artwork = path.join(ROOT, "assets", "art", filename);
  await fs.writeFile(artwork, await png());
  try {
    const first = await freePort();
    let second = await freePort();
    while (second === first) second = await freePort();
    const fixture = await inputFile(info, {
      variables: { art: `http://localhost:${first}/${filename}` },
      cards: [{ ...card, id: "first", art: "${art}" }, { ...card, id: "second", art: `http://127.0.0.1:${second}/${filename}` }],
    });
    const { stdout } = await generate(fixture);
    expect(stdout).toContain("Servidor Python de arte iniciado");
    expect(stdout).toContain("Servidor(es) Python de arte encerrado(s): 2");
    expect(await fs.readdir(path.join(fixture.directory, "trim"))).toEqual(expect.arrayContaining(["first_trim_300dpi.png", "second_trim_300dpi.png"]));
    expect(await portOpen(first)).toBe(false);
    expect(await portOpen(second)).toBe(false);
  } finally { await fs.unlink(artwork); }
});

test("reutiliza um servidor existente sem encerrá-lo", async ({}, info) => {
  const artwork = await png();
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests++;
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(artwork);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const fixture = await inputFile(info, { ...card, id: "existing", art: `http://localhost:${port}/art.png` });
    const { stdout } = await generate(fixture);
    expect(stdout).toContain("Servidor de arte já ativo");
    expect(stdout).not.toContain("Servidor Python de arte iniciado");
    expect(requests).toBeGreaterThan(0);
    expect(await portOpen(port)).toBe(true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("encerra Python se a imagem não existir e a carta falhar", async ({}, info) => {
  const port = await freePort();
  const fixture = await inputFile(info, { ...card, art: `http://localhost:${port}/missing-${randomUUID()}.png` });
  await expect(generate(fixture)).rejects.toMatchObject({ code: 1 });
  expect(await portOpen(port)).toBe(false);
});

test("encerra Python após erro de leitura de outro JSON", async ({}, info) => {
  const filename = `.art-test-${randomUUID()}.png`;
  const artwork = path.join(ROOT, "assets", "art", filename);
  await fs.writeFile(artwork, await png());
  try {
    const port = await freePort();
    const fixture = await inputFile(info, { ...card, art: `http://localhost:${port}/${filename}` });
    const invalid = path.join(fixture.directory, "invalid.json");
    await fs.writeFile(invalid, "{");
    await expect(generate(fixture, [invalid])).rejects.toMatchObject({ code: 1 });
    expect(await portOpen(port)).toBe(false);
  } finally { await fs.unlink(artwork); }
});
