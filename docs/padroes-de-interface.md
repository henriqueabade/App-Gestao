# Padrões de interface: números, diálogos, botões e telas

Utilitários globais, carregados em `src/html/menu.html` (e os aplicáveis em
`src/login/login.html`), resolvem de uma vez regras que antes eram repetidas — ou
esquecidas — em cada módulo. Os três primeiros funcionam por conta própria: **não
é preciso chamar nada em um módulo novo**, basta seguir o padrão de marcação.

| Utilitário | Arquivo | O que resolve |
| --- | --- | --- |
| `NumericInput`  | `src/utils/numericInput.js`  | Todo campo numérico aceita até 4 casas decimais e sempre guarda `.` |
| `DialogTopLayer`| `src/utils/dialogTopLayer.js` | Toda caixa de diálogo fica à frente de qualquer outro elemento |
| `BotaoAcao`     | `src/utils/botaoAcao.js`      | Nenhum botão aceita duplo clique; fica carregando até a ação terminar |
| `AtualizacaoObrigatoria` | `src/utils/atualizacaoObrigatoria.js` | Versão atrasada não usa o app: caixa sem saída, um botão só |

---

## 1. Campos numéricos (`NumericInput`)

**Regra:** todo preenchimento numérico aceita até **4 casas decimais**. Na
digitação, tanto `,` quanto `.` valem como separador decimal, e o campo guarda
sempre **um único `.`**. Vale para quantidades, preços e porcentagens.

### Como marcar o campo

```html
<!-- Já é reconhecido automaticamente -->
<input name="quantidade" type="number" min="0">

<!-- Campo de texto que deve se comportar como numérico -->
<input name="fator" type="text" data-numeric="true">
```

O utilitário troca `type="number"` por `type="text" inputmode="decimal"`. Isso é
proposital: no Chromium um `input[type=number]` **descarta o próprio conteúdo**
quando o usuário digita `,` (o `value` volta vazio), então era impossível
"converter a vírgula em ponto" — o caractere nunca chegava ao JavaScript. Com
texto controlado a conversão acontece a cada tecla, e `parseFloat` continua
funcionando porque o campo só contém dígitos e ponto.

Como `min`/`max` deixam de ser validados pelo navegador, eles são guardados em
`data-numeric-min` / `data-numeric-max` e reaplicados no `blur`.

### Ajustes por campo

| Atributo | Efeito |
| --- | --- |
| `data-numeric="true"`      | Trata um `input[type=text]` como numérico |
| `data-numeric="false"`     | Deixa o campo de fora |
| `data-numeric-decimals="2"`| Muda o limite de casas decimais |
| `data-numeric-negative="true"` | Permite valor negativo |

Campos que parecem numéricos mas não são decimais (hoje só `#ncmInput`) estão na
lista `IGNORED_IDS` do próprio utilitário.

### API

```js
window.NumericInput.sanitize('1,2345');  // '1.2345'
window.NumericInput.parse('1,5');        // 1.5   (NaN se vazio/inválido)
window.NumericInput.format(0.0025);      // '0.0025'  (até 4 casas, sem zeros à direita)
```

Use `NumericInput.format` para exibir quantidades — foi o que substituiu os
`toFixed(2)` que apagavam valores pequenos (`0,0025` virava `0,00`).

### No back-end

`backend/numeros.js` faz a última conversão antes de gravar. O front já manda
com ponto, mas se qualquer outro caminho (importação, API externa, versão antiga
do app) mandar `"1,5"` ou `"1.234,56"`, `paraDecimal` normaliza:

```js
const { paraDecimal, normalizarCamposNumericos } = require('./numeros');
normalizarCamposNumericos(dados, ['quantidade', 'preco_unitario']);
```

Já aplicado em `backend/materiaPrima.js` (quantidade, preço, entradas/saídas) e
`backend/produtos.js` (percentuais, preços, quantidades de itens e lotes).

---

## 2. Caixas de diálogo (`DialogTopLayer`)

**Regra:** uma caixa de diálogo — de aviso, de escolha ou com campo para digitar
— fica **sempre à frente** de qualquer outro elemento.

### Como marcar

