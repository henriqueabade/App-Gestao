/**
 * Padrão de tamanho dos botões principais, dos campos e das letras
 * (src/styles/controles.css — regra em docs/padrao-visual-controles.md).
 *
 * O dono escolheu o padrão em 21/09/2026 (Financeiro, Calendário, Tarefas e
 * os modais de Tarefas) e a passagem é MÓDULO A MÓDULO, com os modais de cada
 * um. Este teste:
 *
 *  - trava os valores do padrão: mudar um número tem de ser decisão, não
 *    efeito colateral;
 *  - garante que a folha é carregada por último entre as globais;
 *  - para cada tela já padronizada (lista PADRONIZADOS), confere que os
 *    botões principais e os campos usam as classes do padrão e que nenhum
 *    voltou a ter o tamanho antigo. Tela nova na lista = módulo aprovado.
 *
 * Etiquetas e botões em forma de etiqueta (status, DANFE, "Hoje/Amanhã",
 * períodos, marcadores) ficam de fora de propósito: o dono pediu que não
 * mudassem.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..');
const ler = rel => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MENU = ler('html/menu.html');
const CONTROLES = ler('styles/controles.css');

/**
 * Telas já no padrão, na ordem do menu. Cada entrada lista o HTML da tela e
 * de TODOS os modais dela (inclusive os abertos de dentro de outro modal).
 * Modal montado em JavaScript entra com o teste próprio do módulo.
 */
const PADRONIZADOS = [
  {
    // 22/09/2026 — o primeiro, a pedido do dono (o mais significativo).
    // Datas (de Pedidos) e Transportadora (de Clientes) abrem de dentro dele.
    modulo: 'orcamentos',
    arquivos: [
      'html/orcamentos.html',
      'html/modals/orcamentos/novo.html',
      'html/modals/orcamentos/editar.html',
      'html/modals/orcamentos/visualizar.html',
      'html/modals/orcamentos/converter.html',
      'html/modals/orcamentos/substituir-peca.html',
      'html/modals/pedidos/datas.html',
      'html/modals/clientes/transportadora.html'
    ]
  },
  // 22/09/2026. Sem modais próprios: o "Meu dia" é das Tarefas (referência)
  // e os itens das listas abrem os outros módulos.
  { modulo: 'dashboard', arquivos: ['html/dashboard.html'] },
  {
    // 22/09/2026. Todos os modais são da pasta dele (os de categoria,
    // unidade e processo abrem de dentro do Novo/Editar; dependência e
    // ordem duplicada, de dentro deles).
    modulo: 'materia-prima',
    arquivos: ['html/materia-prima.html', ...[
      'novo', 'editar', 'excluir', 'movimentos', 'duplicado', 'dependencia',
      'categoria-novo', 'categoria-excluir', 'unidade-novo', 'unidade-excluir',
      'processo-novo', 'processo-excluir', 'processo-ordem'
    ].map(m => `html/modals/materia-prima/${m}.html`)]
  },
  {
    // 22/09/2026. Os de coleção, desenhista, regra de produção e próxima
    // etapa abrem de dentro do Novo/Editar; o de estoque e o de excluir lote,
    // de dentro do Detalhe de estoque. O "Não é possível excluir" é o de
    // Matéria-prima (já na lista acima).
    modulo: 'produtos',
    arquivos: ['html/produtos.html', ...[
      'novo', 'editar', 'visualizar', 'detalhes', 'excluir', 'excluir-lote', 'movimentos',
      'estoque-inserir', 'estoque-somar', 'proxima-etapa', 'regra-producao',
      'colecao-novo', 'colecao-excluir', 'desenhista-novo', 'desenhista-excluir'
    ].map(m => `html/modals/produtos/${m}.html`)]
  },
  {
    // 22/09/2026. Do Visualizar abrem Cancelar NF-e, E-mail, Carta de
    // correção, Boletos (→ Detalhe do boleto), Devolução e Cancelar pedido;
    // do Pagamento, o Datas (já na lista de Orçamentos). A conversão em lote
    // reusa os modais de Orçamentos.
    modulo: 'pedidos',
    arquivos: ['html/pedidos.html', ...[
      'visualizar', 'pagamento', 'emitir-nfe', 'relatorio-producao', 'converter-orcamentos',
      'cancelar', 'cancelar-nfe', 'carta-correcao-nfe', 'enviar-nfe-email',
      'gerar-boletos', 'boleto-detalhe', 'devolucao'
    ].map(m => `html/modals/pedidos/${m}.html`)]
  },
  {
    // 22/09/2026. Novo contato abre de dentro do Novo/Editar; a
    // Transportadora já está na lista de Orçamentos. Na ficha: a linha do
    // tempo (HistoricoSocial, teste próprio abaixo) e as tarefas (referência).
    modulo: 'clientes',
    arquivos: ['html/clientes.html', ...['detalhes', 'novo', 'editar', 'excluir', 'contato']
      .map(m => `html/modals/clientes/${m}.html`)]
  },
  {
    // 22/09/2026. Do Detalhes abrem as ações (interação, nota, campanha,
    // próximo passo, mover no funil, responsável, converter, contato,
    // excluir); o Concluir passo abre também pelas Tarefas.
    modulo: 'prospeccoes',
    arquivos: ['html/prospeccoes.html', ...[
      'detalhes', 'novo', 'editar', 'excluir', 'contato', 'interacao', 'nota', 'campanha',
      'proximo-passo', 'concluir-passo', 'etapa', 'responsavel', 'converter'
    ].map(m => `html/modals/prospeccoes/${m}.html`)]
  },
];

