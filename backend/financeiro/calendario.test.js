/**
 * Calendário dos pagamentos (backend/financeiro/calendario.js) e contas
 * puras da produção (backend/financeiro/producao.js): Páscoa e Sexta-feira
 * Santa, 5º dia útil com feriado nacional, feriado da tabela e sábado
 * opcional, dia 15 do mês seguinte; saldo por item e setor, valor por peça
 * (o estorno usa o valor com que o original foi fechado) e saldo negativo
 * por setor que passa para o próximo fechamento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cal = require('./calendario');
const producao = require('./producao');
const { estadoDosFechamentos } = require('./comissoes');

test('feriados nacionais: Páscoa móvel e os fixos', () => {
  assert.equal(cal.pascoa(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(cal.pascoa(2027).toISOString().slice(0, 10), '2027-03-28');
  const f2026 = cal.feriadosNacionais(2026).map(f => f.data);
  assert.ok(f2026.includes('2026-04-03'), 'Sexta-feira Santa');
  assert.ok(f2026.includes('2026-11-20'), 'Consciência Negra');
  assert.equal(f2026.length, 10);
});

test('5º dia útil: pula fim de semana, feriado nacional e o da tabela; sábado só se configurado', () => {
  assert.equal(cal.pagarProducaoAte('2026-09'), '2026-10-07');
  assert.equal(cal.pagarProducaoAte('2026-03'), '2026-04-08', 'Sexta-feira Santa (03/04) não conta');
  assert.equal(cal.pagarProducaoAte('2026-12'), '2027-01-08', '01/01 não conta');
  assert.equal(cal.pagarProducaoAte('2026-09', cal.PADRAO, [{ data: '2026-10-05', descricao: 'Municipal' }]), '2026-10-08');
  assert.equal(cal.pagarProducaoAte('2026-09', { ...cal.PADRAO, sabado_dia_util: true }), '2026-10-06', 'com sábado 03/10');
  assert.equal(cal.pagarProducaoAte('2026-09', { ...cal.PADRAO, producao_dia_util: 1 }), '2026-10-01');
  assert.equal(cal.pagarComissaoAte('2026-09'), '2026-10-15');
  assert.equal(cal.pagarComissaoAte('2026-12'), '2027-01-15');
  assert.equal(cal.pagarComissaoAte('2027-01', { comissao_dia_pagamento: 28 }), '2027-02-28');
});

test('produção: acumulado por item e processo, status e valor das pendentes', () => {
  const eventos = [
    { id: 1, pedido_id: 55, pedido_item_id: 501, produto_id: 10, etapa_id: 2, quantidade: 3, data_finalizacao: '2026-08-15', competencia: '2026-08', status: 'ativo' },
    { id: 2, pedido_id: 55, pedido_item_id: 501, produto_id: 10, etapa_id: 2, quantidade: 1, data_finalizacao: '2026-08-16', competencia: '2026-08', status: 'estornado' },
    { id: 3, pedido_id: 55, pedido_item_id: 501, produto_id: 10, etapa_id: 2, quantidade: -3, data_finalizacao: '2026-09-02', competencia: '2026-09', status: 'ativo', estorno_de: 1 }
  ];
  assert.equal(producao.acumulados(eventos).get('501:2'), 0);
  assert.equal(producao.acumulados(eventos.slice(0, 2)).get('501:2'), 3, 'estornado não conta');
  assert.deepEqual([[5, 0], [5, 3], [5, 5]].map(([p, f]) => producao.statusDoItem(p, f)), ['Não iniciado', 'Parcial', 'Finalizado']);
  assert.equal(producao.podeProduzir({ situacao: 'Produção' }), true);
  assert.equal(producao.podeProduzir({ situacao: 'Pendente' }), false);

  const fechamento = { id: 1, tipo: 'producao', competencia: '2026-08', status: 'fechado', total: 75, por_setor: JSON.stringify([{ setor_id: 2, setor: 'Acabamento', pecas: 3, total: 75 }]) };
  const itens = [{ id: 9, fechamento_id: 1, tipo_item: 'producao', producao_evento_id: 1, quantidade: 3, valor_unitario: '25.00', total: '75.00', setor: 'Acabamento', produto: 'POL-01 — Poltrona', detalhes: '{}' }];
  const estado = estadoDosFechamentos({ fechamentos: [fechamento], itens, pagamentos: [], tipo: 'producao' });
  const pend = producao.pendentes({
    eventos, estado, valores: [{ id: 1, etapa_id: 2, produto_id: null, tipo: 'valor', valor_unitario: '40', ativo: true }],
    itensPor: new Map([['501', { id: 501, pedido_id: 55, codigo: 'POL-01', nome: 'Poltrona', quantidade: 5, produto_id: 10 }]]),
    etapasPor: new Map([['2', { id: 2, nome: 'Acabamento', producao_ativa: true }]]), pedidosPor: new Map([['55', { id: 55, numero: '2548' }]]),
    filaDe: () => [1, 1, 1, 1, 1], precoDe: () => 1000
  });
  assert.equal(pend.length, 1, 'o fechado e o estornado não ficam pendentes');
  assert.equal(pend[0].total, -75, 'o estorno usa o valor com que o original foi fechado, não o de hoje (40 por peça)');
  assert.equal(pend[0].valor_unitario, 25, 'por peça (a quantidade do estorno é negativa)');
  assert.equal(pend[0].competencia, '2026-09');
  assert.equal(pend[0].setor, 'Acabamento');

  const set = producao.montarCompetencia({ pend, estado, competencia: '2026-09' });
  assert.equal(set.a_pagar, 0);
  assert.equal(set.a_compensar, -75);
  const fechSet = { id: 2, tipo: 'producao', competencia: '2026-09', status: 'fechado', total: 0, por_setor: JSON.stringify(set.setores) };
  const estadoOut = estadoDosFechamentos({ fechamentos: [fechamento, fechSet], itens, pagamentos: [], tipo: 'producao' });
  const saldos = producao.saldosAnteriores(estadoOut);
  assert.deepEqual(saldos.map(s => [s.setor, s.total, s.competencia]), [['Acabamento', -75, '2026-10']]);
  assert.equal(producao.montarCompetencia({ pend: [], estado: estadoOut, competencia: '2026-10' }).liquido, -75);
  assert.equal(producao.montarCompetencia({ pend: [], estado: estadoOut, competencia: '2026-08' }).fechado, true);
});
