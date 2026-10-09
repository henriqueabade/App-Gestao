/**
 * O negativo da produção é DO COLABORADOR (decisão do dono, 09/10/2026:
 * "quem recebeu a mais é quem devolve"). Com o rateio em uso, o mês sai por
 * colaborador, processo a processo: paga-se cada parte positiva, e a negativa
 * passa para o mês seguinte com o nome de quem deve. Sem colaborador
 * cadastrado, tudo continua por processo, como antes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const rateios = require('./rateios');
const producao = require('./producao');

const COLABORADORES = [{ id: 1, nome: 'João' }, { id: 2, nome: 'Pedro' }];
// A Marcenaria (setor 10) da peça 501 é 50% João e 50% Pedro.
const RATEIOS = [
  { id: 1, pedido_item_id: 501, setor_id: 10, colaborador_id: 1, percentual: 50, ativo: true },
  { id: 2, pedido_item_id: 501, setor_id: 10, colaborador_id: 2, percentual: 50, ativo: true }
];
const producaoDaPeca = (total, extra = {}) => ({ tipo_item: 'producao', pedido_item_id: 501, setor_id: 10, setor: 'Marcenaria', total, competencia: '2026-11', quantidade: 1, ...extra });
const estadoAberto = (divisao, extra = {}) => ({ fechados: new Map(), ultimo: null, proxima: '2026-11', congelados: [], divisao, ...extra });

test('partes do mês: a produção da peça pelo rateio, o ajuste e o restante inteiros para o colaborador', () => {
  const partes = rateios.partesDoMes({
    linhas: [
      producaoDaPeca(600), producaoDaPeca(400),
      { tipo_item: 'ajuste', setor_id: 10, setor: 'Marcenaria', colaborador_id: 1, colaborador: 'João', total: -500 },
      { tipo_item: 'saldo', setor_id: 10, setor: 'Marcenaria', colaborador_id: 2, colaborador: 'Pedro', total: -50 },
      { tipo_item: 'ajuste', setor_id: 10, setor: 'Marcenaria', colaborador_id: null, total: 30 }
    ],
    rateios: RATEIOS, colaboradores: COLABORADORES
  });
  assert.equal(partes.length, 1);
  const m = partes[0];
  assert.equal(m.total, 480);
  const de = id => m.partes.find(p => p.colaborador_id === id)?.total;
  assert.equal(de(1), 0, 'João: 500 da produção − 500 do adiantamento');
  assert.equal(de(2), 450, 'Pedro: 500 − 50 que ele trouxe do mês anterior');
  assert.equal(de(null), 30, 'o ajuste sem colaborador fica no processo');
  assert.deepEqual(rateios.contaDasPartes(partes), { a_pagar: 480, a_compensar: 0 });
});

test('o exemplo do dono: o restante de −R$ 200 do João fica só com ele', () => {
  const linhas = [
    producaoDaPeca(1000),
    { tipo_item: 'saldo', setor_id: 10, setor: 'Marcenaria', colaborador_id: 1, colaborador: 'João', total: -200, competencia: '2026-11' }
  ];
  const comp = producao.montarCompetencia({ pend: linhas, estado: estadoAberto({ colaboradores: COLABORADORES, rateios: RATEIOS }), competencia: '2026-11' });
  const m = comp.por_colaborador.find(s => s.setor_id === 10);
  assert.equal(m.partes.find(p => p.colaborador_id === 1).total, 300, 'João: 500 − 200');
  assert.equal(m.partes.find(p => p.colaborador_id === 2).total, 500, 'Pedro recebe os 50% dele inteiros');
  assert.equal(comp.a_pagar, 800);
});

test('colaborador negativo num processo positivo: a parte dele não se paga e passa adiante com o nome dele', () => {
  const linhas = [
    producaoDaPeca(1000),
    { tipo_item: 'ajuste', setor_id: 10, setor: 'Marcenaria', colaborador_id: 1, colaborador: 'João', total: -700, competencia: '2026-11' }
  ];
  const estado = estadoAberto({ colaboradores: COLABORADORES, rateios: RATEIOS });
  const comp = producao.montarCompetencia({ pend: linhas, estado, competencia: '2026-11' });
  assert.equal(comp.setores[0].total, 300, 'o processo fechou positivo');
  assert.equal(comp.a_pagar, 500, 'paga só o Pedro');
  assert.equal(comp.a_compensar, -200, 'os −200 do João');
  // O fechamento guarda as partes; o mês seguinte recebe o restante do João.
  const resumo = comp.setores.map(s => ({ ...s, partes: comp.por_colaborador.find(x => x.setor_id === s.setor_id).partes }));
  const restantes = producao.saldosAnteriores({ ultimo: { id: 77, competencia: '2026-11', resumo }, proxima: '2026-12' });
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].total, -200);
  assert.equal(restantes[0].colaborador_id, 1);
  assert.equal(restantes[0].competencia, '2026-12');
  assert.match(restantes[0].motivo, /João \(Marcenaria\) terminou/);
  assert.match(restantes[0].produto, /· João$/);
});

test('sem colaborador cadastrado, tudo por processo como antes', () => {
  const linhas = [producaoDaPeca(1000), { tipo_item: 'ajuste', setor_id: 10, setor: 'Marcenaria', colaborador_id: 1, total: -1200, competencia: '2026-11' }];
  const comp = producao.montarCompetencia({ pend: linhas, estado: estadoAberto(null), competencia: '2026-11' });
  assert.equal(comp.por_colaborador, null);
  assert.equal(comp.a_pagar, 0);
  assert.equal(comp.a_compensar, -200);
  const restantes = producao.saldosAnteriores({ ultimo: { id: 1, competencia: '2026-11', resumo: comp.setores }, proxima: '2026-12' });
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].colaborador_id, null);
  assert.equal(restantes[0].total, -200);
});

test('rateio incompleto: o que não foi distribuído fica no processo; o centavo do 100% fica com quem tem mais', () => {
  const pela_metade = rateios.partesDoMes({ linhas: [producaoDaPeca(100)], rateios: [RATEIOS[0]], colaboradores: COLABORADORES });
  assert.deepEqual(pela_metade[0].partes.map(p => [p.colaborador_id, p.total]), [[1, 50], [null, 50]]);
  const terco = [1, 2, 3].map(id => ({ pedido_item_id: 501, setor_id: 10, colaborador_id: id, percentual: id === 1 ? 33.3334 : 33.3333, ativo: true }));
  const tres = rateios.partesDoMes({ linhas: [producaoDaPeca(100)], rateios: terco, colaboradores: [...COLABORADORES, { id: 3, nome: 'Ana' }] });
  assert.equal(tres[0].partes.reduce((s, p) => s + p.total, 0).toFixed(2), '100.00', 'nada se perde no arredondamento');
  assert.ok(tres[0].partes.every(p => p.colaborador_id !== null));
});

test('quem recebe no mês (a prévia do fechamento) soma a produção, os ajustes e o restante de cada um', () => {
  const partes = rateios.partesDoMes({
    linhas: [producaoDaPeca(1000), { tipo_item: 'ajuste', setor_id: 10, setor: 'Marcenaria', colaborador_id: 1, total: -700 }],
    rateios: RATEIOS, colaboradores: COLABORADORES
  });
  assert.deepEqual(rateios.totaisDasPartes(partes).map(r => [r.colaborador, r.valor]), [['Pedro', 500], ['João', -200]]);
});
