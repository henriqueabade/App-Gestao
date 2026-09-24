/**
 * Aba "Colaboradores (rateio)" das Regras do Financeiro (24/09/2026).
 *
 * A comissão de cada PEÇA contabilizada é repartida entre colaboradores, em
 * %. O que esta tela não pode perder:
 *   - a aba nova fica no mesmo modal de cadastro das outras regras;
 *   - cada peça mostra quanto já foi distribuído e quanto falta;
 *   - o campo de % anuncia o restante, e há o atalho "Dar os N%";
 *   - colaborador que já está na peça some da lista de escolha;
 *   - peça fechada em 100% não oferece mais ninguém;
 *   - sem o SQL da fase, a aba avisa e nada quebra.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const HTML = ler('html', 'modals', 'financeiro', 'regras.html');
const FONTE = ler('js', 'modals', 'financeiro-modais.js');
const PAINEL = fs.readFileSync(path.join(RAIZ, '..', 'backend', 'financeiro', 'painel.js'), 'utf8');
const FECHAMENTOS = fs.readFileSync(path.join(RAIZ, '..', 'backend', 'financeiro', 'fechamentos.js'), 'utf8');
const CONTROLLER = fs.readFileSync(path.join(RAIZ, '..', 'backend', 'financeiroController.js'), 'utf8');

test('a aba nova entra no modal de Regras, com os campos do cadastro e das peças', () => {
  assert.ok(HTML.includes('data-fin-aba="colaboradores"'), 'a aba existe');
  assert.ok(HTML.includes('data-fin-painel="colaboradores"'), 'e o painel dela');
  // Entre "Produção" e "Calendário": é uma regra de comissão, não de prazo.
  assert.ok(HTML.indexOf('data-fin-aba="producao"') < HTML.indexOf('data-fin-aba="colaboradores"'));
  assert.ok(HTML.indexOf('data-fin-aba="colaboradores"') < HTML.indexOf('data-fin-aba="calendario"'));

  for (const id of ['finColabSemSql', 'finColabNome', 'finColabFuncao', 'finColabSalvar', 'finColabCancelar',
    'finColabLista', 'finColabVazio', 'finColabTotal', 'finRateioCompetencia', 'finRateioBuscar',
    'finRateioMensagem', 'finRateioCarregando', 'finRateioPecas', 'finRateioVazio', 'finRateioResumo',
    'finRateioPorPessoa', 'finRateioPorPessoaLista']) {
    assert.ok(HTML.includes(`id="${id}"`), `sem #${id}`);
  }
  assert.ok(/id="finColabSalvar"[^>]*data-perm="financeiro\.regras\.editar"/.test(HTML), 'cadastrar pede a permissão de editar regras');
  assert.ok(HTML.includes('sql/comissao_colaboradores_rateio.sql'), 'a aba diz qual SQL falta');
  // Fechar/Cancelar do rodapé são vermelhos; o Cancelar do formulário também.
  assert.ok(/id="finColabCancelar"[^>]*class="hidden btn-danger/.test(HTML));
});

test('a tela fala com as rotas do rateio e monta tudo por createElement', () => {
  assert.ok(FONTE.includes("fetchApi(`/api/financeiro/rateio?competencia=${encodeURIComponent(competencia)}`)"));
  assert.ok(FONTE.includes("fetchApi('/api/financeiro/colaboradores', { method: 'POST'"));
  assert.ok(FONTE.includes("fetchApi(`/api/financeiro/colaboradores/${editando.id}`, { method: 'PUT'"));
  assert.ok(FONTE.includes("fetchApi(`/api/financeiro/colaboradores/${colab.id}`, { method: 'DELETE' })"));
  assert.ok(FONTE.includes("fetchApi('/api/financeiro/rateio', {"));
  assert.ok(FONTE.includes("fetchApi(`/api/financeiro/rateio/${linha.id}`, { method: 'DELETE' })"));
  assert.ok(FONTE.includes('montarColaboradores({ podeEditar, erroDe })'), 'a aba é montada junto com as Regras');

  const inicio = FONTE.indexOf('function montarColaboradores(');
  const fim = FONTE.indexOf('// ------------------------------------------------ configuração fiscal', inicio);
  assert.ok(inicio > 0 && fim > inicio);
  const bloco = FONTE.slice(inicio, fim);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(bloco), 'nada de innerHTML nesta aba');
  assert.ok(bloco.includes('window.DialogPadrao?.confirm'), 'desligar colaborador pede confirmação na caixa da casa');
});

test('cada peça mostra o que falta, oferece só quem ainda não está nela e trava a peça fechada', () => {
  const inicio = FONTE.indexOf('function linhaDaPeca(peca)');
  const fim = FONTE.indexOf('function pintarPecas()', inicio);
  const bloco = FONTE.slice(inicio, fim);

  assert.ok(bloco.includes("peca.completo ? '100% distribuído' : `faltam ${pct(peca.restante)}`"), 'a etiqueta diz o que falta');
  assert.ok(bloco.includes("peca.completo ? 'badge-success' : 'badge-warning'"), 'verde quando fecha, âmbar quando falta');
  assert.ok(bloco.includes('barra.style.width = `${Math.min(100, Number(peca.distribuido) || 0)}%`'), 'a barra mostra o quanto já foi');
  assert.ok(bloco.includes('const jaEstao = new Set(peca.linhas.map(l => String(l.colaborador_id)))')
    && bloco.includes('!jaEstao.has(String(x.id))'), 'quem já está na peça sai da lista');
  assert.ok(bloco.includes('valor.placeholder = `até ${pct(peca.restante)}`'), 'o campo anuncia o restante');
  assert.ok(bloco.includes('`Dar os ${pct(peca.restante)}`'), 'o atalho de fechar a peça de uma vez');
  assert.ok(bloco.includes('if (podeEditar && !estado.fechado && !peca.completo)'),
    'peça completa (ou competência fechada) não oferece mais ninguém');
});

test('o fechamento e o painel só cobram o rateio quando ele está em uso', () => {
  // O bloqueio entra na prévia de comissões, junto com os outros.
  assert.ok(FECHAMENTOS.includes("const rateios = require('./rateios')"));
  assert.ok(FECHAMENTOS.includes('if (extra.rateio) bloqueios.push(extra.rateio)'));
  assert.ok(FECHAMENTOS.includes('rateio: rateio?.bloqueio || null'));
  assert.ok(FECHAMENTOS.includes('resumo.fechado ? null : await rateios.lerVisao'), 'competência fechada não recalcula nada');

  // E a pendência aparece no painel enquanto falta distribuir.
  assert.ok(PAINEL.includes('function pendenciaDoRateio('));
  assert.ok(PAINEL.includes("if (!visao.colaboradores.length || !visao.pendentes) return [];"),
    'sem colaborador cadastrado, nenhuma pendência');
  assert.ok(PAINEL.includes("chave: 'rateio_incompleto'") && PAINEL.includes("destino: 'regras'"));
  assert.ok(PAINEL.includes('...pendenciaDoRateio({ visao: visaoRateio'), 'entra na lista de pendências');

  // As rotas, com as permissões da casa.
  for (const rota of ["router.get('/colaboradores'", "router.post('/colaboradores'", "router.put('/colaboradores/:id'",
    "router.delete('/colaboradores/:id'", "router.get('/rateio'", "router.post('/rateio'", "router.put('/rateio/:id'",
    "router.delete('/rateio/:id'"]) {
    assert.ok(CONTROLLER.includes(rota), `sem a rota ${rota}`);
  }
  assert.ok(CONTROLLER.includes("router.post('/colaboradores', exigirPermissao(EDITAR_REGRAS)"), 'cadastrar exige editar regras');
  assert.ok(CONTROLLER.includes("router.get('/rateio', exigirPermissao(VER)"), 'ver exige só a leitura do Financeiro');
});
