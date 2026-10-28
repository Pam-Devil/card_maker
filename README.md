# Gerador de cartas

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

Campos: `id` (opcional, usado no nome do arquivo), `quantity` (opcional, padrão `1`), `font_size` (opcional, padrão `null`), `name`, `archetype`, `element`, `cost`, `atk`, `hp`, `art`, `effect` e `artPosition` (opcional, padrão `50% 30%`). Use `\n` para quebras de linha no efeito. Elementos: pyro, hydro, electro, anemo, cryo, dendro, geo, caelo e abysso. O layout atual exibe custo e vida; `atk` permanece nos dados para uso pelas regras do jogo.

`build.mjs` é a entrada da linha de comando. `src/` contém argumentos, validação, servidor local, preenchimento de texto e exportação. `template.html` e `assets/card.css` definem o layout. As medidas de `:root` no CSS correspondem a `MM` em `src/export.mjs`, sem escalas que deformem círculos. `index.html` permite conferir a primeira carta do Fluffusion quando servido por HTTP.

`--save-html` salva o DOM preenchido em `html/`, com os caminhos dos recursos ajustados à pasta de saída. Sirva a raiz do projeto por HTTP para visualizar as máscaras SVG. Os geradores antigos foram removidos e `cards/nicole.json` foi migrado para o formato atual.

O campo `cost` aceita números ou texto, como `"cost": "X"`, `"cost": "X+1"` e `"cost": "∞"`. O tamanho da fonte se ajusta ao espaço do círculo.

Todos os contornos dos textos ficam no início de `assets/card.css`, dentro de `:root`: `--stroke-text` controla nome e vida; `--stroke-effect` controla a descrição; `--stroke-archetype` controla o arquétipo; `--stroke-cost` controla o custo. Cada variável recebe espessura e cor, por exemplo `0.2mm black`.

## Tamanho da fonte por carta

Use `font_size` para definir o tamanho **fixo da descrição em milímetros**, com casas decimais:

```json
"font_size": 2.58
```

Com `"font_size": null` ou sem o campo, o ajuste automático continua usando de 2,8 a 1,5 mm. Todas as cartas atuais receberam `font_size: null`, preservando seu tamanho automático. Um número positivo fixa o tamanho escolhido, inclusive fora desse intervalo; não é reduzido automaticamente. Se o texto não couber, o aviso exibe somente o ID da carta, a fonte atual e a fonte máxima recomendada, em milímetros, sem repetir a descrição. A recomendação é medida na própria caixa e arredondada para baixo com duas casas decimais; pode ficar abaixo de 1,5 mm, mas não altera a fonte exportada. Se os separadores ou espaçamentos impedirem o encaixe mesmo reduzindo a fonte, a recomendação aparece como `indisponível`. O campo afeta apenas a descrição, tanto na carta quanto na exportação separada e nos PDFs. Ao concluir cada carta, o console mostra o tamanho final da fonte em milímetros, com duas casas decimais, indicando se foi automático ou fixo: `fonte: 2.33 mm (automática)`. Para compartilhar o modo automático, declare `"auto_font": null` dentro de `variables` e use `"font_size": "${auto_font}"` na carta. Use `null` sem aspas; `"null"` é texto.

Use um número sem unidade, como `2.58`, e não `"2.58mm"` ou `"2.58"`. O campo `font_size` preserva os decimais de valores diretos, variáveis, aliases, referências dinâmicas e cálculos. Por exemplo, declare `"fonte": 2.58` em `variables` e use `"font_size": "${fonte}"`; o tamanho será 2,58 mm. Também é possível usar `"font_size": "${hp / 2}"`, que resulta em 2,5 mm para `hp = 5`. As funções explícitas `trunc`, `floor`, `ceil` e `round` continuam disponíveis. Essa exceção vale apenas para `font_size`: a mesma variável `${fonte}` usada no efeito ou em outro campo continua retornando `2`, conforme a regra geral de inteiros. Referências a atributos da carta, como `hp`, usam o valor já resolvido do atributo.

## Separador na descrição

