const test = require('node:test');
const assert = require('node:assert/strict');

const { planejarConsumo, agruparFaltantesPorProcesso } = require('./conversaoEstoque');

/**
 * Esta é a regra que decide o que sai do estoque numa conversão. Errar aqui só
 * apareceria depois de estragar o saldo real, então cada caso abaixo existe
 * porque tem consequência: peça marcada como pronta não pode gastar insumo, a
 * falta precisa ter dono, e o abatimento precisa levar o necessário inteiro —
 * não só a parte que havia.
 */

// Produto 1: 2 un de "Madeira" (Corte) + 1 un de "Verniz" (Acabamento)
const ROTA = new Map([
  [1, [
    { insumo_id: 10, quantidade: 2, ordem_insumo: 1, nome: 'Madeira', unidade: 'm', processo: 'Corte' },
    { insumo_id: 20, quantidade: 1, ordem_insumo: 2, nome: 'Verniz', unidade: 'L', processo: 'Acabamento' }
  ]],
  [2, [
    { insumo_id: 10, quantidade: 5, ordem_insumo: 1, nome: 'Madeira', unidade: 'm', processo: 'Corte' }
  ]]
]);

function estoque(mapa) {
  return new Map(Object.entries(mapa).map(([id, v]) => [Number(id), v]));
}

test('produzir do zero consome a rota inteira, multiplicada pela quantidade', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 3, qtd_usar_pronta: 0, qtd_a_produzir: 3 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  const madeira = plano.consumoPorInsumo.find(c => c.insumo_id === 10);
  const verniz = plano.consumoPorInsumo.find(c => c.insumo_id === 20);
  assert.equal(madeira.quantidade, 6, '2 por unidade × 3 peças');
  assert.equal(verniz.quantidade, 3, '1 por unidade × 3 peças');
  assert.equal(plano.temFalta, false);
});

test('peça tirada pronta do estoque NÃO consome insumo', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 3, qtd_usar_pronta: 3, qtd_a_produzir: 0 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.deepEqual(plano.consumoPorInsumo, [], 'a peça já estava produzida: gastar insumo de novo seria contar duas vezes');
  assert.equal(plano.pecasDeEstoque.length, 1);
  assert.equal(plano.pecasDeEstoque[0].pedido_item_id, 100);
  assert.equal(plano.pecasDeEstoque[0].quantidade, 3);
});

test('parte pronta e parte produzida: só a parte produzida consome', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 5, qtd_usar_pronta: 2, qtd_a_produzir: 3 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.equal(plano.consumoPorInsumo.find(c => c.insumo_id === 10).quantidade, 6, 'só as 3 produzidas');
  assert.equal(plano.pecasDeEstoque.length, 1);
  assert.equal(plano.pecasDeEstoque[0].quantidade, 2);
});

test('o abatimento leva o necessário INTEIRO, mesmo faltando em estoque', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 10, qtd_usar_pronta: 0, qtd_a_produzir: 10 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 5 }, 20: { quantidade: 100 } })
  });

  const madeira = plano.consumoPorInsumo.find(c => c.insumo_id === 10);
  assert.equal(madeira.quantidade, 20, 'precisa de 20; abate 20 e o saldo vai a -15');

  const falta = plano.faltantes.find(f => f.insumo_id === 10);
  assert.equal(falta.quantidade, 15, 'o que o estoque não cobria vira falta registrada');
  assert.equal(plano.temFalta, true);
});

test('a falta tem dono: é atribuída à peça, na ordem do pedido', () => {
  const plano = planejarConsumo({
    itens: [
      { pedido_item_id: 100, produto_id: 2, quantidade: 1, qtd_usar_pronta: 0, qtd_a_produzir: 1 }, // precisa 5
      { pedido_item_id: 200, produto_id: 2, quantidade: 1, qtd_usar_pronta: 0, qtd_a_produzir: 1 }  // precisa 5
    ],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 7 } })
  });

  // A primeira peça pega 5 (sobra 2); a segunda pega 2 e fica devendo 3.
  assert.equal(plano.faltantes.length, 1, 'só a segunda peça fica sem');
  assert.equal(plano.faltantes[0].pedido_item_id, 200);
  assert.equal(plano.faltantes[0].quantidade, 3);
  assert.equal(plano.consumoPorInsumo.find(c => c.insumo_id === 10).quantidade, 10, 'abate as duas peças inteiras');
});

test('insumo infinito nunca falta e nunca é abatido', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 1000, qtd_usar_pronta: 0, qtd_a_produzir: 1000 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 0, infinito: true }, 20: { quantidade: 5000 } })
  });

  assert.equal(plano.consumoPorInsumo.find(c => c.insumo_id === 10), undefined, 'infinito não entra no abatimento');
  assert.deepEqual(plano.faltantes.filter(f => f.insumo_id === 10), [], 'infinito nunca falta');
});

