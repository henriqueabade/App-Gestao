/**
 * O que o cliente já pagou e ainda não foi repassado (backend/financeiro/repasses.js)
 * — decisões do dono de 24/09/2026. O caso dele: as comissões de agosto
 * (R$ 554,40) venceram em 15/09 sem fechamento nem pagamento, e não apareciam
 * como atrasadas em lugar nenhum.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const comissoes = require('./comissoes');
const R = require('./repasses');

const CFG = { comissao_dia_pagamento: 15, producao_dia_util: 5, sabado_dia_util: false };

const benef = (valorCms, valorRoyalty) => [
  { tipo: 'cms', beneficiario: 'Marcia Lamounier', percentual: 5, valor: valorCms },
  { tipo: 'royalty', beneficiario: 'Barral & Lamounier', percentual: 5, valor: valorRoyalty }
];
const item = (competencia, cms, royalty, extra = {}) => ({
  tipo_item: 'parcela', pedido_id: 104, numero_parcela: 1, competencia, competencia_natural: competencia, data_referencia: `${competencia}-20`,
  cms, royalty, total: cms + royalty, detalhes: { beneficiarios: benef(cms, royalty) }, ...extra
});
// `apuradas` só precisa dos itens pendentes de cada parcela.
const apuradas = itens => [{ pendentes: itens }];
const semFechamento = () => comissoes.estadoDosFechamentos({ fechamentos: [], itens: [], pagamentos: [], tipo: 'comissao' });

test('agosto sem fechar, prazo 15/09: em 24/09 está atrasada "a repassar"; no dia 15 ainda não', () => {
  const estado = semFechamento();
  const lista = apuradas([item('2026-08', 277.2, 277.2), item('2026-09', 277.24, 277.24)]);
  const atrasadas = R.deComissao({ estado, apuradas: lista, configuracao: CFG, referencia: '2026-09-24' });
  assert.equal(atrasadas.length, 1, 'setembro ainda não venceu (paga-se até 15/10)');
  const [agosto] = atrasadas;
  assert.deepEqual([agosto.competencia, agosto.pagar_ate, agosto.situacao, agosto.valor, agosto.dias_atraso], ['2026-08', '2026-09-15', 'nao_fechada', 554.4, 9]);
  assert.equal(agosto.situacao_texto, 'competência não fechada');
  assert.deepEqual(agosto.beneficiarios.map(b => [b.beneficiario, b.valor]).sort(), [['Barral & Lamounier', 277.2], ['Marcia Lamounier', 277.2]]);
  assert.equal(agosto.itens.length, 1, 'os itens que o fechamento de agosto levaria');

  assert.deepEqual(R.deComissao({ estado, apuradas: lista, configuracao: CFG, referencia: '2026-09-15' }), [], 'no dia do prazo ainda é "a pagar"');
  assert.deepEqual(R.resumir(atrasadas), { valor: 554.4, competencias: ['2026-08'], rotulo: 'agosto/2026' });
});

test('fechada e não paga: continua atrasada até o pagamento; paga em parte, só o que falta e para quem falta', () => {
  const fechamento = {
    id: 9, tipo: 'comissao', competencia: '2026-08', status: 'fechado', total: 554.4, pagar_ate: '2026-09-15', fechado_em: '2026-09-02T13:00:00Z',
    por_setor: JSON.stringify([{ tipo: 'cms', beneficiario: 'Marcia Lamounier', valor: 277.2 }, { tipo: 'royalty', beneficiario: 'Barral & Lamounier', valor: 277.2 }])
  };
  const estado = pagamentos => comissoes.estadoDosFechamentos({ fechamentos: [fechamento], itens: [], pagamentos, tipo: 'comissao' });

  const [naoPaga] = R.deComissao({ estado: estado([]), apuradas: [], configuracao: CFG, referencia: '2026-10-03' });
  assert.deepEqual([naoPaga.situacao, naoPaga.valor, naoPaga.situacao_texto, naoPaga.dias_atraso], ['fechada', 554.4, 'fechada, falta pagar', 18], 'passa de mês em mês');

  const pagouMarcia = [{ id: 1, fechamento_id: 9, valor: 277.2, data_pagamento: '2026-09-20', beneficiario: 'Marcia Lamounier', tipo_comissao: 'cms' }];
  const [emParte] = R.deComissao({ estado: estado(pagouMarcia), apuradas: [], configuracao: CFG, referencia: '2026-09-24' });
  assert.deepEqual([emParte.situacao, emParte.valor, emParte.pago], ['paga_em_parte', 277.2, 277.2]);
  assert.deepEqual(emParte.beneficiarios.map(b => b.beneficiario), ['Barral & Lamounier'], 'só quem ainda não recebeu');

  // Foto do fim de setembro... se o pagamento foi em outubro, em 30/09 ainda estava em aberto.
  const pagouTudoDepois = [{ id: 2, fechamento_id: 9, valor: 554.4, data_pagamento: '2026-10-02', beneficiario: null, tipo_comissao: null }];
  assert.equal(R.deComissao({ estado: estado(pagouTudoDepois), apuradas: [], configuracao: CFG, referencia: '2026-09-30' })[0].valor, 554.4);
  assert.deepEqual(R.deComissao({ estado: estado(pagouTudoDepois), apuradas: [], configuracao: CFG, referencia: '2026-10-05' }), [], 'pago: sai');
});

test('fechada DEPOIS da foto: naquela data ela ainda não estava fechada', () => {
  const fechamento = { id: 9, tipo: 'comissao', competencia: '2026-08', status: 'fechado', total: 100, pagar_ate: '2026-09-15', fechado_em: '2026-10-01T12:00:00Z', por_setor: '[]' };
  const estado = comissoes.estadoDosFechamentos({ fechamentos: [fechamento], itens: [], pagamentos: [], tipo: 'comissao' });
  const [r] = R.deComissao({ estado, apuradas: [], configuracao: CFG, referencia: '2026-09-30' });
  assert.deepEqual([r.situacao, r.valor], ['nao_fechada', 100]);
});

test('produção: competência vencida sem fechar ou sem pagar, com os processos', () => {
  const vazio = comissoes.estadoDosFechamentos({ fechamentos: [], itens: [], pagamentos: [], tipo: 'producao' });
  const pend = [
    { tipo_item: 'producao', competencia: '2026-08', setor_id: 1, setor: 'Marcenaria', quantidade: 2, total: 300, pedido_item_id: 5 },
    { tipo_item: 'producao', competencia: '2026-09', setor_id: 1, setor: 'Marcenaria', quantidade: 1, total: 150, pedido_item_id: 6 }
  ];
  // O 5º dia útil de setembro/2026 é 08/09 (7/9 é feriado).
  const [agosto, ...resto] = R.deProducao({ estado: vazio, pend, configuracao: CFG, referencia: '2026-09-24' });
  assert.equal(resto.length, 0);
  assert.deepEqual([agosto.tipo, agosto.competencia, agosto.pagar_ate, agosto.valor, agosto.situacao], ['producao', '2026-08', '2026-09-08', 300, 'nao_fechada']);
  assert.deepEqual(agosto.setores, [{ setor: 'Marcenaria', pecas: 2, total: 300 }]);
  assert.deepEqual(R.deProducao({ estado: vazio, pend, configuracao: CFG, referencia: '2026-09-08' }), [], 'no 5º dia útil ainda está no prazo');
});

test('quem recebe, somando as competências em atraso; e a lista sem os itens', () => {
  const lista = [
    { competencia: '2026-07', valor: 100, beneficiarios: [{ tipo: 'cms', beneficiario: 'Ana', valor: 100 }], itens: [{}] },
    { competencia: '2026-08', valor: 150, beneficiarios: [{ tipo: 'cms', beneficiario: 'Ana', valor: 50 }, { tipo: 'royalty', beneficiario: 'Bia', valor: 100 }], itens: [] }
  ];
  assert.deepEqual(R.beneficiariosSomados(lista).map(b => [b.beneficiario, b.valor]), [['Ana', 150], ['Bia', 100]]);
  assert.ok(R.semItens(lista).every(r => !('itens' in r)));
  assert.equal(R.resumir(lista).rotulo, 'julho/2026, agosto/2026');
});