Uma linha contendo apenas `---` gera um separador horizontal dentro da caixa de texto:

```json
"effect": "Primeiro efeito.\n---\nSegundo efeito."
```

O separador também funciona em textos de `variables`, depois da substituição das variáveis, e acompanha os PNGs da carta, a exportação `--text` e os PDFs. Quebras de linha comuns e a justificação são preservadas. `---` no meio de uma frase continua sendo texto; tags como `<hr>` também são tratadas como texto literal.

Os parâmetros ficam no início de `assets/card.css`, dentro de `:root`:

```css
--effect-separator-thickness: 0.15mm; /* Espessura do traço. */
--effect-separator-gap: 0.5mm;       /* Espaço acima e abaixo. */
--effect-separator-width: 100%;     /* Largura; 60% faz uma linha menor centralizada. */
--effect-separator-color: black;    /* Cor. */
```

Com os valores padrão, o separador ocupa aproximadamente 1,15 mm de altura, menos que uma linha de texto. O ajuste automático da fonte considera esse espaço. A largura é limitada à área interna da caixa. Espessuras muito finas, como `0.02mm` e `0.03mm`, são suavizadas na rasterização: quando o traço ocupa menos de um pixel, ele aparece mais claro, em vez de saltar para uma linha preta inteira. A mesma espessura pode parecer diferente conforme o DPI e o zoom do visualizador.

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

A substituição `${nome}` vale para todos os valores de texto das cartas, incluindo custo, nome, efeito e caminho da arte. Variáveis aceitam texto, números, `null` ou seleções por ID, e podem referenciar outras variáveis. Uma referência isolada preserva o tipo do valor (`"${P_hp}"` vira o número `2`, e uma referência a uma variável com valor `null` continua sendo `null`); dentro de uma frase, o valor vira texto, inclusive `null`, que aparece como `null`. Variáveis inexistentes ou referências circulares geram um erro. As variáveis pertencem somente ao arquivo em que foram declaradas. Os formatos anteriores, com uma carta ou uma lista de cartas, continuam funcionando.

Nomes de variáveis também podem ser montados dinamicamente. Em `${${element}_name}`, o gerador resolve `${element}` primeiro; se o elemento for `cryo`, ele busca `cryo_name`:

```json
{
  "variables": {
    "cryo_name": "Flurruff",
    "pyro_name": "Brasa",
    "shared_effect": "Posso buscar um ${${element}_name} no meu deck."
  },
  "cards": [
    {
      "id": "01",
      "name": "Adulto Flurruff",
      "element": "cryo",
      "cost": 2,
      "atk": 0,
      "hp": 3,
      "effect": "${shared_effect}"
    }
  ]
}
```

Nesse exemplo, o efeito resulta em `Posso buscar um Flurruff no meu deck.`. A resolução ocorre por carta, inclusive dentro de `variables`. É possível usar vários níveis, vários trechos no nome e cálculos, como `${${element}_hp}` e `${${${element}_hp} + 2}`. Referências isoladas preservam o tipo numérico; valores inseridos em frases viram texto. Nomes inexistentes, referências circulares e blocos `${...}` sem fechamento geram erro.

## Variáveis condicionais por ID

Uma variável pode escolher seu valor conforme o ID resolvido da carta. Use `default` para o valor de fallback e uma lista `cases`:

```json
"variables": {
  "fonte": {
    "default": null,
    "cases": [
      { "ids": ["01-05", "08", "12"], "value": 2.58 },
      { "ids": ["06-07", "09-11"], "value": 2.33 }
    ]
  }
}
```

Em cada carta, use `"font_size": "${fonte}"`. O primeiro caso correspondente prevalece; sem correspondência, vale `default`, ou `null` quando `default` for omitido. Uma mesma lista `ids` aceita vários IDs e intervalos inclusivos. Para um formato compacto, `ids` também aceita texto (`"01-05"`), vários seletores separados por vírgula (`"01-05,08,12"`) ou um único número (`7`). `01-05` corresponde a `01`, `02`, `03`, `04` e `05`, preservando zeros à esquerda; `1-5` corresponde aos IDs sem zeros. IDs individuais também podem ser números, como `7`, ou textos, como `"card-x"`.