test('qtd_usar_pronta maior que a quantidade da peça é limitada', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 2, qtd_usar_pronta: 99, qtd_a_produzir: 0 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.equal(plano.pecasDeEstoque[0].quantidade, 2, 'não dá para tirar do estoque mais do que foi vendido');
});

test('sem decisão registrada, a peça é produzida do zero', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 4 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.equal(plano.consumoPorInsumo.find(c => c.insumo_id === 10).quantidade, 8);
  assert.deepEqual(plano.pecasDeEstoque, [], 'nada sai do estoque sem alguém ter escolhido');
});

test('produto sem rota cadastrada não quebra a conversão', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 999, quantidade: 3, qtd_a_produzir: 3 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({})
  });

  assert.deepEqual(plano.consumoPorInsumo, []);
  assert.deepEqual(plano.faltantes, []);
});

test('quantidades fracionadas mantêm as 4 casas das colunas numéricas', () => {
  const rota = new Map([[1, [
    { insumo_id: 10, quantidade: 0.0025, ordem_insumo: 1, nome: 'Cola', unidade: 'L', processo: 'Montagem' }
  ]]]);
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 3, qtd_a_produzir: 3 }],
    rotaPorProduto: rota,
    estoquePorInsumo: estoque({ 10: { quantidade: 0 } })
  });

  assert.equal(plano.consumoPorInsumo[0].quantidade, 0.0075);
  assert.equal(plano.faltantes[0].quantidade, 0.0075, '0,0075 não pode virar 0,01 nem 0');
});

// ===================================================================
// Agrupamento para o relatório: uma folha por processo
// ===================================================================

test('o relatório soma as peças dentro de cada processo', () => {
  const faltantes = [
    { pedido_item_id: 1, insumo_id: 10, insumo_nome: 'Madeira', unidade: 'm', processo: 'Corte', quantidade: 4 },
    { pedido_item_id: 2, insumo_id: 10, insumo_nome: 'Madeira', unidade: 'm', processo: 'Corte', quantidade: 6 },
    { pedido_item_id: 1, insumo_id: 20, insumo_nome: 'Verniz', unidade: 'L', processo: 'Acabamento', quantidade: 2 }
  ];

  const grupos = agruparFaltantesPorProcesso(faltantes);

  assert.equal(grupos.length, 2, 'um grupo por processo — cada um vira uma folha');
  const corte = grupos.find(g => g.processo === 'Corte');
  assert.equal(corte.itens.length, 1, 'o mesmo insumo em peças diferentes vira uma linha só');
  assert.equal(corte.itens[0].quantidade, 10, '4 + 6');

  const acabamento = grupos.find(g => g.processo === 'Acabamento');
  assert.equal(acabamento.itens[0].insumo_nome, 'Verniz');
  assert.equal(acabamento.itens[0].quantidade, 2);
});

test('faltante sem processo cadastrado ainda aparece no relatório', () => {
  const grupos = agruparFaltantesPorProcesso([
    { insumo_nome: 'Parafuso', unidade: 'un', processo: '', quantidade: 8 }
  ]);
  assert.equal(grupos[0].processo, 'Sem processo', 'esconder o item seria pior que agrupá-lo à parte');
  assert.equal(grupos[0].itens[0].quantidade, 8);
});

// ===================================================================
// De qual lote a peça pronta sai
//
// Um lote parado no meio da rota NÃO é peça pronta — é trabalho em andamento.
// Tratá-lo como pronto manda peça inacabada para o cliente.
// ===================================================================
const { escolherLotes } = require('./conversaoEstoque');

const LOTES = [
  { id: 1, quantidade: 2, ultimo_insumo_id: 99, etapa_id: 7, data_hora_completa: '2026-05-01T10:00:00Z' },
  { id: 2, quantidade: 5, ultimo_insumo_id: 99, etapa_id: 7, data_hora_completa: '2026-03-01T10:00:00Z' },
  { id: 3, quantidade: 9, ultimo_insumo_id: 50, etapa_id: 3, data_hora_completa: '2026-01-01T10:00:00Z' }
];

test('só lotes no fim da rota contam como peça pronta', () => {
  const { consumos } = escolherLotes(LOTES, 100, 99);
  const usados = consumos.map(c => c.lote_id);
  assert.ok(!usados.includes(3), 'o lote 3 parou no insumo 50: está no meio do processo');
  assert.deepEqual(usados, [2, 1], 'só os prontos');
});

