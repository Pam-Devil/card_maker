# Servants of Nadir — gerador de cartas

Preencha um JSON em `cards/` com uma carta ou uma lista de cartas. A arte pode ser um caminho relativo ao projeto, uma URL HTTP(S) ou uma data URL.

```sh
npm install
npx playwright install chromium
npm run build:600 -- --trim --rounded
```

O deck padrão é `cards/Fluffusion.json`. Para artes em URLs HTTP de `localhost`, `127.0.0.1` ou `[::1]`, o gerador verifica a porta e, se estiver livre, inicia `python -m http.server` servindo `assets/art/`. O Python precisa estar instalado e disponível como `python`. O servidor iniciado pelo gerador é encerrado ao terminar, inclusive quando há erros ou interrupção. Servidores que já estavam ativos são reutilizados e permanecem abertos. Portas diferentes são atendidas por servidores separados. A detecção ocorre depois da substituição das variáveis do JSON.

```sh
node build.mjs cards/exemplo.json --dpi 300 --out out/exemplo
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --out out/fluffusion
node build.mjs --help
npm test
```

Sem `--trim`, a saída é `ID_bleed_600dpi.png` (69 × 94 mm), com a linha de corte indicando a carta de 63 × 88 mm e os 3 mm de sangria ao redor. Com `--trim`, a saída é somente `ID_trim_600dpi.png` (63 × 88 mm), sem guia por padrão. `--guides` permite exibir a guia também com `--trim`. `--rounded` aplica cantos transparentes de raio 6 mm à imagem escolhida. Arquivos de execuções anteriores permanecem na pasta; use uma pasta de saída diferente para cada versão.

Campos: `id` (opcional, usado no nome do arquivo), `name`, `archetype`, `element`, `cost`, `atk`, `hp`, `art`, `effect` e `artPosition` (opcional, padrão `50% 30%`). Use `\n` para quebras de linha no efeito. Elementos: pyro, hydro, electro, anemo, cryo, dendro, geo, caelo e abysso. O layout atual exibe custo e vida; `atk` permanece nos dados para uso pelas regras do jogo.

`build.mjs` é a entrada da linha de comando. `src/` contém argumentos, validação, servidor local, preenchimento de texto e exportação. `template.html` e `assets/card.css` definem o layout. As medidas de `:root` no CSS correspondem a `MM` em `src/export.mjs`, sem escalas que deformem círculos. `index.html` permite conferir a primeira carta do Fluffusion quando servido por HTTP.

`--save-html` salva o DOM preenchido para depuração com os caminhos dos recursos ajustados à pasta de saída. Sirva a raiz do projeto por HTTP para visualizar as máscaras SVG. Os geradores antigos foram removidos e `cards/nicole.json` foi migrado para o formato atual.

O campo `cost` aceita números ou texto, como `"cost": "X"`, `"cost": "X+1"` e `"cost": "∞"`. O tamanho da fonte se ajusta ao espaço do círculo.

Todos os contornos dos textos ficam no início de `assets/card.css`, dentro de `:root`: `--stroke-text` controla nome e vida; `--stroke-effect` controla a descrição; `--stroke-archetype` controla o arquétipo; `--stroke-cost` controla o custo. Cada variável recebe espessura e cor, por exemplo `0.2mm black`.

## Variáveis no JSON

Para reutilizar valores em várias cartas e campos, use um objeto com `variables` e `cards`:

```json
{
  "variables": {
    "archetype": "Fluffusion",
    "P_cost": 1,
    "P_hp": 2,
    "P_effect": "bla bla bla\nbla bla bla"
  },
  "cards": [
    {
      "id": "01",
      "name": "Flurruff",
      "archetype": "Filhote ${archetype}",
      "element": "cryo",
      "cost": "${P_cost}",
      "atk": 0,
      "hp": "${P_hp}",
      "art": "http://localhost:8000/Y-Cryo.png",
      "effect": "${P_effect}\nbla bla bla"
    }
  ]
}
```

A substituição `${nome}` vale para todos os valores de texto das cartas, incluindo custo, nome, efeito e caminho da arte. Variáveis aceitam texto ou números e podem referenciar outras variáveis. Uma referência isolada preserva o tipo do valor (`"${P_hp}"` vira o número `2`); dentro de uma frase, o valor vira texto. Variáveis inexistentes ou referências circulares geram um erro. As variáveis pertencem somente ao arquivo em que foram declaradas. Os formatos anteriores, com uma carta ou uma lista de cartas, continuam funcionando.

## Descrição em imagem separada

```sh
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --text --out out/fluffusion-text
```

`--text` gera dois PNGs por carta: `ID_trim_600dpi.png`, com nome, custo, vida, elemento e arte, mantendo a caixa de descrição e seu fundo, mas sem o texto; e `ID_text_trim_600dpi.png`, com somente o texto justificado e a borda externa da caixa, em fundo transparente. Na imagem separada, a caixa não leva o preenchimento colorido nem a arte de fundo.

A segunda imagem mantém a largura da carta exportada. Sua altura é a altura da caixa mais duas vezes a distância entre a caixa e a borda inferior da carta; a caixa fica centralizada na horizontal e na vertical. As medidas vêm do template. No layout atual, com `--trim`, são 63 × 34,4 mm (31 mm de caixa e 1,7 mm de margem em cada lado vertical). Sem `--trim`, a largura inclui sangria, a margem inferior inclui os 3 mm adicionais e a saída é 69 × 40,4 mm, com nome `ID_text_bleed_600dpi.png`.

`--rounded` arredonda a carta principal; a imagem de texto preserva somente a borda original da caixa e sua transparência. O tamanho ajustado da fonte, o stroke e a justificação da descrição são mantidos. Sem `--text`, a geração continua incluindo a descrição na própria carta.

## Gerar somente alguns IDs

```sh
node build.mjs cards/Fluffusion.json --ids 01,04,10 --dpi 600 --trim --rounded --text
```

`--ids` recebe IDs separados por vírgula e pode ser repetido (`--ids 01 --ids 04,10`). A seleção vale para todos os JSONs passados no comando e ocorre depois da substituição das variáveis, antes de validar ou carregar as artes das cartas selecionadas. Os IDs são comparados pelo valor exato: `01` é diferente de `1`; IDs numéricos do JSON são convertidos para texto para a comparação. IDs não encontrados são informados e o comando retorna erro. Sem `--ids`, todas as cartas são geradas. Imagens de execuções anteriores não são apagadas; use `--out` para escolher outra pasta quando necessário.

As descrições usam texto preto e fundo claro semitransparente com uma tonalidade do elemento. A opacidade do fundo é controlada por `--effect-background-opacity` no início de `assets/card.css`: `70%` deixa 30% de transparência. O stroke da descrição é independente dos outros textos e pode ser ajustado em `--stroke-effect`, no início de `assets/card.css`. A imagem separada de `--text` mantém o fundo transparente.
