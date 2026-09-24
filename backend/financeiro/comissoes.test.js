/**
 * Motor das comissões (backend/financeiro/comissoes.js) — contas puras.
 *
 * O que se prende: regra mais específica vale (pedido > cliente > todos) e
 * regras do mesmo nível somam; a parcela recebida entra na competência do
 * recebimento pelo valor líquido (ajuste antes do fechamento reduz a base);
 * depois de fechada, nada é reescrito — devolução vira ajuste negativo na
 * próxima competência (o exemplo da especificação: −R$ 300 de CMS e −R$ 300
 * de Royalty), estorno do recebimento desfaz o fechado, trocar a regra não
 * mexe no que foi fechado; saldo negativo passa para o mês seguinte;
 * recebimento com data de mês já fechado cai no próximo; atrasadas e aging.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const contasReceber = require('../cobranca/contasReceber');
const regras = require('./regras');
const m = require('./comissoes');

const HOJE = '2026-09-16';
const REGRAS = [
  { id: 1, tipo: 'cms', beneficiario: 'Arquiteta Ana', percentual: '10.0000', escopo: 'todos', ativo: true },
  { id: 2, tipo: 'royalty', beneficiario: 'Marca Santíssimo', percentual: '10', escopo: 'todos', ativo: true }
];

function cenario({ recebimentos = [], ajustes = [], regrasLista = REGRAS, fechamentos = [], itens = [], pagamentos = [], parcelas = null, pedidos = null, hoje = HOJE } = {}) {
  const tab = {
    pedidos: pedidos || [{ id: 55, numero: '2548', situacao: 'Enviado', cliente_id: 7 }, { id: 60, numero: '2560', situacao: 'Enviado', cliente_id: 8 }],
    parcelas: parcelas || [
      { id: 1, pedido_id: 55, numero_parcela: 1, valor: '20000.00', data_vencimento: '2026-08-25' },
      { id: 2, pedido_id: 55, numero_parcela: 2, valor: '20000.00', data_vencimento: '2026-10-25' },
      { id: 3, pedido_id: 60, numero_parcela: 1, valor: '10000.00', data_vencimento: '2026-07-01' }
    ]
  };
  const linhas = contasReceber.parcelasDosPedidos({ pedidos: tab.pedidos, parcelas: tab.parcelas, recebimentos, boletos: [], notas: [], clientes: [], hoje });
  const estado = m.estadoDosFechamentos({ fechamentos, itens, pagamentos, tipo: 'comissao' });
  return { apuradas: m.apurar({ linhas, pedidos: tab.pedidos, parcelas: tab.parcelas, recebimentos, ajustes, regrasLista, estado, hoje }), estado };
}

const recebido = (id, pedido, numero, data, extra = {}) => ({
  id, pedido_id: pedido, numero_parcela: numero, status: 'confirmado', data_recebimento: data, competencia: data.slice(0, 7),
  valor_parcela: pedido === 60 ? '10000.00' : '20000.00', valor_abatimento: '0', valor_recebido: '20000.00', ...extra
});

/** Congela os pendentes de uma competência como o fechamentos.fechar faria. */
function congelar(apuradas, estado, competencia, { fechamentoId, itemId = 100, pago = false } = {}) {
  const r = m.montarFechamento({ apuradas, estado, competencia });
  const fechamento = { id: fechamentoId, tipo: 'comissao', competencia, status: 'fechado', total: r.a_pagar, pagar_ate: '2026-10-15', por_setor: JSON.stringify(r.beneficiarios) };
  const itens = r.itens.map((i, n) => ({
    id: itemId + n, fechamento_id: fechamentoId, tipo_item: i.tipo_item, pedido_id: i.pedido_id, numero_parcela: i.numero_parcela,
    recebimento_id: i.tipo_item === 'parcela' ? i.recebimento_id : null, competencia_origem: i.competencia_natural, data_referencia: i.data_referencia,
    base: i.base, pct_cms: i.pct_cms, pct_royalty: i.pct_royalty, cms: String(i.cms), royalty: String(i.royalty), total: String(i.total),
    detalhes: JSON.stringify({ ...i.detalhes, motivo: i.motivo || null })
  }));
  return { fechamento, itens, pagamento: pago ? { id: 900 + fechamentoId, fechamento_id: fechamentoId, data_pagamento: '2026-09-10' } : null, resumo: r };
}

