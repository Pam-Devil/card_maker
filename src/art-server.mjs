import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function portOpen(host, port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

/** Gerencia somente os processos Python iniciados por esta execução. */
export function createArtServers(directory) {
  const children = new Set();
  const available = new Set();
  let closing;
  const killOwned = () => {
    for (const { child } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  };
  const interrupt = () => { void close().finally(() => process.exit(130)); };
  const terminate = () => { void close().finally(() => process.exit(143)); };
  process.on("exit", killOwned);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);

  async function ensure(art) {
    if (typeof art !== "string") return;
    let url;
    try { url = new URL(art); } catch { return; }
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port || 80);
    const key = `${host}:${port}`;
    if (available.has(key)) return;
    if (await portOpen(host, port)) {
      available.add(key);
      console.log(`Servidor de arte já ativo: ${url.origin}`);
      return;
    }

    const bind = host === "::1" ? "::1" : "127.0.0.1";
    const child = spawn("python", ["-m", "http.server", String(port), "--bind", bind, "--directory", directory], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let failure;
    let stderr = "";
    child.once("error", error => { failure = error; });
    child.stderr.on("data", data => { stderr = (stderr + data.toString()).slice(-4000); });
    const closed = new Promise(resolve => child.once("close", resolve));
    const entry = { child, closed };
    children.add(entry);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (failure || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Não foi possível iniciar o servidor Python em ${url.origin}: ${failure?.message || stderr.trim() || "processo encerrado"}`);
      }
      if (await portOpen(host, port)) {
        available.add(key);
        console.log(`Servidor Python de arte iniciado: ${url.origin} -> ${directory}`);
        return;
      }
      await Promise.race([delay(100), closed]);
    }
    throw new Error(`Tempo esgotado ao iniciar o servidor Python em ${url.origin}`);
  }

  function close() {
    if (closing) return closing;
    closing = (async () => {
      killOwned();
      await Promise.all([...children].map(({ closed }) => closed));
      const count = children.size;
      children.clear();
      process.off("exit", killOwned);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      if (count) console.log(`Servidor(es) Python de arte encerrado(s): ${count}`);
    })();
    return closing;
  }

  return { ensure, close };
}
