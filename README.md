# Gerador de cartas

Gera cartas PNG e PDFs A4 a partir de JSONs em `cards/`, usando HTML/CSS para o layout.

## Instalação e início rápido

```sh
npm install
npx playwright install chromium
npm run build:600 -- --trim --rounded --out
```

Para PDFs, prepare o ambiente Python com ReportLab. O gerador usa `.venv` quando disponível; caso contrário, usa `python` do sistema:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Para gerar outro deck ou consultar a ajuda:

```sh
node build.mjs cards/exemplo1.json --dpi 300 --trim --out out/exemplo
node build.mjs --help
```

Artes aceitam caminhos relativos ao projeto, URLs HTTP(S) e data URLs. Se uma arte apontar para uma porta HTTP livre de `localhost`, `127.0.0.1` ou `[::1]`, o gerador inicia um servidor Python em `assets/art/` e o encerra ao terminar, inclusive em falhas ou interrupções. Servidores existentes são reutilizados e permanecem abertos; portas diferentes usam processos separados. Esse recurso requer `python` disponível no terminal e considera os caminhos após resolver as variáveis.

## Geração e arquivos de saída

Use `node build.mjs <arquivo.json> [outro.json ...] [opções]`.

| Opção | Comportamento |
|---|---|
| `--dpi <n>` | Resolução da imagem; padrão `300`. |
| `--trim` | Gera somente o corte de **63 × 88 mm**, sem imagens bleed. |
| `--rounded` | Aplica cantos transparentes de raio **6 mm**, com ou sem trim. |
| `--guides` | Mostra a guia também no trim; bleed já a inclui. |
| `--text` | Exporta também a descrição transparente, mantendo o texto na carta. |
| `--bg-text` | Exporta também a região inferior com fundo, descrição e molduras. |
| `--no-description` | Oculta a descrição e os separadores somente na carta principal e em seu PDF; mantém a caixa e o fundo. |
| `--pdf` | Gera PDF das cartas e, com `--text` ou `--bg-text`, os respectivos PDFs separados. |
| `--pdf-text` | Gera PDF das descrições; os PNGs também são produzidos. |
| `--pdf-margin <mm>` | Margem mínima da página; padrão `5`. |
| `--pdf-gap <pt>` | Espaço entre conjuntos na página; padrão `1`. |
| `--ids "01,04,10"` | Seleciona IDs exatos; aceita repetição da opção. |
| `--out [pasta]` | Define a pasta-base; sem valor, usa o nome do JSON. |
| `--save-html` | Salva o HTML preenchido para conferência. |
| `--template <arquivo>` | Usa outro template dentro do projeto. |
| `--help` | Exibe a ajuda. |

Sem `--trim`, as cartas medem **69 × 94 mm**, incluindo **3 mm de sangria** em cada lado e a linha de corte. `--text`, `--bg-text` e `--no-description` podem ser combinados: somente a última opção oculta o texto na carta; as exportações separadas mantêm a descrição.

```sh
# Carta completa e os dois recortes, com seus três PDFs
node build.mjs cards/Fluffusion.json --trim --rounded --text --bg-text --pdf --out

# Carta sem descrição, com o texto exportado separadamente
node build.mjs cards/Fluffusion.json --trim --text --no-description --pdf --out

# Somente os IDs indicados; mantenha as aspas para preservar os zeros no PowerShell
node build.mjs cards/Fluffusion.json --ids "01,04,10" --dpi 600 --trim --out
```

A seleção ocorre após resolver as variáveis e antes de validar ou carregar as artes selecionadas. `01` difere de `1`; IDs numéricos são comparados como texto. A opção vale para todos os JSONs informados; IDs ausentes geram erro. Sem `--ids`, todas as cartas são geradas.

### Pastas e recortes

Sem `--out`, a base é `out/`. Com `--out pasta`, usa essa pasta; com apenas `--out`, usa `out/<nome do JSON>/`, preservando espaços e maiúsculas. Para vários JSONs, a pasta automática é `out/deck/`. Coloque o JSON antes de `--out`, pois o próximo argumento sem prefixo de opção será interpretado como pasta.