Esse recurso também vale para variáveis usadas em efeitos, custo, vida, quantidade e outros campos. `value` e `default` aceitam texto, números, `null` e referências a outras variáveis, inclusive expressões e nomes dinâmicos. Apenas o ramo escolhido é expandido para cada carta. As regras de precisão continuam as mesmas: `font_size` preserva decimais; os demais campos seguem o truncamento de variáveis numéricas.

## Fonte mínima por grupo de IDs

Para padronizar a fonte de um grupo, use `{"auto": "min"}` como `value`:

```json
"variables": {
  "fonte": {
    "default": null,
    "cases": [
      { "ids": ["01-05", "08"], "value": { "auto": "min" } },
      { "ids": ["06-07", "09-11"], "value": { "auto": "min" } },
      { "ids": ["12-15"], "value": 2.58 }
    ]
  }
}
```

As cartas que usam `"font_size": "${fonte}"` e correspondem ao primeiro caso compartilham uma fonte; as do segundo caso compartilham outra. O gerador mede a fonte automática de cada membro e aplica o menor tamanho a todos os membros daquele grupo, sem arredondar o tamanho medido. Por exemplo, tamanhos automáticos de 2,80, 2,58 e 2,33 mm resultam em 2,33 mm para todo o grupo. Valores fixos e `default: null` continuam disponíveis nos demais casos.

Com `--ids`, o cálculo considera o grupo completo do mesmo JSON, incluindo membros não selecionados e cartas com `quantity: 0`. Assim, regenerar uma única carta mantém a mesma fonte. As artes dos membros não selecionados não são carregadas para essa medição. Só são medidos os grupos necessários à exportação solicitada, e cada JSON mantém seus próprios grupos.

O resultado é aplicado à carta, aos arquivos de `--text` e `--bg-text`, aos PDFs e à prévia `index.html`. O console identifica esses tamanhos como `mínima do grupo`. `{"auto":"min"}` só pode ocupar o valor completo de `font_size`, diretamente por uma referência ou por aliases; não pode ser inserido em frases nem usado em cálculos.

Também é possível usar `"default": {"auto":"min"}` para agrupar as cartas sem correspondência, ou declarar `"fonte": {"auto":"min"}` em `variables` para um único grupo com todas as cartas que utilizam essa variável em `font_size`.

## Cartas sem descrição

Use `--no-description` para ocultar o texto da descrição e seus separadores, preservando a caixa, as bordas e o fundo:

```sh
node build.mjs cards/Fluffusion.json --trim --rounded --no-description --out
```

A opção funciona com trim e bleed e afeta somente a carta principal e seu PDF. Sozinha, ela gera apenas as cartas, sem criar a imagem de texto separado. Se você incluir `--text`, `--bg-text` ou `--pdf-text`, os arquivos separados continuam contendo a descrição normalmente, inclusive os respectivos PDFs.

## Descrição em imagem separada

```sh
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --text --out out/fluffusion-text
```

`--text` gera dois PNGs por carta: `ID_trim_600dpi.png`, com nome, custo, vida, elemento e arte, mantendo a caixa de descrição e seu fundo, mas sem o texto; e `ID_text_trim_600dpi.png`, com somente o texto justificado e a borda externa da caixa, em fundo transparente. Na imagem separada, a caixa não leva o preenchimento colorido nem a arte de fundo.

A segunda imagem mantém a largura da carta exportada. Sua altura é a altura da caixa mais duas vezes a distância entre a caixa e a borda inferior da carta; a caixa fica centralizada na horizontal e na vertical. As medidas vêm do template. As margens laterais e inferior entre a caixa e o trim são iguais: 3 mm, definidos por `--safe-inset` no início de `assets/card.css`. Por padrão, `--effect-bottom-gap` acompanha esse valor. No layout atual, com `--trim`, são 63 × 37 mm (31 mm de caixa e 3 mm de margem em cada lado vertical). Sem `--trim`, a largura inclui sangria, a margem inferior inclui os 3 mm adicionais e a saída é 69 × 43 mm, com nome `ID_text_bleed_600dpi.png`.