test('consome do lote mais antigo primeiro (FIFO)', () => {
  const { consumos, restante } = escolherLotes(LOTES, 6, 99);
  assert.equal(consumos[0].lote_id, 2, 'o de março sai antes do de maio');
  assert.equal(consumos[0].quantidade, 5);
  assert.equal(consumos[1].lote_id, 1);
  assert.equal(consumos[1].quantidade, 1);
  assert.equal(restante, 0);
});

test('o que sobra no lote é calculado para a baixa', () => {
  const { consumos } = escolherLotes(LOTES, 3, 99);
  assert.equal(consumos[0].lote_id, 2);
  assert.equal(consumos[0].quantidade, 3);
  assert.equal(consumos[0].quantidade_restante_no_lote, 2, '5 - 3');
});

test('pedir mais do que existe devolve o que faltou, sem inventar estoque', () => {
  const { consumos, restante } = escolherLotes(LOTES, 20, 99);
  const total = consumos.reduce((a, c) => a + c.quantidade, 0);
  assert.equal(total, 7, 'só havia 7 prontas');
  assert.equal(restante, 13, 'o resto precisa ser avisado, não silenciado');
});

test('produto sem rota conhecida aceita qualquer lote', () => {
  const { consumos } = escolherLotes(LOTES, 100, null);
  assert.equal(consumos.length, 3, 'sem rota não dá para distinguir pronto de parcial');
});

test('lote zerado é ignorado', () => {
  const { consumos, restante } = escolherLotes(
    [{ id: 9, quantidade: 0, ultimo_insumo_id: 99, data_hora_completa: '2026-01-01' }], 5, 99
  );
  assert.deepEqual(consumos, []);
  assert.equal(restante, 5);
});

// ===================================================================
// Peças aproveitadas PELA METADE
//
// O lote parou no meio da rota e a peça ainda será terminada — mas o lote sai
// do estoque igual, porque já foi comprometido com este pedido. Deixá-lo lá o
// oferece de novo para outro pedido: o mesmo lote seria vendido duas vezes.
// Foi exatamente isso que aconteceu em produção.
// ===================================================================

test('peça parcial também é abatida do estoque de produtos', () => {
  const plano = planejarConsumo({
    itens: [{
      pedido_item_id: 100,
      produto_id: 1,
      quantidade: 5,
      qtd_usar_pronta: 1,
      qtd_a_produzir: 4,
      parciais: [{ ultimo_insumo_id: 10, quantidade: 3, ordem: 1 }]
    }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.equal(plano.pecasDeEstoque.length, 2, 'a pronta E a parcial saem do estoque');

  const inteira = plano.pecasDeEstoque.find(p => !p.parcial);
  assert.equal(inteira.quantidade, 1);
  assert.equal(inteira.ultimo_insumo_id, null, 'peça inteira: lote no fim da rota');

  const parcial = plano.pecasDeEstoque.find(p => p.parcial);
  assert.equal(parcial.quantidade, 3);
  assert.equal(parcial.ultimo_insumo_id, 10, 'é este insumo que identifica onde o lote parou');
});

test('sem parciais informados, nada de parcial é abatido', () => {
  const plano = planejarConsumo({
    itens: [{ pedido_item_id: 100, produto_id: 1, quantidade: 5, qtd_usar_pronta: 1, qtd_a_produzir: 4 }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.equal(plano.pecasDeEstoque.length, 1, 'só a peça pronta');
  assert.equal(plano.pecasDeEstoque[0].parcial, false);
});

test('parcial com quantidade zero ou inválida é ignorado', () => {
  const plano = planejarConsumo({
    itens: [{
      pedido_item_id: 100, produto_id: 1, quantidade: 5, qtd_a_produzir: 5,
      parciais: [
        { ultimo_insumo_id: 10, quantidade: 0 },
        { ultimo_insumo_id: 10, quantidade: -2 },
        { ultimo_insumo_id: 10 }
      ]
    }],
    rotaPorProduto: ROTA,
    estoquePorInsumo: estoque({ 10: { quantidade: 100 }, 20: { quantidade: 100 } })
  });

  assert.deepEqual(plano.pecasDeEstoque, [], 'lote fantasma não pode ser baixado');
});

test('o lote parcial escolhido é o que parou no insumo certo', () => {
  const lotes = [
    { id: 1, quantidade: 4, ultimo_insumo_id: 10, data_hora_completa: '2026-01-01' }, // parou no corte
    { id: 2, quantidade: 4, ultimo_insumo_id: 20, data_hora_completa: '2026-01-02' }  // parou no acabamento
  ];
  const { consumos } = escolherLotes(lotes, 3, 10);
  assert.equal(consumos.length, 1);
  assert.equal(consumos[0].lote_id, 1, 'pegar o lote do outro ponto entregaria peça no estágio errado');
});
