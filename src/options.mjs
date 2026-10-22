export const HELP = `Uso: node build.mjs cards/Fluffusion.json [opções]
  --dpi <n>        Resolução em DPI (padrão: 300)
  --ids <lista>    Gera somente os IDs separados por vírgula (ex.: 01,04,10)
  --out <pasta>    Pasta de saída (padrão: out)
  --trim           Exporta somente a área de corte, sem arquivos bleed
  --text           Separa a descrição: carta com caixa vazia e PNG transparente de texto
  --rounded        Arredonda os cantos da imagem exportada (com ou sem --trim)
  --guides         Mostra a guia também com --trim (bleed já inclui a guia)
  --save-html      Salva o HTML preenchido para depuração
  --template <f>   Template HTML alternativo dentro do projeto
  --help           Mostra esta ajuda`;

export function parseArgs(argv) {
  const args = { dpi: 300, out: "out", template: "template.html", files: [] };
  const values = { "--dpi": "dpi", "--out": "out", "--template": "template", "--ids": "ids" };
  const flags = { "--trim": "trim", "--text": "text", "--rounded": "rounded", "--guides": "guides", "--save-html": "saveHtml", "--help": "help" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values[arg]) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Falta um valor para ${arg}`);
      if (arg === "--ids") {
        const ids = value.split(",").map(id => id.trim());
        if (ids.some(id => !id)) throw new Error("--ids deve conter IDs não vazios separados por vírgula");
        args.ids = [...new Set([...(args.ids ?? []), ...ids])];
      } else args[values[arg]] = arg === "--dpi" ? Number(value) : value;
    } else if (flags[arg]) args[flags[arg]] = true;
    else if (arg.startsWith("-")) throw new Error(`Opção desconhecida: ${arg}`);
    else args.files.push(arg);
  }
  if (args.help) return args;
  if (!args.files.length) throw new Error("Passe ao menos um arquivo JSON. Use --help para ver exemplos.");
  if (!Number.isFinite(args.dpi) || args.dpi <= 0) throw new Error("--dpi deve ser um número positivo e finito");
  return args;
}