Basta a classe semântica `app-message-overlay` (ou `warning-overlay`, que já a
implica pelo CSS de `src/styles/warning.css`):

```js
const overlay = document.createElement('div');
overlay.className = 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4';
overlay.innerHTML = '...';
document.body.appendChild(overlay);   // promovido automaticamente
```

### Por que não bastava z-index

Os diálogos conviviam em dois mundos: `DialogPadrao` usa
`<dialog>.showModal()`, que entra na **top layer** do navegador; os diálogos
montados à mão eram `<div>` com `z-index: var(--z-dialog)`. Um z-index, por alto
que seja, **nunca** passa por cima da top layer — então qualquer diálogo montado
à mão que abrisse junto de um `DialogPadrao` ficava escondido atrás dele e sem
receber clique, porque `showModal()` deixa o resto do documento inerte.

Agora existe um mecanismo só: cada overlay marcado é embrulhado num `<dialog>`
hospedeiro invisível e promovido para a top layer. A regra fica simples — **o
último diálogo aberto fica na frente** — e nenhum modal, menu ou toast consegue
cobri-lo. O elemento continua sendo o mesmo nó, então `querySelector`,
`getElementById` e `remove()` do código que criou o diálogo seguem valendo;
quando ele sai do DOM, o hospedeiro se fecha e se remove sozinho.

`data-sem-top-layer="true"` deixa um overlay de fora (útil para spinners, que não
levam a classe de diálogo justamente por isso).

### Clicar fora NÃO fecha — não reintroduza

Modal e caixa de mensagem só fecham por **botão** (Fechar/Voltar/Cancelar) ou
**Esc**. O padrão abaixo foi removido de todo o app a pedido do usuário: fechar
sem querer, no meio de um preenchimento longo, custava o trabalho inteiro.

```js
// NÃO faça isto:
overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
```

Ao criar um modal novo, garanta que exista pelo menos um botão de fechar — é a
única saída além do Esc.

Cuidado ao ler o código: `overlay.addEventListener('mousedown', warn, true)` em
`cliente-detalhes` **não** é clicar-para-fechar; é o aviso de campo somente
leitura. Deve continuar existindo.

---

## 3. Botões (`BotaoAcao`)

**Regra:** nenhum botão pode ser acionado duas vezes enquanto a ação anterior não
terminar, e o botão acionado fica carregando até a função dele concluir.

### Rede automática

Não é preciso fazer nada por módulo. Dois listeners em fase de **captura** em
`document` (`click` e `submit`) cobrem:

- `<button>`, `[role="button"]`, `input[type=submit|button]`, `[data-acao="true"]`;
- os ícones que fazem papel de botão nas tabelas — o padrão do projeto
  `<i class="fas fa-* cursor-pointer">` (editar, excluir, visualizar);
- `submit` de formulário, inclusive por **Enter**, que não passa por clique nenhum.

Para saber quando liberar, as promessas de `window.electronAPI` e de `fetch`
criadas durante o acionamento são rastreadas: enquanto houver chamada pendente o
botão continua carregando. Ação instantânea (abrir menu, marcar filtro) só fica
bloqueada pela janela mínima de 350 ms e **não** mostra spinner — o spinner
aparece apenas quando a ação de fato vai ao back-end.

O atributo `disabled` de propósito **não** é usado: o bloqueio vem do listener em
captura (Enter e Espaço também disparam `click`), e mexer em `disabled`
atropelaria os módulos que gerenciam esse atributo por conta própria durante a
ação. Elementos negados por permissão (`data-perm-aplicado="negado"`) são
ignorados, porque já têm o bloqueio do `permissoes.js`.

### Ajustes por botão

| Atributo | Efeito |
| --- | --- |
| `data-sem-loading="true"` | Mantém a trava de duplo clique, mas nunca aplica o spinner. Use quando o botão tem indicador próprio dentro dele (ex.: barra de progresso da publicação) |
| `data-sem-guarda="true"`  | Desliga a trava e o visual |

### O rastreio segue a ação inteira

A trava **não** é um tempo fixo: ela dura enquanto houver chamada pendente,
mesmo quando o `fetch` está numa função auxiliar que o handler nem aguarda —
o padrão de `salvarNovoServico`, por exemplo:

```js
botao.addEventListener('click', () => { salvarDados(); });   // sem await
```

O rastreador continua ativo enquanto novas promessas nascerem, então o `fetch`
disparado lá dentro (mesmo depois de um `await getApiBaseUrl()`) entra na conta.
Coberto por `src/js/__tests__/botaoAcao.test.js`.

### API explícita

Para quando o módulo sabe exatamente o que esperar (I/O que não passa por
`electronAPI` nem `fetch`, ou espera longa):

```js
window.BotaoAcao.bind(botao, async () => { await algo(); });
window.BotaoAcao.bindSubmit(form, async () => { await salvar(); });
await window.BotaoAcao.run(botao, () => tarefa());
```

`bind`/`bindSubmit` marcam o elemento com `data-acao-gerida="true"`, e a rede
automática passa a não mexer nele.

---

## 4. Atualização obrigatória (`AtualizacaoObrigatoria`)

**Regra:** se a versão instalada estiver **abaixo** da disponível — qualquer
diferença, já que `0.0.1` é o menor passo possível — o usuário entra
normalmente, mas encontra uma caixa **acima de tudo, que não fecha**, com um
único botão: *Atualizar*.

### Por que ela não fecha

É um `<dialog>` com `showModal()`: além de entrar na *top layer* (acima de
qualquer z-index), ela deixa **o resto do documento inerte**. Sobre isso:

- não existe botão de fechar, cancelar ou voltar — só o *Atualizar*;
- o evento `cancel` é cancelado, então **Esc não fecha**;
- `showModal()` não fecha por clique no fundo;
- se algum código chamar `close()`, a caixa **se reabre sozinha**.

### Quem decide, e quando

A decisão fica no `AppUpdates` (`src/js/menu.js`), em `getForcedUpdateTarget()`,
e é reavaliada a cada status novo e ao definir o perfil do usuário. Ela exige
atualizar quando, **ao mesmo tempo**:

1. já houve login (`state.user` definido);
2. o status é `update-available` ou `downloaded` — ou seja, existe pacote;
3. `compareSemanticVersions(local, disponível) === -1`;
4. `electronAPI.downloadUpdate`/`installUpdate` existem.

As condições 2 e 4 não são detalhe: **prender alguém numa caixa sem saída para
uma atualização que não pode ser baixada travaria o app**. Publicação do Sup
Admin em andamento também adia a caixa, que volta a ser avaliada no status
seguinte.

### O botão

Passa por `BotaoAcao.bind`, então herda a trava de duplo clique e o visual de
carregando. Quem baixa e instala é `applyUpdateNow()` — **o mesmo caminho** do
"Aplicar atualização" do menu, extraído justamente para não existirem duas
implementações que possam divergir. Se falhar, a caixa mostra o erro e o botão
volta como *Tentar novamente*; ela continua sem saída.

Coberto por `src/js/__tests__/atualizacaoObrigatoria.test.js`.

---

## 5. Telas e modais: o que vale em todo lugar

### Classe do Tailwind que não existe não faz nada

O Tailwind do app é **pré-compilado** (`src/styles/tailwind-offline.css`):
classe que não estava no arquivo na hora da compilação não existe, e o
navegador a ignora em silêncio. Era daí que vinham títulos colados na linha
(`mt-5`, `pt-5`), grades que não abriam (`md:grid-cols-4`) e a Carta de
correção ocupando a tela inteira (`max-w-xl`).

- As que faltavam estão em `src/styles/utilitarios.css`, carregado **logo
  depois** do `tailwind-offline.css` no `menu.html` (as variantes responsivas
  precisam vir depois das classes base).
- Só contam as folhas que o `menu.html` carrega. A folha de um módulo
  (`src/css/<modulo>.css`) só existe enquanto ele está aberto: classe definida
  só lá não funciona em modal aberto de outro lugar.
- `src/js/__tests__/padroesDeTela.test.js` varre todos os HTML e JS atrás de
  classes de espaço e tamanho sem CSS e **falha dizendo quais são**. Classe
  nova que falhar ali: acrescente em `utilitarios.css` com o valor do Tailwind
  (1 unidade = 0,25rem; quebras sm 640, md 768, lg 1024, xl 1280).

