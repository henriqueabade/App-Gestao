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
  return vm.runInContext(`${TELA.slice(inicio, fim)}\n({ ctbFiltrarPendencias, ctbContagem, ctbTextoSituacao, ctbFormatarData, ctbFormatarInstante, ctbFormatarQuando, ctbEscapar, ctbCitaveisLocais })`, vm.createContext({}));
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
  const etapa7 = sqlDaEtapa('contabilidade_fechamento.sql');
  if (etapa7) {
    const { TABELAS_FECHAMENTO } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_FECHAMENTO) assert.ok(etapa7.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    assert.match(etapa7, /competencia_fechamentos \(competencia, versao\)/, 'uma versão por número');
    assert.doesNotMatch(etapa7, /perm_contabilidade/, 'a etapa 7 não cria permissão');
  }
  const etapa9 = sqlDaEtapa('contabilidade_pacote.sql');
  if (etapa9) {
    const { TABELAS_PACOTE } = require('../../../backend/contabilidade/base');
    for (const t of TABELAS_PACOTE) assert.ok(etapa9.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t);
    assert.ok(etapa9.startsWith("SET client_encoding = 'UTF8';"), 'acentos certos também pelo psql do Windows');
    assert.doesNotMatch(etapa9, /perm_contabilidade/, 'a etapa 9 não cria permissão');
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
  // Etapa 7: a versão e as diferenças desde a foto do fechamento.
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'fechada', fechada_em: '2026-09-25T15:30:00-03:00', versao: 2, diferencas: 3 } }).detalhe,
    'Fechada em 25/09/2026 às 15:30 · versão 2 · 3 diferenças desde a foto do fechamento');
  // Etapa 9: o pacote da contabilidade.
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'fechada', fechada_em: '2026-09-25T15:30:00-03:00', versao: 1, pacote: { gerado_em: '2026-09-26T10:00:00-03:00', enviado_em: '2026-09-26T11:00:00-03:00' } } }).detalhe,
    'Fechada em 25/09/2026 às 15:30 · versão 1 · pacote enviado em 26/09/2026');
  assert.equal(f.ctbTextoSituacao({ situacao: { status: 'fechada', fechada_em: '2026-09-25T15:30:00-03:00', versao: 1, pacote: { gerado_em: '2026-09-26T10:00:00-03:00', enviado_em: null } } }).detalhe,
    'Fechada em 25/09/2026 às 15:30 · versão 1 · pacote gerado, falta marcar o envio');

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

const MODAIS_ETAPA9 = {
  'pacote': { overlay: 'ctbPacote', principal: ['ctbPacoteGerar', 'btn-primary', 'contabilidade.pacote.gerar'] }
};

// 29/09/2026: a atividade inteira e as mensagens em tamanho grande (só consulta/conversa: sem botão principal).
const MODAIS_TELA = {
  'atividade': { overlay: 'ctbAtividade', principal: null },
  'mensagens': { overlay: 'ctbMensagens', principal: null }
};

const MODAIS_ETAPA8 = {
  'relatorio': { overlay: 'ctbRelatorio', principal: ['ctbRelPdf', 'btn-primary', 'contabilidade.pacote.gerar'] },
  'dossie': { overlay: 'ctbDossie', principal: null }
};

const MODAIS_ETAPA7 = {
  'fechamentos': { overlay: 'ctbFechamentos', principal: null }
};

// Etapas 10 a 13: as Configurações (cartões das integrações; os botões são de cada cartão) e a caixa de entrada.
const MODAIS_ETAPA10 = {
  'configuracao': { overlay: 'ctbConfiguracao', principal: null },
  'entrada-dfe': { overlay: 'ctbEntradaDfe', principal: ['ctbEntradaBuscarSefaz', 'btn-primary', 'contabilidade.documento.registrar'] }
};

// Fase H (02/10/2026): os boletos do DDA do BB (buscar é o principal; pede "Lançar contas a pagar").
const MODAIS_FASE_H = {
  'dda': { overlay: 'ctbDda', principal: ['ctbDdaBuscar', 'btn-primary', 'contabilidade.pagar.lancar'] }
};

