import path from "node:path";

export const HELP = `Uso: node build.mjs cards/Fluffusion.json [opções]
  --dpi <n>        Resolução em DPI (padrão: 300)
  --ids <lista>    Gera somente os IDs separados por vírgula (ex.: "01,04,10")
  --out [pasta]    Pasta-base; sem valor, usa out/<nome do JSON> (padrão: out)
  --trim           Exporta somente a área de corte, sem arquivos bleed
  --pdf            Gera PDFs A4 das cartas e das saídas --text/--bg-text, respeitando quantity
  --pdf-text       Gera PDF A4 somente das descrições, em três colunas
  --pdf-margin <mm> Margem mínima de impressão (padrão: 5 mm)
  --pdf-gap <pt>   Espaço entre cartas (padrão: 1 pt)
  --no-description Oculta a descrição, mantendo a caixa e seu fundo
  --text           Exporta também um PNG transparente da descrição; mantém o texto na carta
  --bg-text        Exporta também a região inferior com fundo, descrição e bordas
  --rounded        Arredonda os cantos da imagem exportada (com ou sem --trim)
  --guides         Mostra a guia também com --trim (bleed já inclui a guia)
  --save-html      Salva o HTML preenchido para depuração
  --template <f>   Template HTML alternativo dentro do projeto
  --help           Mostra esta ajuda`;

export function parseArgs(argv) {
  const args = { dpi: 300, out: "out", template: "template.html", pdfMargin: 5, pdfGap: 1, files: [] };
  let automaticOut = false;
  const values = { "--dpi": "dpi", "--template": "template", "--ids": "ids", "--pdf-margin": "pdfMargin", "--pdf-gap": "pdfGap" };
  const flags = { "--trim": "trim", "--pdf": "pdf", "--pdf-text": "pdfText", "--text": "text", "--no-description": "noDescription", "--bg-text": "bgText", "--rounded": "rounded", "--guides": "guides", "--save-html": "saveHtml", "--help": "help" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const next = argv[i + 1];
      automaticOut = next === undefined || next.startsWith("-");
      args.out = automaticOut ? "out" : argv[++i];
      if (!args.out.trim()) throw new Error("A pasta de --out não pode ser vazia");
    } else if (values[arg]) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Falta um valor para ${arg}`);
      if (arg === "--ids") {
        const ids = value.split(",").map(id => id.trim());
        if (ids.some(id => !id)) throw new Error("--ids deve conter IDs não vazios separados por vírgula");
        args.ids = [...new Set([...(args.ids ?? []), ...ids])];
      } else args[values[arg]] = ["--dpi", "--pdf-margin", "--pdf-gap"].includes(arg) ? Number(value) : value;
    } else if (flags[arg]) args[flags[arg]] = true;
    else if (arg.startsWith("-")) throw new Error(`Opção desconhecida: ${arg}`);
    else args.files.push(arg);
  }
  if (args.help) return args;
  if (!args.files.length) throw new Error("Passe ao menos um arquivo JSON. Use --help para ver exemplos.");
  if (automaticOut) {
    const name = args.files.length === 1 ? path.parse(args.files[0]).name : "deck";
    args.out = path.join("out", name);
  }
  if (!Number.isFinite(args.dpi) || args.dpi <= 0) throw new Error("--dpi deve ser um número positivo e finito");
  for (const key of ["pdfMargin", "pdfGap"]) {
    if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error("Margem e espaçamento do PDF devem ser números não negativos");
  }
  return args;
}