### Tamanho dos botões, dos campos e das letras

Um padrão só para o programa inteiro — botão principal de 40 px com letra de
14 px, campo de 40 px, tabela com letra de 14/12 px — em
`src/styles/controles.css`, com as classes `ctl-*`. Regra completa, o que
fica de fora (etiquetas!) e a fila dos módulos em
`docs/padrao-visual-controles.md`.

### Cores dos botões

| Botão | Classe |
| --- | --- |
| Fechar / Cancelar do rodapé | `btn-danger` (vermelho) |
| Voltar (cabeçalho) | `btn-neutral` |
| Ação principal (Salvar, Registrar, Atualizar do módulo) | `btn-primary` (dourado) |
| Confirmar, "Tudo" / "Tudo pronto" | `btn-success` (verde) |
| "Nada" (desfaz a escolha) | `btn-danger` (vermelho) |
| Tudo o que fala com o Banco do Brasil (Conciliar BB, Consultar no BB, Testar conexão BB) | `btn-bb` (azul escuro, global em `menu.css`) |
| Consulta dentro do app (Ver relatório, Ver itens, Atualizar de uma lista) | `btn-secondary` (azul claro) |

Exceção: numa confirmação de **exclusão**, o vermelho é o "Excluir"; o
Cancelar ao lado fica neutro, para não haver dois vermelhos. O teste acima
confere o Fechar/Cancelar de todos os modais em `src/html/modals` e o
`btn-bb` de todo botão com "BB" no texto.

### Caixas de aviso e de confirmação

Toda caixa (aviso, erro, sucesso, confirmação) é o `DialogPadrao`
(`src/components/dialogPadrao.js` + `src/styles/dialogo-padrao.css`, ver
`docs/dialog-padrao.md`). Nada de caixa montada à mão só com título e
parágrafo, nem `alert()` do sistema. Caixa com muita informação vai
**estruturada**: `resumo` (cartões de número), `secoes` (com `itens`
rótulo → valor ou `lista`), `alerta` (o que não tem volta) e `nota`. Caixa
antiga que só manda `message` é organizada sozinha (linhas "Rótulo: valor",
listas com "•", o "não tem volta" no quadro vermelho). Coberto por
`src/js/__tests__/dialogPadrao.test.js`.

### Modal que abre outro por cima

`Modal.open(html, script, id)` fecha **todos** os modais abertos antes de abrir
o novo. Modal aberto a partir de outro (Carta de correção, Cancelar NF-e,
E-mail, Boletos, Devolução a partir do Visualizar pedido) passa o quarto
argumento, `keepExisting = true`, para o de baixo continuar aberto. No
Visualizar pedido isso fica em `abrirPorCima()`, que também relê o pedido
quando o filho muda alguma coisa (nota cancelada, boleto gerado…). O Esc só
fecha o modal de cima.

### Barra de rolagem: uma só, em todo lugar

Toda área que rola usa a barra fina e dourada (6 px, sem trilho): a regra
`:where(*)::-webkit-scrollbar` de `src/styles/scroll.css` (seção 3d) vale
para o programa inteiro com especificidade zero — qualquer regra de uma tela
(`.scrollbar-hide`…) continua valendo por cima. Área que rola uma tabela
ganha o dourado cheio. **Não escreva barra de rolagem nova numa tela.**

### Caixas de seleção

A lista aberta de um `<select>` é a padrão do programa: fundo branco, texto
preto (`select option` em scroll.css). **Não pinte `option`** numa folha de
módulo — fundo escuro com o texto preto do padrão deixa a lista ilegível.

### Tabelas em modal (só modal — as telas principais não mudam)