test('regras: pedido > cliente > todos; o mesmo nível soma; 0% no pedido tira a comissão só dele', () => {
  const lista = [
    ...REGRAS,
    { id: 3, tipo: 'cms', beneficiario: 'Arquiteto Beto', percentual: 6, escopo: 'cliente', cliente_id: 7, ativo: true },
    { id: 4, tipo: 'cms', beneficiario: 'Arquiteta Carla', percentual: 4, escopo: 'cliente', cliente_id: 7, ativo: true },
    { id: 5, tipo: 'cms', beneficiario: 'Ninguém', percentual: 0, escopo: 'pedido', pedido_id: 99, ativo: true },
    { id: 6, tipo: 'royalty', beneficiario: 'Desligada', percentual: 50, escopo: 'todos', ativo: false }
  ];
  const doCliente = regras.taxasDoPedido(lista, { id: 55, cliente_id: 7 });
  assert.equal(doCliente.pct_cms, 10);
  assert.deepEqual(doCliente.cms.map(r => r.beneficiario), ['Arquiteta Carla', 'Arquiteto Beto']);
  assert.equal(doCliente.pct_royalty, 10, 'royalty sem regra do cliente usa a de todos (a desligada não conta)');
  assert.equal(regras.taxasDoPedido(lista, { id: 60, cliente_id: 8 }).pct_cms, 10);
  const zero = regras.taxasDoPedido(lista, { id: 99, cliente_id: 7 });
  assert.equal(zero.pct_cms, 0);
  assert.equal(zero.sem_regra, false, '0% é regra, não falta de regra');
  assert.equal(regras.taxasDoPedido([], { id: 1 }).sem_regra, true);
  const v = regras.valoresSobre(17000, doCliente);
  assert.deepEqual(v.beneficiarios.map(b => [b.beneficiario, b.valor]), [['Arquiteta Carla', 680], ['Arquiteto Beto', 1020], ['Marca Santíssimo', 1700]]);
  assert.equal(v.total, 3400);
});

test('valor por peça: o da peça vale mais que o padrão do setor; sem nenhum, null', () => {
  const valores = [
    { id: 1, setor_id: 1, produto_id: null, valor_unitario: '30.00', ativo: true },
    { id: 2, setor_id: 1, produto_id: 10, valor_unitario: '45.50', ativo: true },
    { id: 3, setor_id: 2, produto_id: 10, valor_unitario: '99', ativo: false }
  ];
  assert.deepEqual(regras.valorUnitario(valores, 10, 1), { valor: 45.5, origem: 'peca', valor_id: 2 });
  assert.deepEqual(regras.valorUnitario(valores, 11, 1), { valor: 30, origem: 'padrao', valor_id: 1 });
  assert.equal(regras.valorUnitario(valores, 10, 2), null);
});

test('parcela recebida entra na competência do recebimento pelo valor líquido; atrasada e prevista ficam de fora', () => {
  const ajuste = { id: 7, pedido_id: 55, numero_parcela: 1, tipo: 'desconto', valor: '3000.00', data_ajuste: '2026-08-21', status: 'ativo' };
  const { apuradas, estado } = cenario({ recebimentos: [recebido(1, 55, 1, '2026-08-20')], ajustes: [ajuste] });
  const p1 = apuradas.find(p => p.chave === '55:1');
  assert.equal(p1.situacao, 'apurada');
  assert.equal(p1.liquido, 17000, 'ajuste antes do fechamento reduz a base');
  assert.deepEqual(p1.pendentes.map(i => [i.tipo_item, i.competencia, i.cms, i.royalty]), [['parcela', '2026-08', 1700, 1700]]);
  assert.equal(apuradas.find(p => p.chave === '55:2').situacao, 'prevista');
  const atrasada = apuradas.find(p => p.chave === '60:1');
  assert.equal(atrasada.situacao, 'atrasada');
  assert.equal(atrasada.faixa, '61–90');
  assert.equal(atrasada.potencial.total, 2000);

  const ago = m.montarFechamento({ apuradas, estado, competencia: '2026-08' });
  assert.equal(ago.parcelas, 1);
  assert.equal(ago.base, 17000);
  assert.equal(ago.comissao, 3400);
  assert.equal(ago.a_pagar, 3400);
  assert.equal(m.montarFechamento({ apuradas, estado, competencia: '2026-07' }).itens.length, 0);
  assert.equal(m.montarFechamento({ apuradas, estado, competencia: '2026-09' }).itens.length, 1, 'o primeiro fechamento leva o que ficou de antes');

  const v = m.visoes(apuradas);
  assert.deepEqual(v.atrasadas.map(p => p.chave), ['60:1']);
  assert.deepEqual(v.previstas.map(p => p.chave), ['55:2']);
  assert.deepEqual(m.aging(v.atrasadas).map(f => `${f.faixa}:${f.parcelas}:${f.comissao}`), ['1–15:0:0', '16–30:0:0', '31–60:0:0', '61–90:1:2000', '+90:0:0']);
});

