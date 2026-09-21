# Padrão visual dos controles — botões, campos e letras

Decisão do dono em 21/09/2026, branch `Padronização-Visual-Controles`.

Alguns módulos tinham botões e letras bem maiores que outros (Pedidos,
Orçamentos, Produtos, Matéria-prima, IA e os modais deles). O padrão é o dos
módulos que o dono escolheu como referência — **Financeiro, Calendário e
Tarefas**, e os **modais de Tarefas** (editor da tarefa, Estatísticas):
botões menores, letra de 14 px, peso 600, "elegantes e mais sofisticados".

As medidas moram em **`src/styles/controles.css`** (global, a última folha do
`menu.html`). Nenhuma tela muda sozinha: cada uma passa para o padrão na sua
vez, trocando as classes de tamanho pelas do padrão. O teste
`src/js/__tests__/padraoControles.test.js` trava os valores e confere cada
tela já passada.

---

## 1. O que entra e o que NÃO entra

**Entra** — o que o dono pediu: tamanho e espaçamento dos **botões
principais** e o tamanho das **letras dos textos**.

- botões de ação do cabeçalho do módulo (Novo…, Converter…, Exportar,
  Configurar, Ações Rápidas);
- botões da barra de filtros (Filtrar, Limpar) e os campos ao lado deles
  (select, busca), que precisam da mesma altura para ficar alinhados;
- botões do cabeçalho e do rodapé dos modais (Voltar, Cancelar, Salvar,
  Registrar, Excluir…);
- campos dos formulários dos modais, rótulos, títulos de seção, título do
  modal;
- a letra das tabelas (módulo e modal).

**Não entra — não mexer:**

