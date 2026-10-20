/**
 * Prospecções, pedidos do dono de 20/10/2026:
 *   - etapa nova "Móveis": 0% e etiqueta roxa (o backend está em
 *     backend/prospeccoesController.test.js; o banco, em
 *     sql/prospeccoes_etapa_moveis.sql);
 *   - Ações Rápidas › "Excluir em Lote", só o Sup Admin: tabela com caixa de
 *     seleção, filtros simples, motivo e confirmação digitando EXCLUIR.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('Móveis: primeira etapa, 0%, nas listas de reserva dos modais', () => {
  const form = ler('js/modals/prospeccao-form-comum.js');
  assert.match(form, /'Móveis': 0,\s*'Novo': 10,/);
  assert.match(form, /const ETAPAS_PADRAO = \[\s*'Móveis', 'Novo',/);
  const acoes = ler('js/modals/prospeccao-acoes-comum.js');
  assert.ok(acoes.includes("'Móveis': 0, 'Novo': 10,"));
  assert.ok(acoes.includes("ETAPAS_PADRAO: ['Móveis', 'Novo',"));
});

test('Móveis: etiqueta e barra do funil roxas, diferentes do lilás de Proposta', () => {
  const css = ler('css/prospeccoes.css');
  const etiqueta = /\.badge-etapa--moveis \{([^}]*)\}/.exec(css)?.[1] || '';
  assert.match(etiqueta, /rgba\(168, 85, 247/);
  assert.match(css, /\.funil-barra--moveis\s+\{ background: #a855f7; \}/);
  // A classe sai do nome da etapa sem acento: "Móveis" -> "moveis".
  const slug = 'Móveis'.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  assert.strictEqual(slug, 'moveis');
});

test('Excluir em Lote no menu: nasce escondido, sem data-perm, e só o Sup Admin o vê', () => {
  const html = ler('html/prospeccoes.html');
  const item = /<button id="btnExcluirLoteProspeccoes"[^>]*>/.exec(html)?.[0] || '';
  assert.match(item, /\shidden>$/);
  assert.ok(!/data-perm/.test(item), 'quem tem só pros.delete não vê');
  assert.ok(html.indexOf('btnExcluirLoteProspeccoes') > html.indexOf('btnEmailMassaProspeccoes'), 'último item do menu');
  assert.match(ler('styles/acoes-csv.css'), /\.acoes-rapidas__item\[hidden\], \.acoes-rapidas__separador\[hidden\] \{ display: none; \}/);
  const js = ler('js/prospeccoes.js');
  assert.match(js, /function mostrarExcluirLote\(\) \{\s*const supAdmin = Boolean\(window\.Permissoes\?\.supAdmin\);/);
  assert.match(js, /window\.addEventListener\('permissoes:carregadas', mostrarExcluirLote\);/);
  assert.match(js, /function abrirExcluirLote\(\) \{\s*if \(!window\.Permissoes\?\.supAdmin\) return null;\s*return openModalWithSpinner\('modals\/prospeccoes\/excluir-lote\.html', '\.\.\/js\/modals\/prospeccao-excluir-lote\.js', 'excluirLoteProspeccoes'\);/);
});

test('o modal: Voltar em cima, filtros simples, caixa de seleção na 1ª coluna, motivo e Voltar/Excluir embaixo', () => {
  const html = ler('html/modals/prospeccoes/excluir-lote.html');
  assert.match(html, /<div id="excluirLoteProspeccoesOverlay" class="hidden fixed inset-0/);
  assert.ok(html.indexOf('voltarExcluirLoteProspeccoes') < html.indexOf('<table'), 'Voltar no topo');
  for (const id of ['buscaExcluirLoteProspeccoes', 'etapaExcluirLoteProspeccoes', 'responsavelExcluirLoteProspeccoes', 'motivoExcluirLoteProspeccoes']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const cabecalho = /<thead>([\s\S]*?)<\/thead>/.exec(html)[1];
  assert.ok(cabecalho.indexOf('selecionarTodasExcluirLoteProspeccoes') < cabecalho.indexOf('Empresa'), 'a caixa vem primeiro');
  const rodape = /<footer[\s\S]*?<\/footer>/.exec(html)[0];
  assert.match(rodape, /id="cancelarExcluirLoteProspeccoes" type="button" class="btn-neutral ctl-botao text-white">Voltar</);
  assert.match(rodape, /id="confirmarExcluirLoteProspeccoes" type="button" class="btn-danger ctl-botao text-white"/);
});

test('o script: confirma digitando EXCLUIR, manda motivo e palavra ao servidor e nunca monta HTML com dados', () => {
  const js = ler('js/modals/prospeccao-excluir-lote.js');
  assert.ok(!/innerHTML/.test(js), 'nome, CNPJ e responsável por textContent');
  assert.match(js, /exigirTexto: PALAVRA/);
  assert.match(js, /confirmVariant: 'danger'/);
  assert.match(js, /fetchApi\('\/api\/prospeccoes\/excluir-lote', \{[\s\S]*?body: JSON\.stringify\(\{ ids: parte\.map\(Number\), motivo, confirmacao: PALAVRA \}\)/);
  assert.match(js, /fetchApi\('\/api\/prospeccoes\/lista\?incluirArquivadas=1'\)/);
  assert.match(js, /const podeExcluir = p => !p\?\.cliente_id;/, 'convertida aparece travada');
  assert.match(js, /if \(!motivo\) \{\s*showToast\('Escreva o motivo da exclusão\.', 'error'\);/);
  assert.match(js, /window\.dispatchEvent\(new CustomEvent\('modalSpinnerLoaded', \{ detail: overlayId \}\)\);/);
});

test('enquanto exclui: véu na tela inteira com o andamento, em partes de 10, e o modal não fecha', () => {
  const js = ler('js/modals/prospeccao-excluir-lote.js');
  assert.match(js, /await window\.BotaoAcao\.comCarregamento\(tarefa, `Excluindo prospecções… 0 de \$\{ids\.length\}`\)/);
  assert.match(js, /const PARTE = 10;/);
  assert.match(js, /for \(let i = 0; i < ids\.length; i \+= PARTE\) \{\s*avisarAndamento\(`Excluindo prospecções… \$\{Math\.min\(i, ids\.length\)\} de \$\{ids\.length\}`\);/);
  assert.match(js, /document\.querySelector\('#botaoAcaoVeu \.botaoAcaoVeu-texto'\)/, 'o texto do véu do BotaoAcao');
  assert.match(js, /const close = \(\) => \{ if \(!excluindo\) Modal\.close\(overlayId\); \};/, 'Voltar não fecha no meio');
  assert.match(js, /if \(evento\.key !== 'Escape' \|\| excluindo \|\|/, 'Esc também não');
  assert.match(js, /excluindo = true;\s*try \{[\s\S]*?\} finally \{\s*excluindo = false;\s*\}/);
  // A lista da tela atrás é recarregada ainda debaixo do véu.
  const tarefa = js.slice(js.indexOf('const tarefa = async () => {'), js.indexOf('excluindo = true;'));
  assert.ok(tarefa.includes("avisarAndamento('Atualizando a lista…');") && tarefa.includes('await recarregar(true)'));
  // O véu fica acima de qualquer modal (z-index 3000 > 2000 dos modais levantados).
  assert.match(ler('utils/botaoAcao.js'), /#botaoAcaoVeu \{\s*position: fixed;\s*inset: 0;\s*z-index: 3000;/);
});