test('exemplo da especificação: fechada sobre R$ 20.000 a 10% + 10%; devolução de R$ 3.000 → −R$ 300 e −R$ 300 no próximo fechamento', () => {
  const recs = [recebido(1, 55, 1, '2026-08-20')];
  const antes = cenario({ recebimentos: recs });
  const ago = congelar(antes.apuradas, antes.estado, '2026-08', { fechamentoId: 1, pago: true });
  assert.equal(ago.resumo.a_pagar, 4000);

  const devolucao = { id: 8, pedido_id: 55, numero_parcela: 1, tipo: 'devolucao', valor: '3000', data_ajuste: '2026-09-05', status: 'ativo' };
  const depois = cenario({ recebimentos: recs, ajustes: [devolucao], fechamentos: [ago.fechamento], itens: ago.itens, pagamentos: [ago.pagamento] });
  assert.equal(depois.estado.proxima, '2026-09');
  const p1 = depois.apuradas.find(p => p.chave === '55:1');
  assert.equal(p1.situacao, 'paga');
  assert.equal(p1.taxas.congeladas, true);
  assert.equal(p1.pendentes.length, 1);
  const ajuste = p1.pendentes[0];
  assert.equal(ajuste.tipo_item, 'ajuste');
  assert.equal(ajuste.competencia, '2026-09');
  assert.equal(ajuste.cms, -300);
  assert.equal(ajuste.royalty, -300);
  assert.match(ajuste.motivo, /Devolução de R\$\s3\.000,00 em 05\/09\/2026/);

  const set = m.montarFechamento({ apuradas: depois.apuradas, estado: depois.estado, competencia: '2026-09' });
  assert.equal(set.ajustes, -600);
  assert.equal(set.a_pagar, 0, 'saldo negativo não se paga');
  assert.equal(set.a_compensar, -600);
  assert.equal(m.montarFechamento({ apuradas: depois.apuradas, estado: depois.estado, competencia: '2026-08' }).fechado, true, 'o fechado não muda');
  assert.equal(m.montarFechamento({ apuradas: depois.apuradas, estado: depois.estado, competencia: '2026-08' }).a_pagar, 4000);

  // Setembro fecha no negativo; outubro recebe o saldo e uma parcela nova.
  const setF = congelar(depois.apuradas, depois.estado, '2026-09', { fechamentoId: 2, itemId: 200 });
  const recsOut = [...recs, recebido(2, 55, 2, '2026-10-02')];
  const out = cenario({ recebimentos: recsOut, ajustes: [devolucao], fechamentos: [ago.fechamento, setF.fechamento], itens: [...ago.itens, ...setF.itens], pagamentos: [ago.pagamento], hoje: '2026-10-05' });
  assert.equal(out.apuradas.find(p => p.chave === '55:1').pendentes.length, 0, 'a devolução já foi fechada: não se repete');
  const outubro = m.montarFechamento({ apuradas: out.apuradas, estado: out.estado, competencia: '2026-10' });
  assert.deepEqual(outubro.itens.map(i => i.tipo_item).sort(), ['parcela', 'saldo', 'saldo']);
  assert.equal(outubro.comissao, 4000);
  assert.equal(outubro.ajustes, -600);
  assert.equal(outubro.a_pagar, 3400);
  assert.deepEqual(outubro.beneficiarios.map(b => [b.beneficiario, b.valor]), [['Arquiteta Ana', 1700], ['Marca Santíssimo', 1700]]);
});

