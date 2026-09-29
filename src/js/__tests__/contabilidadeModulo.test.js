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

/**
 * O SQL de cada etapa, quando ainda está na pasta: `sql/` fica fora do git e
 * o dono apaga o arquivo depois de rodar. Sem ele, a conferência do SQL é
 * pulada (o catálogo e a tela de permissões continuam conferidos).
 */
function sqlDaEtapa(nome) {
  const caminho = path.join(RAIZ, '..', 'sql', nome);
  return fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null;
}

const ACOES_BASE = ['contabilidade.view', 'contabilidade.fechar', 'contabilidade.reabrir', 'contabilidade.pendencia.resolver', 'contabilidade.pacote.gerar', 'contabilidade.config.view'];
const ACOES_ETAPA3 = ['contabilidade.documento.registrar', 'contabilidade.documento.excluir', 'contabilidade.pagar.lancar', 'contabilidade.pagar.pagar', 'contabilidade.pagar.estornar'];
const ACOES_ETAPA4 = ['contabilidade.extrato.importar', 'contabilidade.contas.gerir'];
const ACOES_ETAPA5 = ['contabilidade.conciliar'];
const ACOES_ETAPA6 = ['contabilidade.classificar', 'contabilidade.plano.gerir'];

test('permissões: o módulo está no catálogo, na tela de permissões e no SQL de cada etapa, com as mesmas chaves', () => {
  const mod = CATALOGO.contabilidade;
  assert.ok(mod, 'módulo contabilidade no catálogo');
  assert.equal(mod.page, 'contabilidade');
  assert.equal(mod.table, 'perm_contabilidade');
  assert.deepEqual(mod.actions.map(a => a.key).sort(), [...ACOES_BASE, ...ACOES_ETAPA3, ...ACOES_ETAPA4, ...ACOES_ETAPA5, ...ACOES_ETAPA6].sort());
  const PERMISSOES = ler('html', 'modals', 'usuarios', 'permissoes.html');
  assert.ok(PERMISSOES.includes('data-permission-tab-trigger="contabilidade"') && PERMISSOES.includes('data-module-toggle="contabilidade"'));
  for (const a of mod.actions) assert.ok(PERMISSOES.includes(`name="${a.key}"`), `${a.key} não está em permissoes.html`);
  const coluna = chave => mod.actions.find(a => a.key === chave).column;
  const base = sqlDaEtapa('contabilidade_base.sql');
  if (base) {
    assert.ok(base.includes('CREATE TABLE IF NOT EXISTS perm_contabilidade'));
    for (const k of ACOES_BASE) assert.ok(base.includes(coluna(k)), `${coluna(k)} não está no SQL da base`);
    for (const t of ['competencia_contabil', 'contabil_pendencias_resolucoes', 'contabil_eventos']) assert.ok(base.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    // A tabela de permissão tem a chave no perfil, como as outras (PUT /api/perm_x/<modelo_id>).
    assert.match(base, /perm_contabilidade \(\s*modelo_id\s+integer PRIMARY KEY/);
  }
  const etapa3 = sqlDaEtapa('contabilidade_contas_pagar.sql');
  if (etapa3) {
    for (const k of ACOES_ETAPA3) assert.ok(etapa3.includes(`ADD COLUMN IF NOT EXISTS ${coluna(k)}`), `${coluna(k)} não está no SQL das contas a pagar`);
    const { TABELAS_PAGAR } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_PAGAR) assert.ok(etapa3.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    assert.ok(etapa3.includes('ADD COLUMN IF NOT EXISTS referencia_tipo'), 'a referência do histórico');
    assert.match(etapa3, /\n\s+especie\s+varchar\(20\)/, 'a espécie do documento (recibo, guia…)');
  }
  const etapa4 = sqlDaEtapa('contabilidade_extrato.sql');
  if (etapa4) {
    for (const k of ACOES_ETAPA4) assert.ok(etapa4.includes(`ADD COLUMN IF NOT EXISTS ${coluna(k)}`), `${coluna(k)} não está no SQL do extrato`);
    const { TABELAS_EXTRATO } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_EXTRATO) assert.ok(etapa4.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    assert.match(etapa4, /UNIQUE INDEX IF NOT EXISTS \w+\s+ON movimentos_bancarios \(conta_id, hash\)/, 'a identidade do lançamento não repete');
  }
  const etapa5 = sqlDaEtapa('contabilidade_conciliacao.sql');
  if (etapa5) {
    for (const k of ACOES_ETAPA5) assert.ok(etapa5.includes(`ADD COLUMN IF NOT EXISTS ${coluna(k)}`), `${coluna(k)} não está no SQL da conciliação`);
    const { TABELAS_CONCILIACAO } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_CONCILIACAO) assert.ok(etapa5.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    for (const col of ['conciliacao_diferenca', 'conciliacao_observacao', 'conciliado_em', 'conciliado_por']) assert.ok(etapa5.includes(`ADD COLUMN IF NOT EXISTS ${col}`), col);
    assert.match(etapa5, /conciliacao_vinculos \(movimento_id, alvo_tipo, alvo_id\) WHERE desfeito_em IS NULL/, 'um vínculo valendo por par');
  }
  const etapa6 = sqlDaEtapa('contabilidade_classificacao.sql');
  if (etapa6) {
    for (const k of ACOES_ETAPA6) assert.ok(etapa6.includes(`ADD COLUMN IF NOT EXISTS ${coluna(k)}`), `${coluna(k)} não está no SQL da classificação`);
    const { TABELAS_CLASSIFICACAO } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_CLASSIFICACAO) assert.ok(etapa6.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    // As quatro categorias do relatório da contabilidade entram no plano inicial.
    for (const n of ['Aquisição de Bens', 'Serviços de Terceiros', 'Impostos e Taxas', 'Aporte de Capital']) assert.ok(etapa6.includes(`('${n}',`), n);
    assert.match(etapa6, /classificacoes \(movimento_id\) WHERE substituida_em IS NULL/, 'uma classificação à mão valendo por lançamento');
  }
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
  assert.ok(MODAIS.includes("enviar('/api/contabilidade/fechar'") && MODAIS.includes("enviar('/api/contabilidade/reabrir'") && MODAIS.includes("enviar('/api/contabilidade/pendencias/ignorar'"));
  // A tela sabe abrir os três e relê o painel quando fecham.
  for (const chave of ['fechar', 'reabrir', 'ignorar-pendencia']) assert.ok(TELA.includes(`'${chave}': { html: 'modals/contabilidade/${chave}.html'`), chave);
  assert.ok(MODAIS.includes('window.ContabilidadeRecarregar?.()') && TELA.includes('window.ContabilidadeRecarregar = '));
});

test('tela: os botões montados em JavaScript (Abrir, Financeiro, Ignorar, Restaurar) são o botão pequeno do padrão; a pendência do Financeiro abre o módulo e a daqui abre o modal', () => {
  const botoes = [...TELA.matchAll(/ctbCriar\('button', '([^']*)'/g)].map(m => m[1]);
  assert.equal(botoes.length, 4);
  for (const classe of botoes) assert.match(classe, /\bctl-botao ctl-botao--pequeno\b/);
  assert.ok(TELA.includes("await window.loadPage('financeiro')"));
  assert.ok(TELA.includes("'ir-financeiro'") && TELA.includes("'restaurar'") && TELA.includes("'ignorar'") && TELA.includes("'abrir-pendencia'"));
});

// ------------------------------------------------------------- etapas 2 e 3

const MODAIS_ETAPA3 = {
  'contas-pagar': { overlay: 'ctbContasPagar', principal: ['ctbContasPagarNova', 'btn-primary', 'contabilidade.pagar.lancar'] },
  'conta-pagar': { overlay: 'ctbContaPagar', principal: ['ctbContaPagarEditar', 'btn-primary', 'contabilidade.pagar.lancar'] },
  'conta-pagar-form': { overlay: 'ctbContaPagarForm', principal: ['ctbContaFormSalvar', 'btn-primary', 'contabilidade.pagar.lancar'] },
  'pagar-parcela': { overlay: 'ctbPagarParcela', principal: ['ctbPagarConfirmar', 'btn-success', 'contabilidade.pagar.pagar'] },
  'documentos-recebidos': { overlay: 'ctbDocumentosRecebidos', principal: ['ctbDocsRegistrar', 'btn-primary', 'contabilidade.documento.registrar'] },
  'registrar-documento': { overlay: 'ctbRegistrarDocumento', principal: ['ctbDocRegistrar', 'btn-success', 'contabilidade.documento.registrar'] },
  'documento-recebido': { overlay: 'ctbDocumentoRecebido', principal: ['ctbDocDetExcluir', 'btn-warning', 'contabilidade.documento.excluir'] },
  'evidencias': { overlay: 'ctbEvidencias', principal: null }
};

const MODAIS_ETAPA4 = {
  'extrato': { overlay: 'ctbExtrato', principal: ['ctbExtratoImportar', 'btn-primary', 'contabilidade.extrato.importar'] },
  'importar-extrato': { overlay: 'ctbImportarExtrato', principal: ['ctbImpExtConfirmar', 'btn-success', 'contabilidade.extrato.importar'] },
  'contas-financeiras': { overlay: 'ctbContasFinanceiras', principal: ['ctbContasFinSalvar', 'btn-primary', 'contabilidade.contas.gerir'] }
};

const MODAIS_ETAPA5 = {
  'conciliacao': { overlay: 'ctbConciliacao', principal: ['ctbConcAutomatica', 'btn-primary', 'contabilidade.conciliar'] },
  'conciliar-movimento': { overlay: 'ctbConciliarMovimento', principal: ['ctbConcMovConfirmar', 'btn-success', 'contabilidade.conciliar'] }
};

const MODAIS_ETAPA6 = {
  'classificacao': { overlay: 'ctbClassificacao', principal: ['ctbClassAplicar', 'btn-primary', 'contabilidade.classificar'] },
  'plano-contas': { overlay: 'ctbPlanoContas', principal: ['ctbPlanoSalvar', 'btn-primary', 'contabilidade.plano.gerir'] },
  'regras-classificacao': { overlay: 'ctbRegras', principal: ['ctbRegraSalvar', 'btn-primary', 'contabilidade.plano.gerir'] }
};

test('modais das etapas 2 a 6: anatomia da casa, Fechar/Cancelar vermelho, botão principal com a cor e a permissão certas; a tela e o script conhecem todos', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  const chaves = new Set(CATALOGO.contabilidade.actions.map(a => a.key));
  for (const [nome, e] of Object.entries({ ...MODAIS_ETAPA3, ...MODAIS_ETAPA4, ...MODAIS_ETAPA5, ...MODAIS_ETAPA6 })) {
    const html = ler('html', 'modals', 'contabilidade', `${nome}.html`);
    assert.ok(html.includes(`id="${e.overlay}Overlay" data-ctb-modal`), `${nome}: overlay`);
    assert.ok(html.includes('ctl-padrao') && html.includes('ctl-modal-titulo') && html.includes('class="btn-neutral ctl-botao text-white justify-self-start">← Voltar'), `${nome}: cabeçalho`);
    assert.match(html, /<button type="button" data-ctb-fechar class="btn-danger ctl-botao text-white min-w-\[120px\]">(Fechar|Cancelar)<\/button>/, `${nome}: Fechar/Cancelar vermelho`);
    if (e.principal) {
      const [id, cor, perm] = e.principal;
      assert.match(html, new RegExp(`id="${id}" type="button" data-perm="${perm.replace(/\./g, '\\.')}" class="${cor} ctl-botao`), `${nome}: ${id}`);
    }
    for (const m of html.matchAll(/data-perm(?:-hide)?="([^"]+)"/g)) assert.ok(chaves.has(m[1]) || m[1] === 'ctt.create', `${nome}: ${m[1]} fora do catálogo`);
    assert.ok(TELA.includes(`'${nome}': { html: 'modals/contabilidade/${nome}.html', overlay: '${e.overlay}' }`), `${nome}: a tela não sabe abrir`);
    assert.ok(MODAIS.includes(`${e.overlay}: montar`), `${nome}: sem montador`);
  }
  // O "Novo contato" abre o cadastro de Contatos por cima e pede ctt.create.
  assert.ok(MODAIS.includes("window.Modal.open('modals/contatos/novo.html', '../js/modals/contato-novo.js', 'novoContato', true)"));
  assert.ok(ler('html', 'modals', 'contabilidade', 'conta-pagar-form.html').includes('id="ctbContaFormNovoContato" type="button" data-perm="ctt.create"'));
  // Cada rota que grava é a da permissão certa (o backend confere de novo).
  for (const rota of ["'/api/contabilidade/titulos', 'POST'", "/api/contabilidade/parcelas/${encodeURIComponent(parcelaId)}/pagar", "'/api/contabilidade/documentos', 'POST'", "'/api/contabilidade/arquivos', 'POST'", '/estornar', '/cancelar', '/excluir']) {
    assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  }
  // Etapa 4: a prévia não grava; importar, desfazer e a conta vão cada um à sua rota.
  for (const rota of [
    "'/api/contabilidade/extrato/previa', 'POST'", "'/api/contabilidade/extrato/importar', 'POST'", "/desfazer`, 'POST'",
    "'/api/contabilidade/contas-financeiras', 'POST'", "/api/contabilidade/contas-financeiras/${encodeURIComponent(editando)}`, 'PUT'"
  ]) {
    assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  }
  // Etapa 5: cada ação da conciliação vai à sua rota; o lote manda a conta e a competência.
  for (const rota of ["/conciliar`, 'POST'", "/desfazer`, 'POST'", "/ignorar`, 'POST'", "/reativar`, 'POST'", "/criar-conta`, 'POST'", "'/api/contabilidade/conciliacao/automatica', 'POST'"]) {
    assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  }
  // Etapa 6: classificar à mão, voltar ao automático, plano e regras (testar não grava).
  for (const rota of ["'/api/contabilidade/classificacao/classificar', 'POST'", "/automatico`, 'POST'", "'/api/contabilidade/plano-contas', 'POST'",
    "/api/contabilidade/plano-contas/${encodeURIComponent(editando)}`, 'PUT'", "'/api/contabilidade/regras', 'POST'", "/api/contabilidade/regras/${encodeURIComponent(editando)}`, 'PUT'",
    "'/api/contabilidade/regras/testar', 'POST'"]) {
    assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  }
  // "Buscar no BB" (API de Extratos, etapa 11) é o azul do BB e por enquanto só avisa.
  assert.match(ler('html', 'modals', 'contabilidade', 'extrato.html'), /id="ctbExtratoBuscarBB" type="button" data-perm="contabilidade\.extrato\.importar" class="btn-bb ctl-botao text-white"/);
});

test('ações da tela: contas a pagar, registrar documento, documentos recebidos e da competência são reais; as pendências da Contabilidade abrem o modal do filtro', () => {
  for (const acao of ['contas-pagar', 'registrar-documento', 'documentos-recebidos', 'evidencias']) {
    assert.ok(HTML.includes(`data-ctb-acao="${acao}"`), `botão ${acao}`);
    assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  }
  for (const acao of ['conta-pagar', 'documento-recebido', 'nova-conta', 'abrir-pendencia']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // As pendências do backend usam só ações que a tela conhece.
  const CHECKLIST = fs.readFileSync(path.join(RAIZ, '..', 'backend', 'contabilidade', 'checklist.js'), 'utf8');
  const acoes = new Set([...CHECKLIST.matchAll(/destino: 'contabilidade', filtro: \{ acao: '([^']+)'/g)].map(m => m[1]));
  assert.deepEqual([...acoes].sort(), ['classificacao', 'conciliacao', 'conta-pagar', 'contas-financeiras', 'contas-pagar', 'documentos-recebidos', 'importar-extrato', 'registrar-documento']);
  for (const acao of acoes) assert.ok(TELA.includes(`'${acao}': {`), acao);
  assert.ok(CHECKLIST.includes("acao: 'documento-recebido', documento_id: d.id") && TELA.includes("'documento-recebido': {"));
  // Etapa 4: o extrato é real (o "Sincronizar extrato do BB" virou "Buscar no BB" dentro dele).
  assert.ok(HTML.includes('data-ctb-acao="extrato"') && !HTML.includes('sincronizar-extrato'));
  for (const acao of ['extrato', 'importar-extrato', 'contas-financeiras']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // Etapas 5 e 6: a conciliação e a classificação são reais (o plano e as regras abrem da classificação).
  assert.ok(HTML.includes('data-ctb-acao="conciliacao"') && HTML.includes('data-ctb-acao="classificacao"'));
  for (const acao of ['conciliacao', 'conciliar-movimento', 'classificacao', 'plano-contas', 'regras-classificacao']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // O roteiro marca as etapas 1 a 6 como feitas.
  assert.equal((HTML.match(/ctb-roteiro__item" data-feita="1"/g) || []).length, 6);
});

test('funções puras do modal: dividir parcelas igual ao backend (sobra na última, fim de mês) e ler dinheiro digitado', () => {
  // O git (autocrlf) grava CRLF no Windows: o recorte procura o fim da função com "\n".
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js').replace(/\r\n/g, '\n');
  const trecho = n => { const i = MODAIS.indexOf(`function ${n}(`); return MODAIS.slice(i, MODAIS.indexOf('\n  }\n', i) + 4); };
  const f = vm.runInContext(`${trecho('lerMoeda')}\n${trecho('dividirParcelas')}\n({ lerMoeda, dividirParcelas })`, vm.createContext({}));
  assert.equal(f.lerMoeda('1.234,56'), 1234.56);
  assert.equal(f.lerMoeda('R$ 10'), 10);
  assert.equal(f.lerMoeda(''), null);
  assert.deepEqual(plano(f.dividirParcelas(3, '2026-01-31', 100)).map(p => [p.vencimento, p.valor]), [['2026-01-31', 33.33], ['2026-02-28', 33.33], ['2026-03-31', 33.34]]);
  assert.equal(f.dividirParcelas(0, '2026-01-31', 100), null);
  const titulos = require('../../../backend/contabilidade/titulos');
  const doBackend = titulos.gerarParcelas({ quantidade: 7, primeiroVencimento: '2026-10-31', valorTotal: 1000 }).map(p => [p.vencimento, p.valor]);
  assert.deepEqual(plano(f.dividirParcelas(7, '2026-10-31', 1000)).map(p => [p.vencimento, p.valor]), doBackend, 'a tela e o backend dividem igual');
});