`--rounded` arredonda a carta principal; a imagem de texto preserva somente a borda original da caixa e sua transparência. O tamanho ajustado da fonte, o stroke e a justificação da descrição são mantidos. Sem `--text`, a geração continua incluindo a descrição na própria carta.

## Região inferior com fundo

`--bg-text` gera um PNG adicional com a região inferior da própria carta: arte de fundo, caixa de descrição completa, texto, separadores e molduras laterais e inferior. A largura acompanha a carta exportada. O recorte começa acima da caixa por uma distância igual à margem entre a caixa e a borda inferior e termina na borda inferior da carta.

```sh
node build.mjs cards/Fluffusion.json --dpi 600 --trim --bg-text --out
```

O arquivo fica em `out/Fluffusion/bg_text/ID_bg_text_trim_600dpi.png`. No layout atual, mede 63 × 37 mm com `--trim`. Sem `--trim`, inclui a sangria, mede 69 × 43 mm e usa o nome `ID_bg_text_bleed_600dpi.png`. A região é recortada da carta já montada, preservando escala e posição da arte, fonte e bordas. Templates com outras medidas são calculados a partir da posição real da caixa.

Com `--rounded`, somente os cantos inferiores desse recorte ficam arredondados; o topo continua reto. É possível combinar `--bg-text` com `--text`: a carta principal fica com a caixa vazia, a imagem de `text/` contém a descrição transparente e a imagem de `bg_text/` contém a região inferior completa com fundo e texto. A seleção `--ids` também vale para esses arquivos.

Combine `--bg-text` com `--pdf` para gerar também um PDF A4 dos recortes inferiores:

```sh
node build.mjs cards/Fluffusion.json --dpi 600 --trim --bg-text --pdf --out
```

O PDF adicional fica na subpasta `pdf/`, com nome `fluffusion_bg_text_trim_600dpi.pdf` (ou `..._bleed_...pdf` sem trim). Ele preserva toda a imagem com fundo e bordas, sem remover suas margens, e repete as cartas conforme `quantity`, na ordem do JSON e respeitando `--ids`. Com margem de 5 mm e espaçamento de 1 ponto, cabem até 21 regiões trim (3 × 7) ou 12 regiões bleed (2 × 6) por página. As opções `--pdf-margin` e `--pdf-gap` também se aplicam. `--text --bg-text --pdf` gera os três PDFs: cartas, descrições transparentes e regiões inferiores com fundo.

## Gerar somente alguns IDs

```sh
node build.mjs cards/Fluffusion.json --ids "01,04,10" --dpi 600 --trim --rounded --text
```

`--ids` recebe IDs separados por vírgula e pode ser repetido (`--ids "01" --ids "04,10"`). A seleção vale para todos os JSONs passados no comando e ocorre depois da substituição das variáveis, antes de validar ou carregar as artes das cartas selecionadas. Os IDs são comparados pelo valor exato: `01` é diferente de `1`; IDs numéricos do JSON são convertidos para texto para a comparação. IDs não encontrados são informados e o comando retorna erro. Sem `--ids`, todas as cartas são geradas. Imagens de execuções anteriores não são apagadas; use `--out` para escolher outra pasta quando necessário.

As descrições usam texto preto e fundo claro semitransparente com uma tonalidade do elemento. A opacidade do fundo é controlada por `--effect-background-opacity` no início de `assets/card.css`: `70%` deixa 30% de transparência. O stroke da descrição é independente dos outros textos e pode ser ajustado em `--stroke-effect`, no início de `assets/card.css`. A imagem separada de `--text` mantém o fundo transparente.

## Atributos da carta e cálculos

Dentro de `${...}`, `name`, `element`, `hp` e `archetype` referenciam os atributos da própria carta. Isso também funciona em textos declarados em `variables`: um mesmo efeito compartilhado é resolvido individualmente para cada carta. Atributos são resolvidos antes do efeito; a ordem dos campos no JSON não importa. Por exemplo, `"archetype": "Família Fluffusion"` com `"effect": "Busque uma carta ${archetype}."` produz `Busque uma carta Família Fluffusion.`. Isso também vale quando o efeito está em `variables` ou quando o arquétipo foi montado usando outras variáveis.