```text
out/Fluffusion/
  trim/    ID_trim_600dpi.png          # ou bleed/ID_bleed_600dpi.png
  text/    ID_text_trim_600dpi.png
  bg_text/ ID_bg_text_trim_600dpi.png
  pdf/     fluffusion_trim_600dpi.pdf  # também ..._text_... e ..._bg_text_...
  html/    ID.html
```

Somente as pastas necessárias são criadas. Os nomes indicam modo e DPI; arquivos de execuções anteriores não são removidos.

| Exportação adicional | Conteúdo e dimensões no template atual |
|---|---|
| `--text` | Texto justificado e borda externa, sem preenchimento nem arte. Caixa centralizada em PNG transparente de **63 × 37 mm** no trim ou **69 × 43 mm** no bleed. |
| `--bg-text` | Recorte da carta com arte, caixa completa, texto, bordas laterais e inferior e uma faixa acima da caixa. Mesmas dimensões do PNG de texto; com `--rounded`, arredonda apenas os cantos inferiores. |

A altura dos dois recortes é a altura da caixa mais duas vezes sua distância à borda inferior da carta. O cálculo acompanha a geometria do template; a imagem de `--text` conserva fonte, stroke e borda original, sem arredondamento adicional.

## PDFs para impressão

Os PDFs usam os PNGs da execução atual, em tamanho real, respeitando a ordem do JSON, `--ids` e `quantity`. Uma falha de carta ou ID impede sua geração. Vários JSONs são reunidos em `deck_...pdf`.

| PDF | Área de cada imagem | Capacidade padrão em A4 |
|---|---|---|
| Cartas trim | 63 × 88 mm | **9** (3 × 3) |
| Cartas bleed | 69 × 94 mm | **6** (2 × 3) |
| Descrições | Caixa de 57 × 31 mm, mais identificação | **24** (3 × 8), em trim ou bleed |
| Região inferior trim | 63 × 37 mm, mais identificação | **18** (3 × 6) |
| Região inferior bleed | 69 × 43 mm, mais identificação | **12** (2 × 6) |

Essas capacidades consideram margem de **5 mm** e espaçamento de **1 pt**. O grid é centralizado nos dois eixos, inclusive na última página; as imagens não são reduzidas. `--pdf-margin` e `--pdf-gap` alteram o aproveitamento. O PDF de descrições exige três colunas e informa erro se elas não couberem.

O PDF de descrições recorta somente a borda externa da caixa, retirando as margens vazias do PNG. O PDF de `--bg-text` conserva o recorte completo. Com `--pdf-gap 0`, as colunas encostam; na vertical, permanece a faixa de identificação.

As duas versões separadas, incluindo `--pdf-text`, exibem **Nome | Arquétipo** acima de cada imagem: linha única em **7 pt**, com redução uniforme da fonte quando necessário. Sem arquétipo, mostram apenas o nome. A identificação não é acrescentada aos PNGs nem ao PDF de cartas completas.

Para imprimir, escolha **tamanho real / 100%**, sem ajustar à página.

## JSON das cartas

São aceitos uma carta isolada, uma lista de cartas ou um objeto `{ "variables": ..., "cards": [...] }`. Exemplo com valores compartilhados:

```json
{
  "variables": {
    "main_archetype": "Fluffusion",
    "cryo_name": "Furfluff",
    "baseHp": 5,
    "effect": "${name}: Recupero ${hp / 2} de vida."
  },
  "cards": [
    {
      "id": "01",
      "name": "${${element}_name}",
      "archetype": "Filhote ${main_archetype}",
      "element": "cryo",
      "cost": "X",
      "atk": 0,
      "hp": "${baseHp}",
      "quantity": 1,
      "font_size": null,
      "art": "assets/art/P-Cryo.png",
      "artPosition": "50% 30%",
      "effect": "${effect}\n---\nSegundo efeito."
    }
  ]
}
```

O efeito começa com `Furfluff: Recupero 2 de vida.`. Use `\n` para quebras de linha. Uma linha contendo apenas `---` vira um separador; `---` dentro de uma frase e tags como `<hr>` permanecem texto literal.

