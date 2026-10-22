import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

// O HTTP local permite carregar máscaras SVG, bloqueadas via file:// pelo Chromium.
export async function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      const relative = path.relative(root, file);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        res.writeHead(403).end();
        return;
      }
      const data = await fs.readFile(file);
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}