```json
{
  "variables": {
    "baseHp": 3,
    "effect": "${name} (${element}): Recupero ${hp / 2} de vida."
  },
  "cards": [
    {
      "id": "01",
      "name": "Prismuff",
      "element": "caelo",
      "cost": "-",
      "atk": 0,
      "hp": "${baseHp + 2}",
      "effect": "${effect}"
    }
  ]
}
```

A vida calculada é `5` e a descrição é `Prismuff (caelo): Recupero 2 de vida.` São aceitos `+`, `-`, `*`, `/`, `%`, sinais unários e parênteses. Variáveis usadas em cálculos devem ser números. Não há execução de JavaScript, acesso a objetos ou avaliação de código no JSON.

Exceto na resolução de `font_size`, valores numéricos das variáveis, `hp` numérico e o resultado de cada `${...}` são convertidos para inteiros com `trunc` por padrão (descarta a parte decimal, inclusive para negativos). As frações intermediárias de uma mesma expressão são preservadas: `${(hp / 2) * 2}` resulta em `5` quando `hp` é `5`. Já uma variável `half` declarada como `"${hp / 2}"` vale `2` antes de ser usada em outro cálculo.

Para escolher outra regra, use `${trunc(hp / 2)}`, `${floor(hp / 2)}`, `${ceil(hp / 2)}` ou `${round(hp / 2)}`. Com `hp = 5`, os resultados são `2`, `2`, `3` e `3`, respectivamente. `round` arredonda empates em direção a mais infinito, como `round(-2.5) = -2`. As funções recebem um argumento. Divisões por zero, resultados não finitos, inteiros fora do limite seguro e referências circulares geram erro.

Evite declarar variáveis gerais chamadas `name`, `element`, `hp` e `archetype`: nos efeitos, os atributos da carta têm prioridade. Por compatibilidade, ao compor o próprio atributo, uma referência ao mesmo nome pode usar a variável geral como base: `"element": "${element}"` usa `variables.element`, e `"archetype": "Filhote ${archetype}"` usa `variables.archetype`. Depois disso, `${archetype}` nos efeitos retorna o valor completo da carta, como `Filhote Fluffusion`. Para valores base e fórmulas, prefira nomes como `baseHp`, `cardName`, `baseElement` e `main_archetype`. As referências da carta e as expressões também funcionam nos formatos antigos de carta única e lista de cartas.

## Quantidade de cópias no deck

Cada carta pode declarar `"quantity": 3` para indicar três cópias no deck. O valor deve ser um inteiro maior ou igual a zero; `0` significa que a carta não faz parte da composição do deck. Quando omitido, o padrão é `1`, preservando a compatibilidade com JSONs antigos.

O campo aceita variáveis e expressões, como `"quantity": "${copies}"` ou `"quantity": "${ceil(hp / 2)}"`. O resultado resolvido precisa ser numérico e não negativo; não use `"quantity": "3"` como texto simples, e sim `"quantity": 3`.

A quantidade é um dado de composição do deck: não aparece no layout e não duplica os PNGs exportados. Nos PDFs de impressão, cada carta é repetida de acordo com `quantity`; quantidade zero não é impressa. Continua sendo gerada uma imagem por carta selecionada, independentemente da quantidade. Os JSONs atuais receberam `quantity: 1` em cada carta, para você ajustar as quantidades desejadas.

## PDFs para impressão

O gerador monta folhas A4 com imagens em tamanho real, sem alterar as dimensões das cartas. A exportação usa Python com ReportLab. Para preparar o ambiente no Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

O gerador usa esse ambiente automaticamente quando presente. Sem `.venv`, usa `python` do sistema (nesse caso, instale com `python -m pip install -r requirements.txt`). Para executar os testes de PDF, instale também `requirements-dev.txt` no mesmo ambiente.