/** Botão principal = <button> com uma classe de cor btn-*. */
const COR_DE_BOTAO = /\bbtn-(primary|secondary|neutral|danger|warning|success|bb|bordo|purple|dark-green|regra-producao|preco-tabela|devolucao|ghost|violet|dark-blue)\b/;
/** Classes de tamanho que o padrão substitui num botão ou campo. */
const TAMANHO_ANTIGO = /(^|\s)(text-(base|lg|xl)|py-3|py-4|px-6|px-8|h-12|h-14)(?=\s|$)/;

function problemasDoPadrao(html) {
  const problemas = [];
  // Comentário não conta ("<!-- floating para <select> -->" não é um campo).
  const semComentario = html.replace(/<!--[\s\S]*?-->/g, '');
  const tags = semComentario.match(/<(button|select|input|textarea)\b[^>]*>/g) || [];
  for (const tag of tags) {
    const classe = (tag.match(/\bclass="([^"]*)"/) || [])[1] || '';
    const tipo = (tag.match(/\btype="([^"]*)"/) || [])[1] || '';
    if (tag.startsWith('<button')) {
      if (!COR_DE_BOTAO.test(classe)) continue; // ícone de linha, aba, etiqueta
      // Ícone embutido no campo (o "−"/"+" dentro do select de Matéria-prima):
      // fica do tamanho dele, como os ícones das linhas.
      if (/\bicon-only\b/.test(classe) && /\btop-1\/2\b/.test(classe)) continue;
      if (!/\bctl-botao\b/.test(classe)) problemas.push(`botão sem ctl-botao: ${tag}`);
      if (TAMANHO_ANTIGO.test(classe)) problemas.push(`botão com tamanho antigo: ${tag}`);
    } else {
      if (['hidden', 'checkbox', 'radio', 'file', 'range', 'color'].includes(tipo)) continue;
      if (/\bsr-only\b/.test(classe)) continue;
      if (/\baria-hidden="true"/.test(tag)) continue; // campo invisível que só abre o calendário
      if (!/\bctl-campo\b/.test(classe)) problemas.push(`campo sem ctl-campo: ${tag}`);
      if (TAMANHO_ANTIGO.test(classe)) problemas.push(`campo com tamanho antigo: ${tag}`);
    }
  }
  return problemas;
}

test('controles.css entra por último entre as folhas globais do menu', () => {
  const pos = href => MENU.indexOf(`href="../styles/${href}"`);
  const controles = pos('controles.css');
  assert.ok(controles > 0, 'menu.html não carrega controles.css');
  for (const antes of ['tailwind-offline.css', 'utilitarios.css', 'scroll.css', 'tabelas-modais.css', 'tarefas-ui.css']) {
    assert.ok(pos(antes) > 0 && pos(antes) < controles, `${antes} tem de vir antes de controles.css`);
  }
  // Recorte a partir do href do controles.css: a tag dele já ficou para trás.
  const depois = MENU.slice(controles).match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || [];
  assert.deepStrictEqual(depois, [], 'nenhuma folha global depois de controles.css');
});