test('depois de fechada: trocar a regra não mexe; estornar o recebimento desfaz; receber de novo entra como parcela', () => {
  const recs = [recebido(1, 55, 1, '2026-08-20')];
  const antes = cenario({ recebimentos: recs });
  const ago = congelar(antes.apuradas, antes.estado, '2026-08', { fechamentoId: 1 });

  const novaRegra = [{ ...REGRAS[0], percentual: 20 }, REGRAS[1]];
  const trocada = cenario({ recebimentos: recs, regrasLista: novaRegra, fechamentos: [ago.fechamento], itens: ago.itens });
  const p1 = trocada.apuradas.find(p => p.chave === '55:1');
  assert.equal(p1.pendentes.length, 0, 'fechado com 10%: continua 10%');
  assert.equal(p1.situacao, 'fechada');
  assert.equal(trocada.apuradas.find(p => p.chave === '55:2').potencial.cms, 4000, 'o que não foi fechado usa a regra nova');

  const estornado = [{ ...recs[0], status: 'estornado', estornado_em: '2026-09-03T15:00:00Z' }];
  const est = cenario({ recebimentos: estornado, fechamentos: [ago.fechamento], itens: ago.itens });
  const pe = est.apuradas.find(p => p.chave === '55:1');
  assert.deepEqual(pe.pendentes.map(i => [i.tipo_item, i.competencia, i.cms, i.royalty]), [['ajuste', '2026-09', -2000, -2000]]);
  assert.match(pe.pendentes[0].motivo, /Recebimento estornado/);
  assert.equal(pe.situacao, 'atrasada');

  // Estorno fechado em setembro; recebido de novo em outubro: parcela nova, sem desfazer de novo.
  const setF = congelar(est.apuradas, est.estado, '2026-09', { fechamentoId: 2, itemId: 200 });
  const denovo = [...estornado, recebido(3, 55, 1, '2026-10-01')];
  const out = cenario({ recebimentos: denovo, fechamentos: [ago.fechamento, setF.fechamento], itens: [...ago.itens, ...setF.itens], hoje: '2026-10-02' });
  const po = out.apuradas.find(p => p.chave === '55:1');
  assert.deepEqual(po.pendentes.map(i => [i.tipo_item, i.competencia, i.total]), [['parcela', '2026-10', 4000]]);

  // Estornado e recebido de novo antes de fechar o estorno: desfaz e lança no mesmo fechamento.
  const junto = cenario({ recebimentos: [...estornado, recebido(3, 55, 1, '2026-09-10')], fechamentos: [ago.fechamento], itens: ago.itens });
  assert.deepEqual(junto.apuradas.find(p => p.chave === '55:1').pendentes.map(i => [i.tipo_item, i.total]).sort(), [['ajuste', -4000], ['parcela', 4000]]);
});

test('recebimento com data de mês já fechado cai na próxima competência; pedido cancelado desfaz o fechado', () => {
  const recs = [recebido(1, 55, 1, '2026-08-20')];
  const antes = cenario({ recebimentos: recs });
  const ago = congelar(antes.apuradas, antes.estado, '2026-08', { fechamentoId: 1 });
  const tardio = cenario({ recebimentos: [...recs, recebido(2, 60, 1, '2026-08-30')], fechamentos: [ago.fechamento], itens: ago.itens });
  const item = tardio.apuradas.find(p => p.chave === '60:1').pendentes[0];
  assert.equal(item.competencia_natural, '2026-08');
  assert.equal(item.competencia, '2026-09');

  const cancelado = cenario({
    recebimentos: recs, fechamentos: [ago.fechamento], itens: ago.itens,
    pedidos: [{ id: 55, numero: '2548', situacao: 'Cancelado', cliente_id: 7 }, { id: 60, numero: '2560', situacao: 'Enviado', cliente_id: 8 }]
  });
  const pc = cancelado.apuradas.find(p => p.chave === '55:1');
  assert.equal(pc.situacao, 'nao_realizada');
  assert.deepEqual(pc.pendentes.map(i => [i.tipo_item, i.total]), [['ajuste', -4000]]);
  assert.match(pc.pendentes[0].motivo, /Pedido cancelado/);
});