Toda tabela de modal tem **o mesmo formato**, de uma regra só
(`src/styles/tabelas-modais.css`, alcançada por `[id$="Overlay"]`, inclusive
tabela montada em JavaScript): **a própria tabela é a moldura** — cantos de
12 px, borda fina, corpo **transparente** (o vidro do modal aparece por trás
das linhas) —, cabeçalho na faixa clara com título cinza em caixa alta e
divisória entre as linhas. **Sem realce ao passar o mouse** (decisão do dono,
18/09/2026: nas faixas de processo dos itens do produto ele apagava a faixa);
não ponha `hover:bg-*` em linha de tabela de modal. As
medidas (letra e espaçamento, que acompanham a largura da tela) são as de
`.table-scroll`, em `src/styles/scroll.css` seção 3e. O que só embrulhava a
tabela (vidro, borda, sombra, legenda "Itens da nota" dentro da moldura)
fica neutro; seções com título e totais ("Peças", "ITENS") continuam.

Ficam de fora: as **telas principais** (as listas dos módulos têm o padrão
delas) e as **folhas de relatório** (`.rp-tabela`, que imitam o papel
impresso). As grades de edição (itens de orçamento/pedido, revisão da IA)
uniformizam o cabeçalho e a moldura; as células, que são campos, mantêm a
medida própria. **Não desenhe moldura nem cabeçalho de tabela num modal.**

### Etiquetas de resumo acima da lista (uma linha só)

Os totais em etiqueta das telas principais (Prospecções, Matéria-prima,
Clientes, Laminação, IA, Contatos) ficam num contêiner `tags-uma-linha`
(`src/styles/utilitarios.css`): **uma linha, altura fixa**. A etiqueta que
não cabe some inteira — nunca quebra para uma segunda linha (a seção de
filtros mudava de altura) nem passa por cima do vizinho — e volta sozinha
quando sobra espaço (menu lateral recolhido, janela maior). É só CSS: nada a
recalcular em JS. Contêiner novo de etiquetas de resumo usa a mesma classe.

### Tabela da tela principal cabe na tela

Nos módulos de "título, filtros e tabela" o módulo não rola: quem rola é a
tabela (`MODULES_WITHOUT_SCROLL` em `src/js/menu.js` + a lista de
`#content.no-scroll .table-scroll` em `src/styles/scroll.css`). Pedidos,
Orçamentos e Produtos usam a conta fixa `altura do módulo − 260px`.
Clientes (19/09/2026) usa o jeito que não depende da altura dos filtros: o
módulo vira coluna flexível e a tabela ocupa **o que sobra**
(`src/css/clientes.css`) — com o menu aberto ou numa janela menor os filtros
quebram em duas linhas e a conta fixa deixava as últimas linhas fora da
tela. Módulo novo nesse formato: prefira o jeito de Clientes.

### Menu lateral: o conteúdo desliza, não recalcula

Abrir/recolher o menu muda a margem do `#mainContent` **de uma vez** e o
deslize visível é um `transform` (`deslizarConteudo()` em `src/js/menu.js`).
Animar a própria margem (`transition-all` no `<main>`, como era) recalcula o
módulo inteiro a cada quadro e travava as telas de lista longa. **Não ponha
`transition` de margem, largura ou `all` no `#mainContent`.**

### O vidro dos modais e das caixas

Todo modal e toda caixa de diálogo usam **o mesmo vidro**: o da caixa
"Confirmar exclusão" de Pedidos, escolhida pelo dono como padrão em
19/09/2026 — `glass-surface backdrop-blur-xl rounded-3xl border
border-white/10 ring-1 ring-white/5 shadow-2xl`, sobre o véu `bg-black/50`
(sem desfoque no véu). É branco a 8% com desfoque de 24 px: transparente,
deixando ver o que está atrás.

- `DialogPadrao` (`.dlg-cartao`, `src/styles/dialogo-padrao.css`): esse vidro;
  as caixas de erro/exclusão ganham a moldura vermelha
  (`border-red-500/20 ring-red-500/30`). Nem degradê nem bordô escuro — os
  dois foram tentados e recusados em 18/09.
- Modais de Tarefas e Calendário (`.tui-cartao`, `src/styles/tarefas-ui.css`):
  o mesmo vidro e os degraus de tamanho do padrão — grande 72rem
  (`max-w-6xl`), pequeno 48rem (`max-w-3xl`), altura até 90vh; o editor, que
  tem abas, com altura fixa. O rodapé é só a linha de cima, sem faixa escura.
  **Os botões desses modais ainda não foram mexidos**: ficam para a rodada dos
  botões de módulos e modais, quando o dono pedir.