test('os valores do padrão são os aprovados', () => {
  const valor = nome => (CONTROLES.match(new RegExp(`${nome}:\\s*([^;]+);`)) || [])[1]?.trim();
  const esperado = {
    '--ctl-altura': '2.5rem',
    '--ctl-altura-pequena': '2rem',
    '--ctl-pad-x': '1.1rem',
    '--ctl-fonte': '0.875rem',
    '--ctl-peso': '600',
    '--ctl-raio': '0.7rem',
    '--ctl-espaco-entre': '0.6rem',
    '--ctl-campo-altura': '2.5rem',
    '--ctl-campo-fonte': '0.875rem',
    '--txt-rotulo': '0.8125rem',
    '--txt-secao': '0.7rem',
    '--txt-modal-titulo': '1.125rem',
    '--txt-tabela': 'clamp(0.75rem, 0.7rem + 0.2vw, 0.875rem)',
    '--txt-tabela-cabecalho': 'clamp(0.68rem, 0.64rem + 0.15vw, 0.75rem)'
  };
  for (const [nome, v] of Object.entries(esperado)) assert.strictEqual(valor(nome), v, nome);
});

test('as classes do padrão existem', () => {
  for (const classe of ['ctl-botao', 'ctl-botao--pequeno', 'ctl-botao--icone', 'ctl-acoes', 'ctl-campo', 'ctl-rotulo', 'ctl-secao', 'ctl-modal-titulo', 'ctl-padrao']) {
    assert.ok(new RegExp(`\\.${classe}\\b`).test(CONTROLES), `.${classe} não está em controles.css`);
  }
});

test('o conferidor acusa botão e campo fora do padrão e aceita os que estão nele', () => {
  const fora = [
    '<button class="btn-primary text-white rounded-md px-6 py-3 font-medium">Novo</button>',
    '<button class="btn-primary ctl-botao text-lg">Novo</button>',
    '<select class="input-glass text-white rounded-md px-4 py-3 w-full"></select>',
    '<input type="text" class="input-glass ctl-campo py-3">'
  ];
  for (const html of fora) assert.ok(problemasDoPadrao(html).length > 0, html);

  const dentro = [
    '<button class="btn-primary ctl-botao text-white">Novo</button>',
    '<button class="btn-neutral ctl-botao ctl-botao--icone" aria-label="Buscar"></button>',
    '<button class="status-tag px-6 py-3">Enviado</button>', // etiqueta: fora do padrão
    '<select class="input-glass ctl-campo w-full"></select>',
    '<input type="checkbox" class="h-4 w-4">',
    '<input type="hidden" id="x">'
  ];
  for (const html of dentro) assert.deepStrictEqual(problemasDoPadrao(html), [], html);
});

/**
 * O que o módulo monta em JavaScript: toda classe com cor de botão (btn-*)
 * tem de ter ctl-botao. `ignorar` lista, com o motivo, o que fica de fora
 * de propósito (ícone de linha de tabela, etiqueta).
 */
const JS_PADRONIZADOS = [
  {
    modulo: 'orcamentos',
    arquivos: [
      'js/orcamentos.js',
      'js/modals/orcamento-novo.js',
      'js/modals/orcamento-editar.js',
      'js/modals/orcamento-visualizar.js',
      'js/modals/orcamento-substituir-peca.js',
      'js/utils/parcelamento.js',
      'js/utils/date-range-filter.js'
    ],
    ignorar: []
  },
  {
    modulo: 'produtos',
    arquivos: ['js/produtos.js', 'js/modals/produto-proxima-etapa.js', 'js/modals/produto-proxima-etapa-novo.js'],
    ignorar: []
  },
  {
    modulo: 'pedidos',
    arquivos: [
      'js/pedidos.js',
      'js/modals/pedido-cancelar.js',
      'js/modals/pedido-pagamento.js',
      'js/modals/pedido-carta-correcao-nfe.js',
      'js/modals/pedido-devolucao.js',
      'js/modals/pedido-gerar-boletos.js'
    ],
    // "Detalhes" e "PDF" dentro das linhas da tabela de boletos: ação de
    // linha (20 px), como os ícones das linhas — fica fora do padrão.
    // "Selecionar este pedido" na realocação é um <span> dentro de um cartão
    // clicável (o cartão é o botão): etiqueta, fica.
    ignorar: [/\bpy-0\.5\b/, /^btn-primary px-3 py-1 rounded text-xs$/]
  },
  {
    modulo: 'clientes',
    arquivos: ['js/clientes.js', 'js/modals/cliente-editar.js', 'js/modals/cliente-novo.js', 'js/modals/cliente-detalhes.js'],
    ignorar: []
  },
  {
    modulo: 'orcamentos (converter)',
    arquivos: ['js/modals/orcamento-converter.js'],
    // o botão de ícone de cada linha da tabela de peças: fica fora do padrão
    ignorar: [/\bw-8 h-8\b/]
  }
];

