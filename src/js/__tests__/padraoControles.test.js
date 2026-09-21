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
  // { modulo: 'dashboard', arquivos: ['html/dashboard.html'] },
];

/** Botão principal = <button> com uma classe de cor btn-*. */
const COR_DE_BOTAO = /\bbtn-(primary|secondary|neutral|danger|warning|success|bb|bordo)\b/;
/** Classes de tamanho que o padrão substitui num botão ou campo. */
const TAMANHO_ANTIGO = /(^|\s)(text-(base|lg|xl)|py-3|py-4|px-6|px-8|h-12|h-14)(?=\s|$)/;

function problemasDoPadrao(html) {
  const problemas = [];
  const tags = html.match(/<(button|select|input|textarea)\b[^>]*>/g) || [];
  for (const tag of tags) {
    const classe = (tag.match(/\bclass="([^"]*)"/) || [])[1] || '';
    const tipo = (tag.match(/\btype="([^"]*)"/) || [])[1] || '';
    if (tag.startsWith('<button')) {
      if (!COR_DE_BOTAO.test(classe)) continue; // ícone de linha, aba, etiqueta
      if (!/\bctl-botao\b/.test(classe)) problemas.push(`botão sem ctl-botao: ${tag}`);
      if (TAMANHO_ANTIGO.test(classe)) problemas.push(`botão com tamanho antigo: ${tag}`);
    } else {
      if (['hidden', 'checkbox', 'radio', 'file', 'range', 'color'].includes(tipo)) continue;
      if (/\bsr-only\b/.test(classe)) continue;
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

for (const { modulo, arquivos } of PADRONIZADOS) {
  test(`${modulo}: botões principais e campos no padrão (tela e modais)`, () => {
    for (const rel of arquivos) {
      const html = ler(rel);
      assert.deepStrictEqual(problemasDoPadrao(html), [], rel);
      assert.ok(/\bctl-padrao\b/.test(html), `${rel}: a raiz precisa de ctl-padrao (letras das tabelas)`);
    }
  });
}
