import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { slug } from "./cards.mjs";
import { MM } from "./export.mjs";

const SCRIPT = fileURLToPath(new URL("./print_pdf.py", import.meta.url));
const ROOT = path.resolve(path.dirname(SCRIPT), "..");

export async function pdfPython() {
  const local = path.join(ROOT, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  try { await fs.access(local); return local; }
  catch { return "python"; }
}

async function runPdf(manifest) {
  const python = await pdfPython();
  return new Promise((resolve, reject) => {
    const child = execFile(python, [SCRIPT], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" }, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || `Não foi possível executar o gerador de PDF: ${error.message}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error("Resposta inválida do gerador de PDF")); }
      }
    });
    child.stdin.on("error", () => {}); // O erro de execução é informado pelo callback acima.
    child.stdin.end(JSON.stringify(manifest));
  });
}

export async function createPrintPdfs(entries, pdfDir, args) {
  const stem = args.files.length === 1 ? path.parse(args.files[0]).name : "deck";
  const name = slug(stem) || "deck";
  const mode = args.trim ? "trim" : "bleed";
  const width = args.trim ? MM.trimW : MM.bleedW;
  const height = args.trim ? MM.trimH : MM.bleedH;
  const active = entries.filter(entry => entry.quantity > 0);
  if (!active.length) {
    console.log("PDF não gerado: nenhuma carta selecionada tem quantity maior que zero.");
    return [];
  }
  const jobs = [];
  if (args.pdf) jobs.push({
    title: `${stem} - cartas (${mode})`,
    output: path.join(pdfDir, `${name}_${mode}_${args.dpi}dpi.pdf`),
    items: active.map(entry => ({ path: entry.imagePath, width, height, quantity: entry.quantity })),
  });
  if (args.pdfText || (args.pdf && args.text)) {
    jobs.push({
      title: `${stem} - descrições`, columns: 3,
      output: path.join(pdfDir, `${name}_text_${mode}_${args.dpi}dpi.pdf`),
      items: active.map(entry => {
        const { textSize: size, textBounds: bounds } = entry;
        return { path: entry.textPath, width: bounds.width, height: bounds.height,
          imageWidth: size.width, imageHeight: size.height,
          offsetX: bounds.left, offsetY: size.height - bounds.top - bounds.height,
          quantity: entry.quantity };
      }),
    });
  }
  if (args.pdf && args.bgText) jobs.push({
    title: `${stem} - região inferior (${mode})`,
    output: path.join(pdfDir, `${name}_bg_text_${mode}_${args.dpi}dpi.pdf`),
    items: active.map(entry => ({ path: entry.bgTextPath,
      width: entry.bgTextSize.width, height: entry.bgTextSize.height, quantity: entry.quantity })),
  });
  const results = await runPdf({ jobs, margin: args.pdfMargin ?? 5, gap: args.pdfGap ?? 1 });
  for (const result of results) console.log(`✔ PDF -> ${path.relative(path.dirname(pdfDir), result.path)} | ${result.pages} página(s), ${result.copies} cópia(s), ${result.columns} coluna(s)`);
  return results;
}
