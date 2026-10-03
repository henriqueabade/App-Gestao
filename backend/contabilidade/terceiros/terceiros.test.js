/**
 * Fase F (02/10/2026) — o que a empresa pagou em nome de outra (a Artdeco):
 * as partes puras.
 *
 * O que fica preso:
 *   - o comprovante do BB com o pagador de fora (CPF/CNPJ inteiro, diferente
 *     do da empresa) vira um item a receber; o da empresa, o mascarado e o
 *     não ligado ao extrato, não;
 *   - a palavra do nome que acha o terceiro na descrição do banco;
 *   - o que voltou e o que falta (vínculos da conciliação); cancelado;
 *   - as devoluções: o crédito do terceiro (CNPJ ou nome) liga ao item de
 *     mesmo valor, ou a todos quando a soma bate; ambíguo ou de antes, não;
 *   - as pendências: o saldo a receber e o item sem o débito — avisos;
 *   - a classificação pela origem "terceiro";
 *   - a pasta do pacote (o débito e o comprovante, sem cobrar nota da empresa).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('./terceiros');
const classificacao = require('../classificacao/classificacao');
const liquidacoes = require('../conciliacao/liquidacoes');
const pagamentos = require('../pacote/pagamentos');

const EMPRESA = '11444777000161';
const ARTDECO = '12345678000195';
const cp = (id, extra = {}) => ({
  id, situacao: 'ligado', movimento_id: 700 + id, tipo: 'boleto', data: '2026-09-15', valor: 550, favorecido_nome: 'PATRIMONIUM CONTABILIDADE',
  pagador_nome: 'ARTDECO MOVEIS LTDA', pagador_documento: ARTDECO, ...extra
});

test('o comprovante com o pagador de fora vira o item a receber; o da empresa, o mascarado e o sem extrato, não', () => {
  assert.deepEqual(t.itemDoComprovante(cp(1), EMPRESA), {
    terceiro_nome: 'ARTDECO MOVEIS LTDA', terceiro_documento: ARTDECO, data: '2026-09-15', valor: 550, competencia: '2026-09', movimento_id: 701, comprovante_id: 1, origem: 'comprovante',
    descricao: 'Boleto de PATRIMONIUM CONTABILIDADE pago pela empresa em nome de ARTDECO MOVEIS LTDA'
  });
  assert.equal(t.itemDoComprovante(cp(2, { pagador_documento: EMPRESA }), EMPRESA), null);
  assert.equal(t.itemDoComprovante(cp(3, { pagador_documento: '***.456.789-**' }), EMPRESA), null);
  assert.equal(t.itemDoComprovante(cp(4, { situacao: 'novo', movimento_id: null }), EMPRESA), null);
  assert.equal(t.itemDoComprovante(cp(5), ''), null, 'sem o CNPJ da empresa na Configuração fiscal, nada');
  assert.equal(t.palavraChave('ARTDECO MOVEIS LTDA'), 'ARTDECO');
  assert.equal(t.palavraChave('CIA DE SANEAMENTO DE MG'), 'SANEAMENTO');
});

const item = (id, valor, data = '2026-09-15', extra = {}) => ({ id, terceiro_nome: 'ARTDECO MOVEIS LTDA', terceiro_documento: ARTDECO, data, valor, competencia: data.slice(0, 7), situacao: 'aberto', ...extra });
const credito = (id, data, valor, descricao, extra = {}) => ({ id, data, valor, descricao, estado_conciliacao: 'pendente', ...extra });

test('o que voltou e o que falta; as devoluções: mesmo valor, a soma de todos, pelo CNPJ ou pelo nome; ambíguo ou de antes, não', () => {
  const vinculos = [{ alvo_tipo: 'terceiro_pago', alvo_id: 1, valor: 550 }, { alvo_tipo: 'terceiro_devolvido', alvo_id: 1, valor: 200 }];
  assert.deepEqual(t.situacaoDoItem(item(1, 550), vinculos), { devolvido: 200, restante: 350, situacao: 'aberto', debito_ligado: true });
  assert.equal(t.situacaoDoItem(item(1, 200), vinculos).situacao, 'quitado');
  assert.equal(t.situacaoDoItem(item(1, 550, '2026-09-15', { situacao: 'cancelado' }), []).situacao, 'cancelado');

  const itens = [item(1, 550), item(2, 842.65, '2026-09-20'), item(3, 19.8, '2026-09-25')];
  // Pelo CNPJ na descrição do Pix, o item de mesmo valor.
  const pix = credito(90, '2026-09-23', 550, `PIX - RECEBIDO - 23/09 14:32 ${ARTDECO} ARTDECO MOV`);
  assert.deepEqual(t.devolucoes({ itens, movimentos: [pix] }).map(d => [d.movimento.id, d.itens.map(i => [i.id, i.parte])]), [[90, [[1, 550]]]]);
  // Pelo nome (sem o CNPJ), a soma de todos os em aberto até o dia.
  const soma = credito(91, '2026-09-30', 1412.45, 'PIX - RECEBIDO - 30/09 ARTDECO MOV');
  assert.deepEqual(t.devolucoes({ itens, movimentos: [soma] }).map(d => d.itens.map(i => i.id)), [[1, 2, 3]]);
  // Valor que não bate com um item nem com a soma: fica para a mão. Débito, de outro, ou antes do pagamento: nunca.
  assert.deepEqual(t.devolucoes({ itens, movimentos: [credito(92, '2026-09-30', 100, 'PIX ARTDECO')] }), []);
  assert.deepEqual(t.devolucoes({ itens, movimentos: [credito(93, '2026-09-30', -550, 'PIX ARTDECO')] }), []);
  assert.deepEqual(t.devolucoes({ itens, movimentos: [credito(94, '2026-09-30', 550, 'PIX RECEBIDO BOSSI MOVEL')] }), []);
  assert.deepEqual(t.devolucoes({ itens, movimentos: [credito(95, '2026-09-10', 550, 'PIX ARTDECO')] }), [], 'a devolução de antes do pagamento não é dele');
  // Dois itens do mesmo valor: ambíguo, não liga sozinho.
  assert.deepEqual(t.devolucoes({ itens: [item(1, 550), item(4, 550)], movimentos: [pix] }), []);
});

test('as pendências: o saldo a receber de cada terceiro e o item sem o débito conciliado — avisos', () => {
  const dados = {
    itens: [item(1, 550), item(2, 842.65, '2026-09-20'), item(3, 19.8, '2026-10-02'), item(5, 99, '2026-09-21', { terceiro_nome: 'OUTRA LTDA', terceiro_documento: '22333444000155', situacao: 'cancelado' })],
    vinculos: [{ alvo_tipo: 'terceiro_pago', alvo_id: 1, valor: 550 }, { alvo_tipo: 'terceiro_devolvido', alvo_id: 1, valor: 550 }]
  };
  const p = t.pendencias({ competencia: '2026-09', dados });
  assert.deepEqual(p.map(x => [x.nivel, x.chave, x.titulo]), [
    ['aviso', `terceiro_saldo_doc_${ARTDECO}`, 'ARTDECO MOVEIS LTDA deve R$ 842,65 à empresa'],
    ['aviso', 'terceiros_sem_debito', '1 pagamento de terceiro sem o débito do extrato conciliado']
  ]);
  assert.deepEqual(p[0].filtro, { acao: 'terceiros' });
  assert.deepEqual(t.pendencias({ competencia: '2026-09', dados: null }), []);
});

test('a classificação: o pago e o devolvido de terceiro vão pela regra de origem "terceiro"', () => {
  const plano = [{ id: 7, nome: 'Créditos com terceiros', tipo: 'ativo', ativa: true, origem: 'manual' }];
  const regras = [{ id: 1, condicao_tipo: 'origem', valor: 'terceiro', sentido: 'ambos', conta_id: 7, prioridade: 0, ativa: true, origem: 'manual' }];
  const ctx = classificacao.contexto({ plano, regras });
  const liq = { chave: 'terceiro_pago:1', tipo: 'terceiro_pago', valor: -550, subtipo: 'terceiro', rotulo: 'Boleto' };
  const r = classificacao.efetiva({ id: 1, valor: -550, descricao: 'PAGAMENTO DE BOLETO', estado_conciliacao: 'conciliado' }, {
    vinculos: [{ alvo_tipo: 'terceiro_pago', alvo_id: 1 }], liqsPorChave: new Map([['terceiro_pago:1', liq]]), ctx
  });
  assert.deepEqual([r.conta, r.criterio], ['Créditos com terceiros', 'origem']);
});

test('o pacote: o pago em nome de terceiro ganha pasta com o débito e o comprovante, sem cobrar a nota da empresa', () => {
  const liq = liquidacoes.deTerceiro({ id: 1, data: '2026-09-15', valor: 550, descricao: 'Boleto de PATRIMONIUM CONTABILIDADE pago pela empresa em nome de ARTDECO MOVEIS LTDA', terceiro_nome: 'ARTDECO MOVEIS LTDA', terceiro_documento: ARTDECO }, 'terceiro_pago');
  const m = { id: 701, conta_id: 1, data: '2026-09-15', valor: -550, descricao: 'PAGAMENTO DE BOLETO', estado_conciliacao: 'conciliado' };
  const { pagamentos: [pag] } = pagamentos.planoDosPagamentos({
    competencia: '2026-09', liquidacoesLista: [liq], vinculosPorChave: new Map([[liq.chave, [{ movimento_id: 701, criterio: 'terceiro' }]]]),
    movimentosPorId: new Map([['701', m]]), comprovantesDoMovimento: new Map([['701', [{ id: 5, nome_arquivo: 'boleto.pdf' }]]])
  });
  assert.equal(pag.pasta, '001 15-09 ARTDECO MOVEIS LTDA 550,00');
  assert.deepEqual(pag.terceiro, { nome: 'ARTDECO MOVEIS LTDA', documento: '12.345.678/0001-95', rotulo: liq.rotulo });
  assert.deepEqual([pag.movimentos.map(x => x.id), pag.comprovantes.map(x => x.id), pag.faltas], [[701], [5], []]);
  assert.equal(liq.tipo_rotulo, 'Pago em nome de terceiro');
});