### `.hidden` e a folha do módulo

A folha de um módulo carrega **depois** do Tailwind. Classe dela com
`display` próprio (`display: flex`, `block`, `grid`) empata com o `.hidden`
em especificidade e **ganha por ordem**: o elemento continua na tela. Foi
assim que a barra de resumo da revisão da IA ficava vazia em cima da tabela.
Toda classe de módulo com `display` que convive com `hidden` precisa do par
`.classe.hidden { display: none; }` (lista em `src/css/ia.css`; no Financeiro,
`[class*="fin-"].hidden`).

### Rolagem das tabelas

`src/js/utils/rolagem-encadeada.js` (um ouvinte só, instalado pelo menu):

- mouse **em cima** da tabela: a roda rola a tabela; quando ela chega no
  limite, passa a rolar o modal ou o módulo;
- mouse **fora** da tabela: a roda rola o modal ou o módulo; quando ele chega
  no limite, passa a rolar a tabela da tela mais perto do mouse.

Conta como tabela com rolagem própria: `.table-scroll`, `.fin-tabela`,
`.items-table-scroll`, `[data-rolagem-tabela]` ou qualquer elemento que role
e tenha uma `<table>` como filha direta. A barra de rolagem dentro dos modais é
a fina dourada de `src/styles/scroll.css` (seção 3c) — inclusive nas caixas da
`DialogPadrao`, que são `<dialog>` nativo e por isso entram pelo seletor `dialog`,
não por `[role="dialog"]`. Coberto por
`src/js/__tests__/rolagemEncadeada.test.js`.

### Carregamento

Modal que lê o servidor antes de mostrar alguma coisa **não aparece vazio**:
fica o spinner da casa (`.app-loading-indicator` com a logo) por no mínimo 1 s
e o modal aparece já preenchido. No Financeiro, `finSpinnerDoModal()`
(`src/js/financeiro.js`) põe o spinner e `window.FinanceiroModalPronto()` o
troca pelo modal quando a primeira leitura termina (no máximo 15 s). Trocar um
filtro dentro do modal mostra uma linha com o mesmo spinner no lugar da tabela.

### Modais com abas

Tamanho fixo, o da Nova prospecção: `max-w-6xl` (72rem) × `h-[90vh]`, em
coluna (`flex flex-col overflow-hidden`), com só o corpo rolando. Assim trocar
de aba não muda o tamanho do modal.

### Balões de informação (i)

Sempre pelo `window.Popover` (`src/js/utils/popover.js`), que leva o balão
para o `<body>` e o posiciona junto do ícone. Balão posicionado à mão dentro
de um módulo com `transform` ou `backdrop-filter` vai parar longe do (i).

### Menu "Ações Rápidas" e planilhas

O botão bordô com a lista (Clientes, Prospecções) é um só:
`window.AcoesCsv.ligarMenu({ container, botao, menu })` e as classes
`acoes-rapidas*` (`src/styles/acoes-csv.css`, global). Exportar, importar e o
modelo CSV passam por `AcoesCsv.exportar/importar/salvarModelo`, que abrem o
relatório "Resultado da importação". Detalhes em
`docs/historico-social-e-planilhas.md`.

### Linha do tempo com curtidas e comentários

Histórico de ficha é `window.HistoricoSocial.montar(alvo, { origem, registroId, descrever })`
(`src/js/utils/historico-social.js`): o módulo só diz como descrever cada
evento. Nova origem entra em `ORIGENS` de `backend/historicoSocial.js`.

### Tarefas em qualquer tela

Linha de tarefa, editor, "Concluir", criação rápida e a caixa de tarefas de
uma ficha são do `window.TarefasUI` (`src/js/utils/tarefas-ui.js` +
`src/styles/tarefas-ui.css`, globais). Numa ficha:
`TarefasUI.montarTarefasDaFicha(alvo, { tipo: 'cliente' | 'prospeccao', id, nome })`.
Não recrie o editor num módulo: abra com `TarefasUI.abrirEditor({ id })` ou
`abrirEditor({ preset })`. Regras e rotas em `docs/tarefas-e-calendario.md`.