```sh
# Cartas completas: A4 com até 3 × 3 no trim
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --pdf

# Carta com caixa vazia e PDF separado com as descrições
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --text --pdf

# Somente o PDF de descrições (os PNGs também são gerados)
node build.mjs cards/Fluffusion.json --dpi 600 --trim --pdf-text

# Cartas completas e descrições separadas sem esvaziar o texto da carta
node build.mjs cards/Fluffusion.json --dpi 600 --trim --pdf --pdf-text
```

Os PDFs são gravados na subpasta `pdf/` de `--out`: por exemplo, `fluffusion_trim_600dpi.pdf` e `fluffusion_text_trim_600dpi.pdf`. Sem `--trim`, os nomes usam `bleed`. Vários JSONs no mesmo comando são reunidos em `deck_...pdf`.

O layout padrão usa margem mínima de **5 mm**, espaço de **1 pt** entre imagens e centralização horizontal e vertical, inclusive na última página. No trim são até **9 cartas por página (3 × 3)**; no bleed são **6 (2 × 3)**. As cartas preservam 63 × 88 mm ou 69 × 94 mm, respectivamente. `--pdf-margin 8` altera a margem para 8 mm; `--pdf-gap 2` altera o espaçamento para 2 pt. O número de linhas/colunas se adapta à área disponível, sem reduzir as imagens.

O PDF de descrições usa **três colunas** e o máximo de linhas que couber na altura. Ele considera apenas os limites da borda externa da caixa de texto, removendo todo o espaço vazio ao redor, tanto em trim quanto em bleed. A borda e as letras mantêm seu tamanho original; os PNGs separados continuam com suas margens. No template atual, cada caixa mede aproximadamente **57 × 31 mm** e cabem até **27 descrições por página (3 × 9)** com as opções padrão. A distância entre as bordas é definida por `--pdf-gap` (1 ponto por padrão); use `--pdf-gap 0` para encostar as caixas e compartilhar as linhas de corte. Uma margem configurada que impossibilite as três colunas gera uma mensagem de erro.

Os PDFs respeitam `--ids`, a ordem das cartas no JSON e a quantidade de cópias em `quantity`. Eles são montados apenas com os arquivos gerados na execução atual. Se houver erro em uma carta ou ID solicitado, o PDF não é recriado. Para imprimir, selecione **tamanho real / escala de 100%**, sem ajustar à página.

## Saída organizada por tipo

`--out <pasta>` define a pasta-base. Sem `--out`, a saída continua em `out/`. Se você passar apenas `--out`, sem caminho, o gerador usa `out/<nome do JSON>/`, preservando espaços e maiúsculas e removendo a extensão `.json`:

```sh
node build.mjs cards/Fluffusion.json --trim --text --pdf --out
# Saída: out/Fluffusion/trim/, out/Fluffusion/text/ e out/Fluffusion/pdf/
```

`--out` sem valor também pode vir antes de outra opção, como `--out --trim`. Coloque o JSON antes de `--out`, pois um caminho logo após essa opção é interpretado como a pasta de saída. Se houver vários JSONs no comando, a pasta automática será `out/deck/`, mantendo os arquivos reunidos.

O gerador cria automaticamente as subpastas necessárias:

```text
out/fluffusion/
  trim/   PNGs das cartas com --trim
  bleed/  PNGs das cartas sem --trim
  text/   PNGs das descrições separadas
  bg_text/ PNGs da região inferior completa, com fundo
  pdf/    PDFs das cartas e das descrições
  html/   HTML de depuração com --save-html
```

```sh
node build.mjs cards/Fluffusion.json --dpi 600 --trim --rounded --text --pdf --out out/fluffusion
```

Nesse exemplo, as cartas vão para `out/fluffusion/trim/`, as descrições para `out/fluffusion/text/` e os dois PDFs para `out/fluffusion/pdf/`. Os nomes dos arquivos continuam indicando trim/bleed e DPI. O PDF usa os PNGs das novas pastas. Arquivos de execuções anteriores permanecem onde estavam; a organização vale para as novas exportações.