function botoesJsForaDoPadrao(js, ignorar) {
  const classes = [
    ...[...js.matchAll(/class="([^"]*)"/g)].map(m => m[1]),
    ...[...js.matchAll(/className\s*=\s*'([^']*)'/g)].map(m => m[1])
  ];
  return classes.filter(c => COR_DE_BOTAO.test(c)
    && !/\bctl-botao\b/.test(c) && !ignorar.some(re => re.test(c)));
}

for (const { modulo, arquivos, ignorar } of JS_PADRONIZADOS) {
  test(`${modulo}: botões montados em JavaScript no padrão`, () => {
    for (const rel of arquivos) assert.deepStrictEqual(botoesJsForaDoPadrao(ler(rel), ignorar), [], rel);
  });
}

/**
 * A folha do módulo carrega DEPOIS de controles.css: uma regra dela que
 * fixe tamanho num botão padronizado venceria o padrão em silêncio.
 */
function regrasComTamanho(css, classe) {
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const achadas = [];
  for (const m of semComentario.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const seletores = m[1].split(',').map(s => s.trim());
    // só a regra do próprio botão (não a do ícone dentro dele, nem o :hover)
    if (!seletores.some(s => s === classe)) continue;
    if (/(^|;|\s)(padding|font-size|height|border-radius|gap)\s*:/.test(m[2])) achadas.push(`${m[1].trim()} { … }`);
  }
  return achadas;
}

test('dashboard: o "Atualizar" do cartão com erro é o botão pequeno do padrão', () => {
  const js = ler('js/dashboard.js');
  assert.match(js, /criarEl\('button', 'dash-botao-leve ctl-botao ctl-botao--pequeno'\)/);
  const css = ler('css/dashboard.css');
  for (const classe of ['.dash-botao-leve', '.dash-botao-atualizar']) {
    assert.deepStrictEqual(regrasComTamanho(css, classe), [], `${classe} não pode fixar tamanho em dashboard.css`);
  }
});

test('linha do tempo (Clientes e Prospecções): o botão é o pequeno do padrão', () => {
  const css = ler('styles/historico-social.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const regra = (css.match(/\.hs-botao\s*\{([^}]*)\}/) || [])[1] || '';
  assert.match(regra, /height:\s*var\(--ctl-altura-pequena/);
  assert.match(regra, /font-size:\s*var\(--ctl-fonte-pequena/);
  assert.match(regra, /border-radius:\s*var\(--ctl-raio/);
});

for (const folha of ['css/materia-prima.css', 'css/prospeccoes.css']) {
  test(`${folha}: a folha não prende mais os controles do filtro em 48 px`, () => {
    const css = ler(folha).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.filter-bar\s+(input|select|button)/.test(m[1])) {
        assert.doesNotMatch(m[2], /\bheight\s*:/, `${m[1].trim()} não pode fixar altura`);
      }
    }
  });
}

test('seletor de estados/cidades (Prospecções e Relatórios): botões e busca no padrão', () => {
  const js = ler('js/utils/geo-multiselect.js');
  assert.match(js, /cancelBtn\.className = 'geo-multiselect-btn cancel ctl-botao'/);
  assert.match(js, /confirmBtn\.className = 'geo-multiselect-btn confirm ctl-botao'/);
  assert.match(js, /searchInput\.className = 'ctl-campo'/);
  for (const folha of ['css/prospeccoes.css', 'css/relatorios.css']) {
    const css = ler(folha).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of [/\.geo-multiselect-btn\s*\{([^}]*)\}/, /\.geo-multiselect-search input\s*\{([^}]*)\}/]) {
      const corpo = (css.match(sel) || [])[1] || '';
      assert.doesNotMatch(corpo, /(padding|border-radius|font-size|height)\s*:/, `${folha}: ${sel} não pode fixar tamanho`);
    }
  }
});

for (const { modulo, arquivos } of PADRONIZADOS) {
  test(`${modulo}: botões principais e campos no padrão (tela e modais)`, () => {
    for (const rel of arquivos) {
      const html = ler(rel);
      assert.deepStrictEqual(problemasDoPadrao(html), [], rel);
      assert.ok(/\bctl-padrao\b/.test(html), `${rel}: a raiz precisa de ctl-padrao (letras das tabelas)`);
    }
  });
}