| Campo | Uso |
|---|---|
| `id` | Identificador para seleção e nome do arquivo; quando ausente, o nome da carta é usado no arquivo. |
| `name`, `archetype` | Nome e arquétipo exibidos na carta e nas identificações dos PDFs separados. |
| `element` | Obrigatório: `pyro`, `hydro`, `electro`, `anemo`, `cryo`, `dendro`, `geo`, `caelo` ou `abysso`. |
| `cost` | Obrigatório; número ou texto como `"-"`, `"X"`, `"X+1"` e `"∞"`. A fonte se ajusta ao círculo. |
| `hp`, `atk` | Obrigatórios; o layout mostra a vida. `atk` permanece nos dados para as regras do jogo. |
| `quantity` | Inteiro não negativo; padrão `1`. Repete cópias nos PDFs, sem duplicar PNGs nem aparecer na carta. `0` exclui da impressão. |
| `font_size` | Fonte da descrição em mm; número positivo ou `null` para ajuste automático. |
| `art`, `artPosition` | Caminho/URL da arte e posição no quadro; posição padrão `50% 30%`. |
| `effect` | Descrição justificada, com quebras de linha e separadores. |

Valores fixos de `quantity` e `font_size` usam números, não texto: use `3` e `2.58`, ou referências que retornem números; não `"3"`, `"2.58"` ou `"2.58mm"`.

### Variáveis, referências e cálculos

- `variables` tem escopo por JSON e aceita texto, números, `null`, seleções por ID e o modo de fonte em grupo descrito abaixo. Nomes podem conter espaços, como `${fonte base}`.
- `${variavel}` preserva o tipo quando ocupa o valor completo; em uma frase, o valor vira texto, inclusive `null`. Use `null` sem aspas para representar ausência.
- `name`, `element`, `hp` e `archetype` referenciam os atributos da própria carta, inclusive dentro de variáveis compartilhadas. A ordem dos campos não importa.
- Referências podem conter outras referências: `${${element}_name}` procura `cryo_name` para uma carta cryo; vários níveis e nomes compostos são aceitos.
- Nos efeitos, atributos da carta têm prioridade sobre variáveis gerais de mesmo nome. Por compatibilidade, ao compor o próprio campo, `${archetype}` pode usar `variables.archetype` como base. Prefira nomes gerais como `main_archetype` e `baseHp`.

Expressões aceitam `+`, `-`, `*`, `/`, `%`, sinais unários e parênteses, sem executar JavaScript. Números e strings numéricas decimais, inclusive notação científica, podem participar de cálculos. Texto como `"X"`, strings vazias, unidades e `null` não podem. Em `hp`, strings numéricas são convertidas antes do truncamento: `"5.9"` vira `5`.

Por padrão, variáveis numéricas e resultados finais são truncados para inteiros. Frações intermediárias da mesma expressão são preservadas: com `hp = 5`, `${hp / 2}` resulta em `2`, mas `${(hp / 2) * 2}` resulta em `5`. Uma variável intermediária `half: "${hp / 2}"` já vale `2` ao entrar em outro cálculo. **`font_size` preserva decimais em toda a cadeia de variáveis e expressões**; atributos como `hp` continuam usando seu valor já resolvido.

| Expressão com `hp = 5` | Resultado |
|---|---|
| `${trunc(hp / 2)}` | `2` (descarta a parte decimal) |
| `${floor(hp / 2)}` | `2` (arredonda para baixo) |
| `${ceil(hp / 2)}` | `3` (arredonda para cima) |
| `${round(hp / 2)}` | `3` (mais próximo; empates para mais infinito) |

As funções recebem um argumento; `round(-2.5)` resulta em `-2`. Referências ausentes/circulares, blocos sem fechamento, divisão por zero, resultados não finitos e inteiros fora do limite seguro geram erro.

### Seleções por ID e fonte mínima por grupo

Uma variável pode escolher o valor pelo ID resolvido da carta. Exemplo de definição dentro de `variables`:

```json
"fonte": {
  "default": null,
  "cases": [
    { "ids": "01-05,08", "value": { "auto": "min" } },
    { "ids": ["06-07", "09-11"], "value": 2.58 }
  ]
}
```

Use `"font_size": "${fonte}"` nas cartas. O primeiro caso correspondente vence; sem correspondência, vale `default`, ou `null` se omitido. `value` e `default` aceitam texto, números, `null` e referências, inclusive cálculos e nomes dinâmicos. Apenas o ramo escolhido é expandido; seleções também podem definir efeitos, custo, vida e quantidade.