test('diaEmBrasilia e faixas de atraso', () => {
  assert.equal(m.diaEmBrasilia('2026-09-17T02:30:00Z'), '2026-09-16');
  assert.equal(m.diaEmBrasilia('2026-09-16'), '2026-09-16');
  assert.deepEqual([1, 15, 16, 30, 31, 60, 61, 90, 91].map(m.faixaDeAtraso), ['1–15', '1–15', '16–30', '16–30', '31–60', '31–60', '61–90', '61–90', '+90']);
});

test('visão do mês: a atrasada passa para os meses seguintes até ser paga; o mês passado é a foto do fim dele (dono, 24/09/2026)', () => {
  const HOJE_VM = '2026-09-24';
  const parcela = (chave, vencimento, extra = {}) => ({ chave, vencimento, controlada: true, situacao: 'prevista', recebimento: null, potencial: { total: 100 }, ...extra });
  const apuradas = [
    // Venceu em agosto e foi paga em setembro: em agosto, atrasada; em setembro, fora (apurada).
    parcela('ago-paga-set', '2026-08-20', { situacao: 'apurada', recebimento: { data: '2026-09-18' } }),
    // Vence no domingo 30/08: no fim de agosto (segunda 31/08) ainda está em dia → prevista de agosto.
    parcela('ago-domingo', '2026-08-30', { situacao: 'apurada', recebimento: { data: '2026-08-31' } }),
    parcela('ago-domingo-aberta', '2026-08-30'),
    // Vence no domingo 20/09 e não foi paga: atrasada em setembro e em outubro.
    parcela('set-atrasada', '2026-09-20', { situacao: 'atrasada' }),
    parcela('set-prevista', '2026-09-28'),
    parcela('out-prevista', '2026-10-19'),
    parcela('fora-do-controle', '2026-09-01', { controlada: false }),
    parcela('cancelada', '2026-09-02', { situacao: 'nao_realizada' }),
    parcela('no-banco', '2026-09-03', { situacao: 'a_lancar' })
  ];
  const chaves = l => l.map(p => p.chave);

  const ago = m.visaoDoMes(apuradas, { competencia: '2026-08', hoje: HOJE_VM });
  assert.equal(ago.referencia, '2026-08-31', 'mês passado: a foto do fim dele');
  assert.deepEqual(chaves(ago.atrasadas), ['ago-paga-set'], 'paga depois, estava atrasada no fim de agosto');
  assert.equal(ago.atrasadas[0].dias_atraso, 11);
  assert.deepEqual(chaves(ago.previstas), ['ago-domingo-aberta'], 'vence no domingo: vale até segunda, ainda prevista');

  const set = m.visaoDoMes(apuradas, { competencia: '2026-09', hoje: HOJE_VM });
  assert.equal(set.referencia, HOJE_VM, 'mês corrente: hoje');
  assert.deepEqual(chaves(set.atrasadas), ['ago-domingo-aberta', 'set-atrasada'], 'a de agosto não paga continua atrasada em setembro');
  assert.deepEqual(set.atrasadas.map(p => [p.dias_atraso, p.faixa]), [[25, '16–30'], [4, '1–15']]);
  assert.deepEqual(chaves(set.previstas), ['set-prevista']);

  const out = m.visaoDoMes(apuradas, { competencia: '2026-10', hoje: HOJE_VM });
  assert.deepEqual(chaves(out.atrasadas), ['ago-domingo-aberta', 'set-atrasada'], 'passam para outubro enquanto não forem pagas');
  assert.deepEqual(chaves(out.previstas), ['out-prevista']);

  // Pagou (boleto ou o modal "Pagamentos"): sai das atrasadas.
  const paga = apuradas.map(p => (p.chave === 'set-atrasada' ? { ...p, situacao: 'apurada', recebimento: { data: '2026-09-24' } } : p));
  assert.deepEqual(chaves(m.visaoDoMes(paga, { competencia: '2026-09', hoje: HOJE_VM }).atrasadas), ['ago-domingo-aberta']);
  assert.equal(m.ultimoDiaDoMes('2026-02'), '2026-02-28');
});