- **etiquetas e botões em forma de etiqueta**: status (Enviado, Aprovado…),
  DANFE / CC-e / S/NF, atalhos em pílula ("Hoje / Amanhã / Próx. seg"),
  períodos ("7 dias / 30 dias"), marcadores (#vip), filtros em pílula;
- os ícones de ação nas linhas das tabelas (olho, lápis, lixeira…);
- **cores** — continuam nas classes `btn-*` de cada módulo;
- o menu lateral e a barra de cima (são do programa inteiro, iguais em toda
  tela).

---

## 2. As medidas

| Item | Padrão | Antes (módulos grandes) | De onde veio |
| --- | --- | --- | --- |
| Botão principal — altura | **40 px** (`2.5rem`) | 48 px no cabeçalho, 44 px no filtro, 40 px nos modais | Tarefas/Calendário 40,8 · modais de Tarefas 37,4 |
| Botão — letra / peso | **14 px** (`0.875rem`) / **600** | 16 px / 500 | Tarefas 14,4 / 600 · Financeiro 14 / 500 |
| Botão — texto até a borda | **17,6 px** (`1.1rem`) | 24 px | Tarefas/Calendário |
| Botão — cantos | **11,2 px** (`0.7rem`) | 6 px (tela), 8 px (modal) | Tarefas/Calendário · modais 10,4 |
| Ícone ↔ texto / entre botões | **7,2 px** / **9,6 px** (`0.45rem` / `0.6rem`) | 8 px / 12–16 px | Tarefas/Calendário |
| Botão de barra (pequeno) | **32 px**, letra **13 px** | — | Mês/Semana do Calendário 32,7 |
| Botão só com ícone | quadrado de **40 px** (ou 32 px na barra) | 44 px | — |
| Campo / select — altura | **40 px** | 46–50 px | editor de tarefa 37,8 |
| Campo — letra / cantos | **14 px** / **9,6 px** (`0.6rem`) | 16 px / 6–8 px | editor de tarefa 13,6 / 9,6 |
| Rótulo de campo | **13 px**, peso 500 | 14–16 px | — |
| Título de seção (caixa alta) | **11,2 px**, peso 700 | — | "DESCRIÇÃO", "QUANDO" do editor |
| Título do modal | **18 px**, peso 600 | 18 px (já igual) | Estatísticas 17,6 |
| Título de seção NA TELA (cartão da tela, não do modal) | **16,8 px**, peso 600 (`ctl-secao-tela`) | 18 px / 500 ("Ações Rápidas" de Contatos) | "Contas a receber" do Financeiro, "Precisa de atenção" do Dashboard |
| Título / subtítulo do módulo | 24 px / 16 px | 24 px / 16 px (já iguais) | todos |
| Tabela — linhas | **14 px** (encolhe em tela pequena) | 15,2 px | Estatísticas 13,3 |
| Tabela — cabeçalho (caixa alta) | **12 px** | 15,2 px | Estatísticas 11,5 |

As alturas das linhas e o espaço dentro das células das tabelas **não**
mudam — só a letra.

**Financeiro:** o módulo é referência, mas os botões do cabeçalho dele têm
44 px, peso 500 e cantos de 6 px (os de Tarefas e Calendário têm 40,8 px,
600 e 11,2 px). O padrão seguiu Tarefas/Calendário, que também são o desenho
dos modais de referência — **aprovado pelo dono em 22/09**, junto com os
campos e a letra das tabelas dentro do padrão. Na vez do Financeiro, ele
encosta nesses números. Mudar cantos ou peso depois é **uma variável** em
`controles.css`, e vale para tudo.

---

## 3. As classes

| Onde | Classe | Substitui |
| --- | --- | --- |
| Botão principal | `ctl-botao` + a cor (`btn-primary`…) | `px-* py-* text-sm/base/lg rounded-md font-medium`, o `w-4 h-4 mr-2` do ícone |
| Botão de barra | `ctl-botao ctl-botao--pequeno` | idem |
| Botão só com ícone | `ctl-botao ctl-botao--icone` | `p-2`, `w-10 h-10`… |
| Grupo de botões | `ctl-acoes` | `flex gap-4`, `space-x-3`… |
| Campo / select / textarea | `ctl-campo` + o fundo (`input-glass`…) | `px-* py-* rounded-md` |
| Campo com ícone por cima à direita (a seta desenhada, o calendário) | `ctl-campo ctl-campo--icone` | o `pr-12` |
| Campo com DOIS botões de ícone embutidos (o "−" e o "+" de Matéria-prima) | `ctl-campo ctl-campo--dois-icones` | o `pr-12` (que deixava o texto passar por baixo do "−") |
| "✕" de fechar no canto do modal | `ctl-botao ctl-botao--pequeno ctl-botao--icone` | `icon-only` |
| Campo com texto fixo dentro: "R$" à esquerda / unidade à direita | `ctl-campo--prefixo` / `ctl-campo--sufixo` (e o texto fixo com `text-sm`) | `pl-10` / `pr-16` |
| Campo pequeno — número curto numa lista de valores (os percentuais do produto) | `ctl-campo ctl-campo--pequeno` (32 px, 13 px) | `px-3 py-1 text-sm` |
| Textarea com altura fixa (`h-28`…) | `rows="N"` com a mesma altura | o `h-*` (o padrão tira a altura fixa do textarea) |
| Rótulo flutuante (dentro do campo, sobe ao preencher) | fica o Tailwind: `left-4`→`left-3`, `text-base`→`text-sm`; **sai** o `peer-placeholder-shown:text-base` | — |
| Rótulo | `ctl-rotulo` | `block text-sm font-medium mb-2` |
| Título de seção | `ctl-secao` | — |
| Título do modal | `ctl-modal-titulo` | `text-lg`/`text-xl font-semibold` |
| Texto corrido / de apoio | `ctl-texto` / `ctl-apoio` | `text-base`, `text-sm` |
| Letras das tabelas | `ctl-padrao` na **raiz** (`.modulo-container` da tela ou o véu `…Overlay` do modal) | — |

Regras:

- **Nunca** `text-base`, `text-lg`, `py-3`, `px-6` em botão principal ou
  campo de tela já padronizada (o teste acusa).
- **Rótulo flutuante**: não crie `peer-placeholder-shown:text-sm` (nem outra
  variante nova em utilitarios.css). No Tailwind a variante de "vazio" perde
  para as de focado/válido/preenchido; escrita depois, em outra folha, ela
  passa a VENCER e o rótulo sobe sem diminuir (aconteceu em Orçamentos).
- **Barra de filtros**: botões e selects têm a mesma altura — alinhe pela
  base (`items-end`) e tire o empurrão que compensava a diferença
  (`#bt-actions { margin-top: 1vw }` e parecidos).
- Títulos de seção dentro do modal ("Itens", "Peças", "Parcelas") viram
  `ctl-secao`; o título do modal, `ctl-modal-titulo`.
- **Botão de ícone embutido no campo** (`icon-only` + `top-1/2`, como o
  "−/+" dentro do select) fica do tamanho dele — é ícone, não botão
  principal. O teste o ignora pela mesma marca.
- Regra da folha do módulo que prenda altura nos controles do filtro
  (`.filter-bar select, .filter-bar button { height: 48px }` em
  Matéria-prima) sai: ela carrega depois e venceria o padrão.
- Folha de relatório (`rp-*`, como a Auditoria do Insumo) imita o papel
  impresso e fica fora, como a `.rp-tabela`.
- **Cores de botão contam todas**: além de `btn-primary…`, as próprias de
  um módulo (`btn-regra-producao`, `btn-preco-tabela`, `btn-purple`,
  `btn-dark-green`) e botão com cor inline (`style="background:…"`, o
  "Gerar PDF" do produto). O levantamento pelas classes não enxerga o de cor
  inline — a varredura de textos grandes na tela (§6) acha.
- **Texto sem classe de tamanho herda 16 px**: nome de linha de lista
  ("Marcenaria"), valor de campo só de leitura ("Status"). Vai para
  `text-sm` (14 px). Valor em destaque (o total grande, o selo de preço)
  fica.
- Teste antigo que confira a classe EXATA de um botão (`px-6 py-3…`)
  quebra na troca: atualize a classe esperada para a do padrão, mantendo o
  que ele protege (posição, ordem, permissão).
- **`hidden` na frente continua na frente**: vários testes leem
  `class="hidden btn-…"` como "o botão nasce escondido". A troca não pode
  empurrar o `hidden` para depois do `ctl-botao`.
- **Botão com cara de campo** (`<button class="input-glass …">` que abre
  uma lista, como o "Todos os países" de Prospecções) é campo: `ctl-campo`.
- **Ação dentro da linha de tabela** ("Detalhes"/"PDF" na tabela de
  boletos) e etiqueta dentro de cartão clicável ficam do tamanho delas,
  como os ícones das linhas.
- A cor é da classe `btn-*`; o tamanho é do `ctl-botao`. Não escreva
  `padding`/`font-size` de botão na folha do módulo.
- Modal montado em JavaScript usa as mesmas classes no código que monta.
- Componentes globais que já seguem o padrão por conta própria
  (`TarefasUI`, `DialogPadrao`) não precisam das classes.

---

## 4. Como passar um módulo (a receita)

Quando o dono mandar o módulo:

1. **Levantar tudo que pertence a ele**: a tela (`src/html/<modulo>.html`),
   todos os modais em `src/html/modals/<modulo>/`, os modais montados em JS
   (`src/js/<modulo>.js`, `src/js/modals/…`) e **os modais abertos de dentro
   de outro modal** (ex.: Visualizar pedido → Carta de correção, Boletos,
   Devolução). Também os modais de outro módulo que ele abre.
2. **Medir antes** (página de medição do preview, ver §6) e anotar o que
   está fora.
3. **Trocar as classes** (tabela do §3). Etiquetas, pílulas e ícones de linha
   ficam como estão.
4. **Conferir a folha do módulo** (`src/css/<modulo>.css`): regra que fixe
   `padding`/`font-size`/altura de botão ou campo sai (é ela que venceria o
   padrão).
5. `ctl-padrao` na raiz da tela e de cada modal.
6. **Medir depois** e conferir que nada quebrou: textos que não cabem mais
   na linha, grades de filtro, alinhamento do filtro com os botões, modais
   com abas (tamanho fixo), estados de carregamento e de lista vazia.
7. Pôr o módulo na lista `PADRONIZADOS` de `padraoControles.test.js` e
   rodar a bateria.
8. Entregar a lista do que conferir na tela. O próximo módulo só começa
   depois do "ok" do dono.

---

## 5. A fila (ordem do menu)

| # | Módulo | Situação |
| --- | --- | --- |
| 1 | Dashboard | **feito em 22/09** — só o "Atualizar" do cabeçalho e o "Atualizar" do cartão com erro (botão pequeno); as letras dos cartões já estavam na faixa do Financeiro (medidas lado a lado) e ficaram. Sem modais próprios. **Aprovado pelo dono.** |
| 2 | Matéria-prima | **feito em 22/09** — tela e os 13 modais (Novo, Editar, Excluir, Auditoria, Duplicado, Dependência, categoria/unidade/processo novo e excluir, ordem duplicada). **Aprovado pelo dono.** |
| 3 | Produtos | **feito em 22/09** — tela e os 15 modais (Novo, Editar com o editor de preço, Visualizar, Detalhe de estoque, Adicionar ao estoque, Item já registrado, Excluir, Excluir lote, Movimentações, Próxima etapa e as 3 caixas dela, Regra produção, coleção e desenhista novo/excluir). **Aprovado pelo dono.** |
| 4 | Orçamentos | **feito em 22/09** — tela, Novo, Editar, Visualizar, Converter, Substituir peça, as caixas de confirmação feitas à mão, parcelamento e o balão de período (ambos compartilhados), e os modais de outros módulos que ele abre: Datas (Pedidos) e Transportadora (Clientes). **Aprovado pelo dono.** |
| 5 | Pedidos | **feito em 22/09** — tela e os 12 modais (Visualizar, Pagamento, Emitir NF-e, Relatório de produção, Converter orçamentos, Cancelar pedido com a realocação, Cancelar NF-e, Carta de correção, E-mail da NF-e, Boletos, Detalhe do boleto, Devolução); o Datas já tinha entrado com Orçamentos. **Aprovado pelo dono.** |
| 6 | CRM › Clientes | **feito em 22/09** — tela (com o "Ações Rápidas") e os 5 modais (Detalhes, Novo, Editar, Excluir, Novo contato); a Transportadora já tinha entrado com Orçamentos. O botão da linha do tempo (`.hs-botao`, compartilhado com Prospecções) passou para as medidas do botão pequeno. **Aprovado pelo dono.** |
| 7 | CRM › Prospecções | **feito em 22/09** — tela (filtros, filtros avançados com os falsos selects de país/estado, Funil) e os 13 modais (Detalhes, Novo, Editar, Excluir, Contato, Interação, Nota, Campanha, Próximo passo, Concluir passo, Mover no funil, Responsável, Converter). O seletor de estados/cidades (`geo-multiselect`, usado também em Relatórios) ficou no padrão nos dois módulos. O nome da pessoa e da empresa no topo do Detalhes e do Converter (24/20 px) ficou: é a identidade da ficha, como valor em destaque. **Aprovado pelo dono.** |
| 8 | CRM › Contatos | **feito em 22/09** — tela (cartão "Ações Rápidas" com os 4 botões, filtros); sem modais próprios. A folha tinha a regra de 48 px nos controles do filtro e o empurrão de 1vw: saíram. **Aprovado pelo dono.** |
| 9 | CRM › Calendário | **conferido em 22/09** (referência) — só os centésimos: cabeçalho de 40,8 → 40 px (`ctl-botao`), barra de 32,7–34,3 → 32 px (Mês/Semana, ícones, Hoje, agenda). Os modais (Atividade/Marco, Nova tarefa, Exportar e o editor) usam o TarefasUI, que passou para as medidas do padrão: `tui-botao` 37,4 → 40 px e `tui-campo` 37,8 → 40 px, letra 13,6 → 14 px (vale também para Tarefas e para as tarefas das fichas). **Aprovado pelo dono.** |
| 10 | CRM › Tarefas | **conferido em 22/09** (referência) — cabeçalho 40,8 → 40 px (`ctl-botao`); barra (busca, "De quem"/ordem, Lista/Quadro, atalhos) em 32 px; tarefa rápida com a letra do campo (15,2 → 14 px). Os modais já tinham entrado com o TarefasUI. Commitado direto (o dono liberou o commit automático em 22/09). |
| 11 | Laminação › Clientes | **feito em 22/09** — clone de Clientes: tela (com o cartão "Ações Rápidas" em `ctl-secao-tela`) e os 5 modais (Detalhes, Novo, Editar, Excluir, Novo contato). Commitado direto. |
| 12 | Laminação › Serviços | **feito em 22/09** — tela e o modal Novo serviço (com Peças e Dados do amarrado). O modal é montado em partes (véu vazio + `data-modal-dialog`/`data-modal-slot` encaixados pelo JS): para medir na prévia, encaixar o diálogo no véu antes. Commitado direto. |
| 13 | IA | a fazer — **próximo** |
| 14 | Usuários | a fazer |
| 15 | Financeiro | referência — alinhar a diferença do §2 e os modais |
| 16 | Relatórios | a fazer |
| 17 | Configurações | a fazer |
| — | Globais: caixa de diálogo (`DialogPadrao`) | conferir no fim — botões já com 14 px / 600, mas ~38 px de altura e cantos de 9,6 px. Entram junto os modais que usam o mesmo desenho (`dlg-rodape`): o resultado da importação de planilha (`AcoesCsv`) e o "Não é possível excluir"/"Insumo já cadastrado" de Matéria-prima |

Os modais do Financeiro **não** são referência: medidos em 21/09, estão no
tamanho grande (botões de 40 px com letra de 16 px, campos de 50 px).

---

## 6. Como medir

Com a tela (ou o modal) aberta no app, cole no console do DevTools. Sai uma
tabela com cada tipo de botão, campo, rótulo, título e célula visível:
altura, letra, peso, espaço interno e cantos. Janela de referência:
1536 × 864 (a tela do dono, 1920 × 1080 com escala de 125%).

```js
(() => {
  const raiz = document.querySelector('[id$="Overlay"]:not(.hidden)') || document.getElementById('content');
  const px = v => Math.round(parseFloat(v) * 10) / 10;
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const grupos = new Map();
  const reg = (tipo, e) => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    const m = { tipo, altura: px(r.height), letra: px(s.fontSize), peso: s.fontWeight,
      lados: px(s.paddingLeft), cantos: px(s.borderTopLeftRadius) };
    const k = JSON.stringify(m), g = grupos.get(k) || { ...m, qtd: 0, exemplo: '' };
    g.qtd++; g.exemplo ||= (e.innerText || e.placeholder || e.getAttribute('aria-label') || '').trim().slice(0, 30);
    grupos.set(k, g);
  };
  const tipos = { 'h1,h2,h3,h4': 'título', button: 'botão', select: 'select',
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea': 'campo', label: 'rótulo', th: 'th', td: 'td' };
  for (const [sel, tipo] of Object.entries(tipos)) raiz.querySelectorAll(sel).forEach(e => vis(e) && reg(tipo, e));
  console.table([...grupos.values()]);
})();
```

Textos acima de 14 px (acha nome de lista sem classe, herdando 16 px, e
botão com cor inline, que o levantamento pelas classes não vê). O que for
título do modal (18 px) ou valor em destaque fica:

```js
(() => {
  const raiz = document.querySelector('[id$="Overlay"]:not(.hidden)') || document.getElementById('content');
  const achados = new Map();
  raiz.querySelectorAll('*').forEach(e => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    const texto = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    const letra = parseFloat(getComputedStyle(e).fontSize);
    if (!texto || letra <= 14.5) return;
    const k = `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 3).join('.')} ${letra}px`;
    const g = achados.get(k) || { qtd: 0, exemplo: texto.slice(0, 30) }; g.qtd++; achados.set(k, g);
  });
  console.table([...achados].map(([k, g]) => ({ elemento: k, ...g })));
})();
```