`ids` aceita lista, texto com vírgulas ou um número. Intervalos são inclusivos: `01-05` exige largura de dois dígitos, enquanto `1-5` corresponde a IDs sem zeros. Extremos com zeros à esquerda precisam da mesma largura (`01-5` é inválido); IDs textuais são comparados literalmente. Para IDs grandes, use strings no JSON para preservar a precisão; os intervalos são comparados com `BigInt`, sem expandir listas.

`{"auto":"min"}` mede a fonte automática de cada membro do grupo e aplica a menor a todos, sem arredondar a medida. Cada caso forma seu grupo. Com `--ids`, o cálculo inclui membros não selecionados e `quantity: 0` do mesmo JSON, sem carregar suas artes; somente os grupos necessários são medidos. O resultado vale para carta, exportações e prévia.

Também é possível definir `"fonte": {"auto":"min"}` para um grupo único ou usar esse objeto em `default`. Esse modo só pode ocupar o valor completo de `font_size`, diretamente por referência ou aliases; não pode ser inserido em frases ou cálculos.

## Fontes e aparência

A descrição usa texto preto sobre fundo claro semitransparente, tingido pelo elemento. Com `font_size: null` ou campo omitido, a fonte se ajusta de **2,8 a 1,5 mm**. Um número positivo, como `2.58`, fixa o tamanho em mm, inclusive fora desse intervalo, sem redução automática. Variáveis e cálculos também funcionam: `${hp / 2}` em `font_size` resulta em `2,5 mm` para `hp = 5`.

O console informa a fonte final e o modo: `automática`, `fixa` ou `mínima do grupo`. Se houver excesso, exibe ID, fonte atual e máxima recomendada, sem repetir a descrição. A recomendação é arredondada para baixo com duas casas decimais, pode ser menor que 1,5 mm e não altera a exportação. Se o espaçamento impedir qualquer encaixe, informa `indisponível`.

Os controles visuais ficam em `:root`, no início de `assets/card.css`:

| Controle | Ajuste |
|---|---|
| `--stroke-text`, `--stroke-effect`, `--stroke-archetype`, `--stroke-cost` | Contorno de nome/vida, descrição, arquétipo e custo; espessura e cor, como `0.2mm black`. |
| `--effect-background-opacity` | Opacidade do preenchimento; atual `80%` (20% transparente). |
| `--safe-inset`, `--effect-bottom-gap` | Margens laterais e inferior da caixa; atuais `3 mm`, com a inferior acompanhando `--safe-inset`. |
| `--effect-separator-thickness` | Espessura do separador; atual `0.15mm`. |
| `--effect-separator-gap` | Espaço acima e abaixo do separador; atual `0.4mm`. |
| `--effect-separator-width`, `--effect-separator-color` | Largura e cor do separador; atuais `90%` e `black`. |
| `effect-text { line-height: ... }` | Entrelinhas da descrição; atual `1.2`. |

O separador participa do ajuste de fonte e sua largura não ultrapassa o interior da caixa. Traços menores que um pixel são suavizados; a aparência depende do DPI e do zoom. A identificação dos PDFs tem controles `LABEL_FONT_SIZE`, `LABEL_SEPARATOR`, `LABEL_LINE_HEIGHT` e `LABEL_GAP` em `src/print_pdf.py`.

## Estrutura, prévia e testes

| Local | Responsabilidade |
|---|---|
| `build.mjs`, `src/` | Comandos, resolução de dados, renderização, servidores e exportação. |
| `template.html`, `assets/card.css` | Estrutura e aparência da carta. |
| `src/export.mjs`, `src/units.mjs` | Medidas físicas e conversões de unidades; mantenha as medidas do CSS compatíveis com `MM`. |
| `src/print_pdf.py` | Paginação A4 e identificação dos recortes. |
| `cards/`, `tests/` | Decks JSON, testes e auxiliares de validação. |

Sirva a raiz do projeto por HTTP para abrir `index.html` e conferir a primeira carta do Fluffusion; máscaras SVG dependem desse acesso. `--save-html` salva a carta preenchida com caminhos ajustados à saída.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
npm test
```

Os testes cobrem variáveis, fontes, seleção de IDs, dimensões, recortes, PDFs e ciclo de vida dos servidores. Relatórios, arquivos temporários, ambientes e imagens geradas permanecem fora do Git.