// Fase D (02/10/2026): os comprovantes do BB (anexar o ZIP é o principal; pede "Registrar documento").
const MODAIS_FASE_D = {
  'comprovantes': { overlay: 'ctbComprovantes', principal: ['ctbCompAnexar', 'btn-primary', 'contabilidade.documento.registrar'] }
};

const MODAIS_ETAPA6 = {
  'classificacao': { overlay: 'ctbClassificacao', principal: ['ctbClassAplicar', 'btn-primary', 'contabilidade.classificar'] },
  'plano-contas': { overlay: 'ctbPlanoContas', principal: ['ctbPlanoSalvar', 'btn-primary', 'contabilidade.plano.gerir'] },
  'regras-classificacao': { overlay: 'ctbRegras', principal: ['ctbRegraSalvar', 'btn-primary', 'contabilidade.plano.gerir'] }
};

test('modais das etapas 2 a 9: anatomia da casa, Fechar/Cancelar vermelho, botão principal com a cor e a permissão certas; a tela e o script conhecem todos', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  const chaves = new Set(CATALOGO.contabilidade.actions.map(a => a.key));
  for (const [nome, e] of Object.entries({ ...MODAIS_ETAPA3, ...MODAIS_ETAPA4, ...MODAIS_ETAPA5, ...MODAIS_ETAPA6, ...MODAIS_ETAPA7, ...MODAIS_ETAPA8, ...MODAIS_ETAPA9, ...MODAIS_ETAPA10, ...MODAIS_FASE_H, ...MODAIS_FASE_D, ...MODAIS_TELA })) {
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
  // Etapa 7: o fechar lê a prévia do que congela; o histórico lê as versões.
  for (const rota of ['/api/contabilidade/fechar/previa?competencia=', '/api/contabilidade/fechamentos?competencia=']) assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  const fecharHtml = ler('html', 'modals', 'contabilidade', 'fechar.html');
  assert.ok(fecharHtml.includes('id="ctbFecharFoto"') && fecharHtml.includes('O que fica congelado'));
  const hist = ler('html', 'modals', 'contabilidade', 'fechamentos.html');
  assert.match(hist, /id="ctbFechHistReabrir" type="button" data-perm="contabilidade\.reabrir" class="hidden btn-warning ctl-botao/);
  assert.match(hist, /id="ctbFechHistFechar" type="button" data-perm="contabilidade\.fechar" class="hidden btn-success ctl-botao/);
  // Etapa 8: o relatório lê a tela, o PDF (HTML impresso pelo Electron) e a planilha; o dossiê é só leitura.
  for (const rota of ['/api/contabilidade/relatorio?competencia=', '/api/contabilidade/relatorio/documento?competencia=', '/api/contabilidade/relatorio/planilha?competencia=', '/api/contabilidade/dossie?tipo=']) {
    assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  }
  assert.ok(MODAIS.includes('window.electronAPI.salvarHtmlComoPdf({ html: r.html, nomeSugerido: r.nome') && MODAIS.includes('window.electronAPI.salvarArquivoBinario({ base64: r.base64, nomeSugerido: r.nome'));
  const rel = ler('html', 'modals', 'contabilidade', 'relatorio.html');
  assert.match(rel, /id="ctbRelPlanilha" type="button" data-perm="contabilidade\.pacote\.gerar" class="btn-primary ctl-botao/);
  for (const aba of ['resumo', 'livro', 'resultado', 'conciliacao', 'pendencias', 'documentos']) assert.ok(rel.includes(`data-ctb-aba="${aba}"`) && rel.includes(`data-ctb-painel="${aba}"`), `aba ${aba}`);
  assert.ok(!/data-perm="[^"]+"[^>]*id="ctbDossie/.test(ler('html', 'modals', 'contabilidade', 'dossie.html')), 'o dossiê não pede permissão além de ver');
  // O dossiê abre das fichas (conta, documento, lançamento), sempre em azul claro (consulta dentro do app).
  for (const [arquivo, id, tipo] of [['conta-pagar', 'ctbContaPagarDossie', 'titulo'], ['documento-recebido', 'ctbDocDetDossie', 'documento'], ['conciliar-movimento', 'ctbConcMovDossie', 'movimento']]) {
    assert.match(ler('html', 'modals', 'contabilidade', `${arquivo}.html`), new RegExp(`id="${id}" type="button" class="btn-secondary ctl-botao text-white"`), `${arquivo}: Dossiê`);
    assert.ok(MODAIS.includes(`el('${id}').addEventListener('click', () => abrirOutro('dossie', { tipo: '${tipo}', id }));`), `${arquivo}: abre o dossiê`);
  }
  // Etapa 9: o pacote lê a prévia, gera (com o PDF que o Electron imprime) e marca o envio.
  for (const rota of ['/api/contabilidade/pacote?competencia=', "'/api/contabilidade/pacote', 'POST'", "/enviado`, 'POST'"]) assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  assert.ok(MODAIS.includes('window.electronAPI.gerarPdfDeHtml({ html: doc.html })'), 'o PDF do relatório vai dentro do pacote');
  const pac = ler('html', 'modals', 'contabilidade', 'pacote.html');
  assert.match(pac, /id="ctbPacoteEnviado" type="button" data-perm="contabilidade\.pacote\.gerar" class="btn-success ctl-botao"/);
  assert.ok(pac.includes('data-perm-hide="contabilidade.pacote.gerar"'), 'o registro do envio some sem a permissão');
  // "Buscar no BB" (API de Extratos, etapa 11) é o azul do BB e busca de verdade a competência da tela.
  assert.match(ler('html', 'modals', 'contabilidade', 'extrato.html'), /id="ctbExtratoBuscarBB" type="button" data-perm="contabilidade\.extrato\.importar" class="btn-bb ctl-botao text-white"/);
  assert.ok(MODAIS.includes("enviar('/api/contabilidade/integracoes/bb_extrato/sincronizar', 'POST', { competencia: compCampo.value })"), 'Buscar no BB chama a busca da integração');
  assert.ok(!/ctbExtratoBuscarBB[\s\S]{0,300}em implementação/.test(MODAIS), 'Buscar no BB não é mais aviso');
});

test('etapas 10 a 13 (30/09/2026): Configurações com as integrações e a caixa de entrada da SEFAZ/ADN', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  // A tela abre os dois; o painel aponta para eles (pendência da caixa de entrada e erro de integração).
  for (const acao of ['configuracao', 'entrada-dfe']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  assert.ok(HTML.includes('data-ctb-acao="entrada-dfe"') && HTML.includes('data-ctb-acao="configuracao"'));
  // As rotas: ver, salvar, credenciais, testar, buscar, certificado público; a caixa de entrada e as ações da linha.
  for (const rota of [
    "fetchApi('/api/contabilidade/integracoes')", "/api/contabilidade/integracoes/${i.chave}`, 'PUT'", "/api/contabilidade/integracoes/${i.chave}/credenciais`, 'POST'",
    "/credenciais?ambiente=${amb}&destino=ambos`, { method: 'DELETE' }", "/api/contabilidade/integracoes/${i.chave}/testar`, 'POST'",
    "/api/contabilidade/integracoes/${i.chave}/sincronizar`, 'POST'", "fetchApi('/api/contabilidade/integracoes/certificado/publico')",
    "/api/contabilidade/entrada?origem=", "/api/contabilidade/entrada/${encodeURIComponent(id)}/${caminho}`, 'POST'", "/api/contabilidade/entrada/${encodeURIComponent(l.id)}/xml`",
    "/api/contabilidade/integracoes/${chave}/sincronizar`, 'POST'"
  ]) assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  for (const caminho of ["'manifestar'", "'baixar-xml'", "'registrar'", "'ignorar'", "'restaurar'"]) assert.ok(MODAIS.includes(`acao(l.id, ${caminho}`), `ação ${caminho}`);
  // Produção pede a palavra PRODUCAO; o client_secret entra num campo de senha e nunca é mostrado.
  assert.ok(MODAIS.includes("corpo.confirmacao = palavra") && MODAIS.includes("placeholder: 'PRODUCAO'"));
  assert.ok(MODAIS.includes("campoDeTexto('', { tipo: 'password'"));
  assert.ok(!/client_secret:\s*i\.|\.secret\b(?!_)/.test(MODAIS.slice(MODAIS.indexOf('function montarConfiguracao'), MODAIS.indexOf('function montarEntradaDfe'))), 'a tela não lê segredo nenhum');
  // Buscar agora pede a permissão da integração; quem não é Sup Admin vê tudo travado.
  assert.ok(MODAIS.includes("{ perm: i.permissao_executar, titulo: 'A busca de verdade (a mesma da agenda)' }"));
  assert.ok(MODAIS.includes("if (!podeEditar) form.querySelectorAll('input, select').forEach(x => { x.disabled = true; });"));
  // Cores: testar o BB é o azul do BB; buscar é verde; salvar é o principal; remover segredo é vermelho.
  assert.ok(MODAIS.includes("botaoPequeno('Testar conexão', i.banco ? 'btn-bb' : 'btn-secondary'") && MODAIS.includes("botaoPequeno('Buscar agora', 'btn-success'"));
  assert.ok(MODAIS.includes("botaoPequeno('Salvar', 'btn-primary'") && MODAIS.includes("botaoPequeno('Remover', 'btn-danger'"));
  const cfg = ler('html', 'modals', 'contabilidade', 'configuracao.html');
  assert.match(cfg, /id="ctbConfigBaixarCer" type="button" class="btn-secondary ctl-botao text-white"/);
  const ent = ler('html', 'modals', 'contabilidade', 'entrada-dfe.html');
  assert.match(ent, /id="ctbEntradaBuscarAdn" type="button" data-perm="contabilidade\.documento\.registrar" class="btn-secondary ctl-botao text-white"/);
  assert.match(ent, /id="ctbEntradaConfig" type="button" data-perm="contabilidade\.config\.view" class="btn-neutral ctl-botao text-white"/);
  // A atividade conhece os eventos novos.
  for (const tipo of ['integracao_configurada', 'nfe_manifestada', 'entrada_ignorada']) assert.ok(MODAIS.includes(`'${tipo}'`), `atividade: ${tipo}`);
});

test('fase H (02/10/2026): os boletos do DDA — a tela abre, cada ação vai à sua rota, o cartão pergunta "quantas vezes por dia" e o formulário lança e liga', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  assert.match(TELA, /'dda': \{[^}]*abrir:/);
  assert.ok(HTML.includes('data-ctb-acao="dda"'));
  for (const rota of [
    "fetchApi(`/api/contabilidade/dda?visao=", "/api/contabilidade/dda/${encodeURIComponent(id)}/${caminho}`, 'POST'", "fetchApi(`/api/contabilidade/dda/${encodeURIComponent(l.id)}`)",
    "/api/contabilidade/dda/${encodeURIComponent(l.id)}/espelho`", "enviar('/api/contabilidade/dda/conferir', 'POST', {})", "enviar('/api/contabilidade/integracoes/bb_dda/sincronizar', 'POST', {})",
    "/api/contabilidade/dda/${encodeURIComponent(ddaId)}/lancar`, 'POST'"
  ]) assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  for (const caminho of ["'vincular'", "'contestar'", "'ignorar'", "'restaurar'", "'desvincular'"]) assert.ok(MODAIS.includes(caminho), `ação ${caminho}`);
  // O espelho é PDF salvo pelo Electron e diz que é documento interno.
  assert.ok(MODAIS.includes("window.electronAPI.salvarHtmlComoPdf({ html: r.html, nomeSugerido: r.nome, titulo: 'Salvar o Espelho DDA em PDF' })"));
  // O cartão: vezes por dia viram o intervalo; as credenciais podem vir do cartão do Extrato; "Ver os boletos".
  assert.ok(MODAIS.includes('Math.round(1440 / n)') && MODAIS.includes('Quantas vezes por dia'));
  assert.ok(MODAIS.includes("'usar_credenciais_do_extrato'") && MODAIS.includes("botaoPequeno('Ver os boletos'"));
  // O "Lançar conta" abre o formulário de conta a pagar com o boleto.
  assert.ok(MODAIS.includes("abrirOutro('conta-pagar-form', { dda_id: l.id })"));
  // A atividade conhece os eventos do DDA; a origem da conta lançada do boleto tem nome.
  for (const tipo of ['dda_vinculado', 'dda_desvinculado', 'dda_conta_lancada', 'dda_ignorado', 'dda_contestado', 'dda_restaurado']) assert.ok(MODAIS.includes(`'${tipo}'`), `atividade: ${tipo}`);
  assert.ok(MODAIS.includes("dda: 'Boleto do DDA'"));
  const html = ler('html', 'modals', 'contabilidade', 'dda.html');
  assert.match(html, /id="ctbDdaConferir" type="button" data-perm="contabilidade\.pagar\.lancar" class="btn-secondary ctl-botao text-white"/);
  assert.match(html, /id="ctbDdaConfig" type="button" data-perm="contabilidade\.config\.view" class="btn-neutral ctl-botao text-white"/);
  assert.ok(html.includes('Estar no DDA não prova que a dívida é devida'));
});

test('fase D (02/10/2026): os comprovantes do BB — anexar o ZIP em lotes, ligar ao extrato, abrir o PDF refeito; o pacote salvo descarta os originais', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  assert.match(TELA, /'comprovantes': \{[^}]*abrir:/);
  assert.ok(HTML.includes('data-ctb-acao="comprovantes"'));
  for (const rota of [
    "fetchApi(`/api/contabilidade/comprovantes?competencia=", "/api/contabilidade/comprovantes/${encodeURIComponent(id)}/${caminho}`, 'POST'",
    "fetchApi(`/api/contabilidade/comprovantes/${encodeURIComponent(l.id)}`)", "/api/contabilidade/comprovantes/${encodeURIComponent(l.id)}/pdf`",
    "enviar('/api/contabilidade/comprovantes/importar', 'POST', { arquivos })", "enviar('/api/contabilidade/comprovantes/conferir', 'POST', {})"
  ]) assert.ok(MODAIS.includes(rota), `rota ${rota}`);
  for (const caminho of ["'ligar'", "'ignorar'", "'desligar'", "'restaurar'"]) assert.ok(MODAIS.includes(`acao(l.id, ${caminho}`) || MODAIS.includes(`acao(id, ${caminho}`) || MODAIS.includes(`comMotivo(l.id, ${caminho}`), `ação ${caminho}`);
  // O corpo do POST tem limite: os arquivos vão em lotes de até 15 MB.
  assert.ok(MODAIS.includes('const LOTE_COMPROVANTES_BYTES = 15 * 1024 * 1024;'));
  // O dossiê do lançamento ligado; os Documentos da competência baixam o comprovante refeito.
  assert.ok(MODAIS.includes("abrirOutro('dossie', { tipo: 'movimento', id: l.movimento.id })"));
  assert.ok(MODAIS.includes("if (i.baixar.tipo === 'comprovante') return `/api/contabilidade/comprovantes/${encodeURIComponent(i.baixar.id)}/pdf`;"));
  assert.ok(ler('html', 'modals', 'contabilidade', 'evidencias.html').includes('data-total="reproduzido"'), 'Documentos: o total dos reproduzidos');
  // O pacote salvo avisa o backend (os originais guardados saem do servidor).
  assert.ok(MODAIS.includes("/api/contabilidade/pacote/${encodeURIComponent(p.id)}/salvo`, 'POST', {}"));
  for (const tipo of ['comprovantes_importados', 'comprovante_ligado', 'comprovante_desligado', 'comprovante_ignorado', 'comprovante_restaurado', 'comprovantes_descartados']) assert.ok(MODAIS.includes(`'${tipo}'`), `atividade: ${tipo}`);
  const html = ler('html', 'modals', 'contabilidade', 'comprovantes.html');
  assert.match(html, /id="ctbCompConferir" type="button" data-perm="contabilidade\.documento\.registrar" class="btn-secondary ctl-botao text-white"/);
  assert.match(html, /id="ctbCompArquivo" type="file" accept="\.zip,\.pdf" multiple/);
  assert.ok(html.includes('O app guarda só os dados e refaz cada comprovante idêntico ao do banco'));
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
  // Fase H: 'dda' (os avisos dos boletos do DDA e o pagamento por boleto sem o boleto).
  // Fase D: 'comprovantes' (o pagamento sem comprovante e o comprovante sem lançamento).
  assert.deepEqual([...acoes].sort(), ['classificacao', 'comprovantes', 'conciliacao', 'configuracao', 'conta-pagar', 'contas-financeiras', 'contas-pagar', 'dda', 'documento-recebido', 'documentos-recebidos', 'entrada-dfe', 'fechamentos', 'importar-extrato', 'pacote', 'registrar-documento']);
  for (const acao of acoes) assert.ok(TELA.includes(`'${acao}': {`), acao);
  assert.ok(CHECKLIST.includes("acao: 'documento-recebido', documento_id: d.id") && TELA.includes("'documento-recebido': {"));
  // Etapa 4: o extrato é real (o "Sincronizar extrato do BB" virou "Buscar no BB" dentro dele).
  assert.ok(HTML.includes('data-ctb-acao="extrato"') && !HTML.includes('sincronizar-extrato'));
  for (const acao of ['extrato', 'importar-extrato', 'contas-financeiras']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // Etapas 5 e 6: a conciliação e a classificação são reais (o plano e as regras abrem da classificação).
  assert.ok(HTML.includes('data-ctb-acao="conciliacao"') && HTML.includes('data-ctb-acao="classificacao"'));
  for (const acao of ['conciliacao', 'conciliar-movimento', 'classificacao', 'plano-contas', 'regras-classificacao']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // Etapa 7: o histórico dos fechamentos é real.
  assert.ok(HTML.includes('data-ctb-acao="fechamentos"'));
  assert.match(TELA, /'fechamentos': \{[^}]*abrir:/);
  // Etapa 8: o relatório mensal é real e quem só vê a Contabilidade também o abre (salvar pede a permissão, lá dentro).
  assert.ok(HTML.includes('<button type="button" class="ctb-acao" data-ctb-acao="relatorio">'));
  for (const acao of ['relatorio', 'dossie']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  // Etapa 9: gerar o pacote e registrar o envio são reais (os dois abrem o modal do pacote).
  for (const acao of ['pacote', 'enviar']) assert.match(TELA, new RegExp(`'${acao}': \\{[^}]*abrir:`), `${acao} tem abrir`);
  assert.ok(TELA.includes("ctbAbrirModal('pacote', m, { enviar: true })"));
  // 29/09/2026: "Próximas etapas" saiu; no lugar, as mensagens (o social do módulo).
  assert.ok(!HTML.includes('ctb-roteiro') && !HTML.includes('Próximas etapas'));
  assert.ok(HTML.includes('<h2>Mensagens e comentários</h2>') && HTML.includes('data-ctb-mensagens'));
});

test('tela (29/09/2026): pendências sem "Ver todas" e com rolagem; os cartões filtram e rolam até a lista; atividade e mensagens com altura fixa e modal', () => {
  const CSS = ler('css', 'contabilidade.css');
  // "Todas" mostra todas: sem o botão, sem o corte.
  assert.ok(!HTML.includes('pendencias-todas') && !TELA.includes('pendencias-todas'));
  assert.ok(!TELA.includes('CTB_PENDENCIAS_VISIVEIS') && !TELA.includes('CTB_ATIVIDADE_VISIVEL') && !TELA.includes('ctbMostrarTodas'));
  assert.match(HTML, /<ul class="ctb-pendencias ctb-rolagem" data-ctb-lista="pendencias"/);
  assert.match(CSS, /\.ctb-rolagem \{\s*flex: 1 1 0;\s*min-height: 0;\s*overflow-y: auto;/);
  assert.doesNotMatch(CSS, /::-webkit-scrollbar/, 'a barra de rolagem é a da casa (scroll.css)');
  // Os cartões de críticos, documentais e avisos: filtram e levam a tela até a lista, suave.
  for (const nivel of ['critico', 'documental', 'aviso']) assert.match(HTML, new RegExp(`class="ctb-kpi[^"]*"[^>]*data-ctb-acao="filtrar" data-ctb-filtro="${nivel}"`));
  assert.ok(TELA.includes("if (alvo.classList.contains('ctb-kpi')) extra.cartao = true;"));
  assert.ok(TELA.includes('extra?.cartao ? ctbIrParaPendencias(m, extra.filtro)'));
  assert.ok(TELA.includes("ctbRolarAte(moduleEl.querySelector('#ctbPendenciasPainel'))") && TELA.includes("behavior: reduzir ? 'auto' : 'smooth'"));
  assert.ok(HTML.includes('id="ctbPendenciasPainel"'));
  // Atividade e mensagens: a mesma altura fixa; "Ver todas"/"Ver tudo" abrem os modais.
  assert.equal((HTML.match(/class="ctb-painel ctb-painel--fixo glass-surface rounded-xl"/g) || []).length, 2);
  assert.match(CSS, /\.ctb-painel--fixo \{ height: 34rem; \}/);
  assert.ok(TELA.includes("'atividade-todas': { rotulo: 'Toda a atividade', abrir: m => ctbAbrirModal('atividade', m, {}) }"));
  assert.ok(HTML.includes('data-ctb-acao="mensagens"') && TELA.includes("'mensagens': {"));
  // O social: origem 'contabilidade', mural 1, "'" cita e abre; o sino chega nas mensagens.
  assert.ok(TELA.includes("origem: 'contabilidade'") && TELA.includes('registroId: CTB_MURAL') && TELA.includes('objetos: ctbObjetosCitaveis'));
  assert.ok(TELA.includes('/api/contabilidade/citaveis?busca='));
  for (const tipo of ['competencia', 'pendencia', 'documento', 'titulo', 'movimento', 'arquivo', 'fechamento', 'pacote', 'conta_plano', 'conta_financeira', 'importacao', 'fornecedor']) {
    assert.ok(TELA.includes(`case '${tipo}':`), `abrir ${tipo}`);
  }
  assert.ok(TELA.includes('window.ContabilidadeAbrirMensagens = ') && TELA.includes('window.ContabilidadeAbrirObjeto = '));
  const SINO = ler('js', 'notifications.js');
  assert.ok(SINO.includes("aviso.origem === 'contabilidade'") && SINO.includes('window.ContabilidadeAbrirMensagens({ itemId: aviso.item_id, comentarioId: aviso.comentario_id })'));
  assert.ok(SINO.includes("contabilidade: 'Contabilidade'") && SINO.includes("contato: 'Contato'"));
});

test('correções de 02/10/2026: o checklist por fonte leva às pendências; cartões das Configurações contraem; CDB fora de uso; "Guardar como histórico" e o mês de início', () => {
  const MODAIS = ler('js', 'modals', 'contabilidade-modais.js');
  const CSS = ler('css', 'contabilidade.css');
  // Os cartões do checklist por fonte: filtram pela fonte (todos os níveis) e rolam até o cartão das pendências.
  assert.ok(TELA.includes("cartao.dataset.ctbAcao = 'ir-fonte';"));
  assert.ok(TELA.includes("'ir-fonte': { rotulo: 'Ver as pendências da fonte', abrir: (m, extra) => ctbIrParaFonte(m, extra?.fonte || null) }"));
  const irFonte = TELA.slice(TELA.indexOf('function ctbIrParaFonte'), TELA.indexOf('function ctbRolarAte'));
  assert.ok(irFonte.includes("moduleEl.ctbFiltro = { nivel: 'todas', fonte: fonte || null };") && irFonte.includes("ctbRolarAte(moduleEl.querySelector('#ctbPendenciasPainel'))"));
  assert.ok(HTML.includes('data-ctb-acao="filtrar-fonte" data-ctb-fonte=""'), 'o chip da fonte continua tirando o filtro');
  // Expandir/contrair: botão no topo de cada cartão, lembrado neste computador, contraído = só o topo.
  assert.ok(MODAIS.includes("const alternarCartao = criar('button', 'ctb-integracao__alternar');") && MODAIS.includes("topo.append(simbolo, titulo, etiquetas, alternarCartao);"));
  assert.ok(MODAIS.includes("const CHAVE_CONTRAIDOS = 'ctb.configuracao.contraidos';") && /try \{ window\.localStorage\.setItem/.test(MODAIS));
  assert.match(CSS, /\.ctb-integracao\.is-contraido > :not\(\.ctb-integracao__topo\) \{ display: none !important; \}/);
  const contraido = vm.runInNewContext(`${MODAIS.slice(MODAIS.indexOf('function cartaoContraido'), MODAIS.indexOf('/**', MODAIS.indexOf('function cartaoContraido')))}; cartaoContraido`);
  assert.deepEqual([
    contraido({ chave: 'a', pronta: true }, {}), contraido({ chave: 'a', pronta: false }, {}), contraido({ chave: 'a', pronta: true, estado: { ultimo_erro: 'x' } }, {}),
    contraido({ chave: 'a', pronta: false, fora_de_uso: 'f' }, {}), contraido({ chave: 'a', pronta: true }, { a: false })
  ], [true, false, false, true, false], 'sem nada guardado, abre só o que tem pendência ou erro; o guardado vence');
  // Fora de uso: só a etiqueta e o motivo; o mês de início é um campo de mês.
  assert.ok(MODAIS.includes("etiquetas.append(tag('Fora de uso', 'badge-neutral'));") && MODAIS.includes("criar('p', 'ctb-integracao__fora-de-uso', i.fora_de_uso)"));
  assert.ok(MODAIS.includes("else if (campo.tipo === 'competencia') controle = campoDeTexto(valor ?? campo.padrao ?? '', { tipo: 'month' });"));
  // Caixa de entrada: a nota do mês anterior ao início pede a decisão.
  assert.ok(MODAIS.includes("acao(l.id, 'historico', 'Guardada como histórico: saiu das pendências.')") && MODAIS.includes("tag('Decidir', 'badge-warning', l.decidir_texto || '')"));
});

test('funções puras (29/09/2026): as pendências da tela viram objetos que o "\'" cita', () => {
  const f = puras();
  const pend = [
    { chave: 'docrec_sem_xml_7', nivel: 'documental', titulo: 'NF-e [1/123] sem XML', ignorada: false },
    { chave: 'pagar_vencidas', nivel: 'critico', titulo: 'Contas vencidas', ignorada: true },
    { chave: 'chave com espaço', nivel: 'aviso', titulo: 'x' }
  ];
  const todos = plano(f.ctbCitaveisLocais(pend, '2026-08', ''));
  assert.deepEqual(todos.map(o => o.id), ['2026-08:docrec_sem_xml_7', '2026-08:pagar_vencidas'], 'chave fora do formato fica de fora');
  assert.equal(todos[0].rotulo, 'Documental: NF-e 1/123 sem XML (08/2026)', 'colchete sai (quebraria a marca)');
  assert.equal(todos[1].detalhe, 'Ignorada com justificativa');
  assert.deepEqual(plano(f.ctbCitaveisLocais(pend, '2026-08', 'vencidas')).map(o => o.id), ['2026-08:pagar_vencidas']);
  assert.deepEqual(plano(f.ctbCitaveisLocais(pend, '2026-08', 'critico')).map(o => o.id), ['2026-08:pagar_vencidas'], 'busca sem acento');
  assert.deepEqual(plano(f.ctbCitaveisLocais(pend, null, '')), []);
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
