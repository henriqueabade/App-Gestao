/**
 * Módulo Contabilidade — base (28/09/2026): o item do menu logo abaixo do
 * Financeiro, as permissões nos três lugares (catálogo, SQL, tela de
 * permissões), a tela (src/js/contabilidade.js) e os três modais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const TELA = ler('js', 'contabilidade.js');
const HTML = ler('html', 'contabilidade.html');
const CATALOGO = require('../../../backend/permissionsCatalog').PERMISSIONS_CATALOG;
const plano = v => JSON.parse(JSON.stringify(v));

function puras() {
  const inicio = TELA.indexOf('const CTB_NIVEIS');
  const fim = TELA.indexOf('// ------------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'bloco de funções puras não encontrado');
  return vm.runInContext(`${TELA.slice(inicio, fim)}\n({ ctbFiltrarPendencias, ctbContagem, ctbTextoSituacao, ctbFormatarData, ctbFormatarInstante, ctbFormatarQuando, ctbEscapar })`, vm.createContext({}));
}

const PENDENCIAS = [
  { nivel: 'critico', chave: 'a', fonte: 'nfe_saida', ignorada: false },
  { nivel: 'documental', chave: 'b', fonte: 'nfe_saida', ignorada: false },
  { nivel: 'documental', chave: 'c', fonte: 'recebimentos', ignorada: true },
  { nivel: 'aviso', chave: 'd', fonte: 'fechamentos', ignorada: false }
];

test('menu: Contabilidade entra logo abaixo do Financeiro, com rótulo e página próprios', () => {
  const MENU = ler('html', 'menu.html');
  const fin = MENU.indexOf('data-page="financeiro"');
  const ctb = MENU.indexOf('data-page="contabilidade"');
  const rel = MENU.indexOf('data-page="relatorios"');
  assert.ok(fin > 0 && ctb > fin && rel > ctb, 'Financeiro → Contabilidade → Relatórios');
  assert.match(ler('js', 'menu.js'), /contabilidade: 'Contabilidade'/);
  assert.match(ler('..', 'backend', 'server.js'), /app\.use\('\/api\/contabilidade', require\('\.\/contabilidadeController'\)\)/);
});

test('permissões: o módulo está no catálogo, na tela de permissões e no SQL, com as mesmas chaves', () => {
  const mod = CATALOGO.contabilidade;
  assert.ok(mod, 'módulo contabilidade no catálogo');
  assert.equal(mod.page, 'contabilidade');
  assert.equal(mod.table, 'perm_contabilidade');
  assert.deepEqual(mod.actions.map(a => a.key), ['contabilidade.view', 'contabilidade.fechar', 'contabilidade.reabrir', 'contabilidade.pendencia.resolver', 'contabilidade.pacote.gerar', 'contabilidade.config.view']);
  const PERMISSOES = ler('html', 'modals', 'usuarios', 'permissoes.html');
  assert.ok(PERMISSOES.includes('data-permission-tab-trigger="contabilidade"') && PERMISSOES.includes('data-module-toggle="contabilidade"'));
  for (const a of mod.actions) assert.ok(PERMISSOES.includes(`name="${a.key}"`), `${a.key} não está em permissoes.html`);
  const SQL = fs.readFileSync(path.join(RAIZ, '..', 'sql', 'contabilidade_base.sql'), 'utf8');
  assert.ok(SQL.includes('CREATE TABLE IF NOT EXISTS perm_contabilidade'));
  for (const a of mod.actions) assert.ok(SQL.includes(a.column), `${a.column} não está no SQL`);
  for (const t of ['competencia_contabil', 'contabil_pendencias_resolucoes', 'contabil_eventos']) assert.ok(SQL.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
  // A tabela de permissão tem a chave no perfil, como as outras (PUT /api/perm_x/<modelo_id>).
  assert.match(SQL, /perm_contabilidade \(\s*modelo_id\s+integer PRIMARY KEY/);
});

test('tela: toda permissão usada existe no catálogo; Fechar (verde), Reabrir (bordô, escondido), Gerar pacote (azul claro) e Atualizar (dourado) no cabeçalho', () => {
  const chaves = new Set(CATALOGO.contabilidade.actions.map(a => a.key));
  for (const m of HTML.matchAll(/data-perm(?:-hide)?="([^"]+)"/g)) assert.ok(chaves.has(m[1]), `${m[1]} não está no catálogo`);
  for (const m of TELA.matchAll(/dataset\.perm = '([^']+)'/g)) assert.ok(chaves.has(m[1]), `${m[1]} (JS) não está no catálogo`);
  assert.match(HTML, /id="ctbFechar"[^>]*data-perm="contabilidade.fechar"[^>]*class="btn-success ctl-botao"/);
  assert.match(HTML, /id="ctbReabrir"[^>]*data-perm="contabilidade.reabrir"[^>]*class="btn-warning ctl-botao text-white hidden"/);
  assert.match(HTML, /id="ctbPacote"[^>]*data-perm="contabilidade.pacote.gerar"[^>]*class="btn-secondary ctl-botao text-white"/);
  assert.match(HTML, /id="ctbAtualizar"[^>]*class="btn-primary ctl-botao text-white"/);
  // O seletor de competência é o da casa (src/js/utils/competencia.js).
  for (const attr of ['data-competencia-mes', 'data-competencia-ano', 'data-competencia-ir', 'id="ctbCompetencia"']) assert.ok(HTML.includes(attr), attr);
  // As três severidades do dono, cada uma com o que bloqueia.
  assert.ok(HTML.includes('Bloqueiam o fechamento da competência') && HTML.includes('Bloqueiam o pacote e o envio à contabilidade') && HTML.includes('Não bloqueiam nada'));
  assert.equal((HTML.match(/data-ctb-lista="/g) || []).length, 3, 'fontes, pendências e atividade');
});

test('funções puras: filtro por severidade/fonte/ignoradas, a contagem e o texto da situação', () => {
  const f = puras();
  const chaves = lista => plano(lista).map(p => p.chave);
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(PENDENCIAS, {})), ['a', 'b', 'd'], 'sem filtro, as ignoradas não aparecem');
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(PENDENCIAS, { nivel: 'documental' })), ['b']);
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(PENDENCIAS, { nivel: 'ignoradas' })), ['c']);
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(PENDENCIAS, { fonte: 'nfe_saida' })), ['a', 'b']);
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(PENDENCIAS, { nivel: 'ignoradas', fonte: 'nfe_saida' })), []);
  assert.deepEqual(chaves(f.ctbFiltrarPendencias(null, {})), []);
  assert.deepEqual(plano(f.ctbContagem(PENDENCIAS)), { critico: 1, documental: 1, aviso: 1, ignoradas: 1, total: 4 });

  assert.deepEqual(plano(f.ctbTextoSituacao({ situacao: { status: 'fechada', fechada_em: '2026-09-25T15:30:00-03:00', fechada_por: 'Henrique', divergencias: 1 } })),
    { status: 'fechada', rotulo: 'Fechada', detalhe: 'Fechada em 25/09/2026 às 15:30 por Henrique · 1 erro crítico novo desde o fechamento' });
  assert.deepEqual(plano(f.ctbTextoSituacao({ situacao: { status: 'reaberta', reaberta_em: '2026-09-26T12:00:00-03:00', reaberta_por: 'Henrique', justificativa_reabertura: 'Nota atrasada' } })),
    { status: 'reaberta', rotulo: 'Reaberta', detalhe: 'Reaberta em 26/09/2026 às 12:00 por Henrique — Nota atrasada' });
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'aberta' }, encerrada: false }).detalhe, 'O mês ainda está em curso: fecha depois do último dia.');
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'aberta' }, encerrada: true, pode: { fechar: true } }).detalhe, 'Sem erro crítico: a competência pode ser fechada.');
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'aberta' }, encerrada: true, pode: { fechar: false }, bloqueios: { fechar: ['2 erros críticos a resolver.'] } }).detalhe, '2 erros críticos a resolver.');
  assert.equal(f.ctbTextoSituacao(null).status, 'aberta');

  assert.equal(f.ctbFormatarData('2026-08-31'), '31/08/2026');
  assert.equal(f.ctbFormatarQuando('2026-09-28T10:05:00-03:00', '2026-09-28'), '10:05');
  assert.equal(f.ctbFormatarQuando('2026-09-27T10:05:00-03:00', '2026-09-28'), '27/09');
  assert.equal(f.ctbEscapar('<b>&'), '&lt;b&gt;&amp;');
});

test('modais: Fechar, Reabrir e Ignorar pendência têm a anatomia da casa e pedem a permissão certa', () => {
  const esperado = {
    'fechar': { overlay: 'ctbFecharOverlay', perm: 'contabilidade.fechar', principal: 'btn-success', botao: 'Confirmar fechamento' },
    'reabrir': { overlay: 'ctbReabrirOverlay', perm: 'contabilidade.reabrir', principal: 'btn-warning', botao: 'Reabrir competência' },
    'ignorar-pendencia': { overlay: 'ctbIgnorarPendenciaOverlay', perm: 'contabilidade.pendencia.resolver', principal: 'btn-primary', botao: 'Ignorar pendência' }
  };
  for (const [nome, e] of Object.entries(esperado)) {
    const html = ler('html', 'modals', 'contabilidade', `${nome}.html`);
    assert.ok(html.includes(`id="${e.overlay}" data-ctb-modal`), `${nome}: overlay`);
    assert.ok(html.includes('ctl-padrao') && html.includes('ctl-modal-titulo') && html.includes('class="btn-neutral ctl-botao text-white justify-self-start">← Voltar'), `${nome}: cabeçalho`);
    assert.match(html, /<button type="button" data-ctb-fechar class="btn-danger ctl-botao text-white min-w-\[120px\]">Cancelar<\/button>/, `${nome}: Cancelar vermelho`);
    assert.ok(html.includes(`data-perm="${e.perm}"`), `${nome}: permissão`);
    assert.ok(new RegExp(`data-perm="${e.perm}" class="${e.principal} ctl-botao[^"]*">${e.botao}<`).test(html), `${nome}: botão principal ${e.principal}`);
  }
  assert.ok(ler('html', 'modals', 'contabilidade', 'reabrir.html').includes('id="ctbReabrirJustificativa"'));
  assert.ok(ler('html', 'modals', 'contabilidade', 'ignorar-pendencia.html').includes('id="ctbIgnorarJustificativa"'));
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  for (const overlay of ['ctbFechar', 'ctbReabrir', 'ctbIgnorarPendencia']) assert.ok(MODAIS.includes(`${overlay}:`), `${overlay} sem montador`);
  assert.ok(MODAIS.includes("fetchApi('/api/contabilidade/fechar'") && MODAIS.includes("fetchApi('/api/contabilidade/reabrir'") && MODAIS.includes("fetchApi('/api/contabilidade/pendencias/ignorar'"));
  // A tela sabe abrir os três e relê o painel quando fecham.
  for (const chave of ['fechar', 'reabrir', 'ignorar-pendencia']) assert.ok(TELA.includes(`'${chave}': { html: 'modals/contabilidade/${chave}.html'`), chave);
  assert.ok(MODAIS.includes('window.ContabilidadeRecarregar?.()') && TELA.includes('window.ContabilidadeRecarregar = '));
});

test('tela: os botões montados em JavaScript (Financeiro, Ignorar, Restaurar) são o botão pequeno do padrão e a pendência do Financeiro abre o módulo', () => {
  const botoes = [...TELA.matchAll(/ctbCriar\('button', '([^']*)'/g)].map(m => m[1]);
  assert.equal(botoes.length, 3);
  for (const classe of botoes) assert.match(classe, /\bctl-botao ctl-botao--pequeno\b/);
  assert.ok(TELA.includes("await window.loadPage('financeiro')"));
  assert.ok(TELA.includes("'ir-financeiro'") && TELA.includes("'restaurar'") && TELA.includes("'ignorar'"));
});
