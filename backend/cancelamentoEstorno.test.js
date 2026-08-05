const test = require('node:test');
const assert = require('node:assert/strict');
const { estornarCancelamento } = require('./cancelamentoEstorno');

/**
 * Estorno do cancelamento.
 *
 * O que se protege aqui é a CONTA: estoque devolvido a mais é produto que não
 * existe, devolvido a menos é produto que some. As duas pontas custam caro, e
 * nenhuma aparece no dia seguinte — aparecem no inventário, meses depois.
 *
 * Cenário: pedido 99, peça 1000 (produto 7, rota de 3 passos), 5 unidades:
 *   2 saíram do lote 501 (prontas)
 *   1 saiu do lote 502 (pela metade)
 *   2 seriam produzidas do zero (reserva 900)
 */
const ROTA = [
  { id: 1, produto_id: 7, insumo_id: 10, quantidade: 2, ordem_insumo: 1 },
  { id: 2, produto_id: 7, insumo_id: 20, quantidade: 1, ordem_insumo: 2 },
  { id: 3, produto_id: 7, insumo_id: 30, quantidade: 4, ordem_insumo: 3 }
];

function montarApi() {
  const lotes = {
    501: { id: 501, produto_id: 7, quantidade: 1, ultimo_insumo_id: 30, etapa_id: 'Embalagem' },
    502: { id: 502, produto_id: 7, quantidade: 0, ultimo_insumo_id: 20, etapa_id: 'Montagem' }
  };
  const gravacoes = { movimentos: [], realocacoes: [], lotesNovos: [], reservas: [] };
  let proximoLote = 900;

  return {
    lotes,
    gravacoes,
    async get(rota, opcoes = {}) {
      const q = opcoes?.query || {};
      if (rota === '/api/pedidos_itens') {
        return [{ id: 1000, pedido_id: 99, produto_id: 7, quantidade: 5 }];
      }
      if (rota === '/api/pedido_itens_ext') {
        return [
          { id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 2, ultimo_insumo_id: 3, etapa_id: 501 },
          { id: 2, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: 2, etapa_id: 502 }
        ];
      }
      if (rota === '/api/reservas_estoque') {
        return [{ id: 900, pedido_id: 99, pedido_item_id: 1000, quantidade: 2, status: 'producao' }];
      }
      if (rota === '/api/produtos_insumos') {
        return ROTA.filter(r => String(r.produto_id) === String(q.produto_id));
      }
      if (rota.startsWith('/api/produtos_em_cada_ponto/')) {
        return lotes[Number(rota.split('/').pop())] || { error: 'não encontrado' };
      }
      return [];
    },
    async put(rota, payload) {
      if (rota.startsWith('/api/produtos_em_cada_ponto/')) {
        const id = Number(rota.split('/').pop());
        if (lotes[id]) lotes[id].quantidade = payload.quantidade;
      }
      if (rota.startsWith('/api/reservas_estoque/')) {
        gravacoes.reservas.push({ id: rota.split('/').pop(), ...payload });
      }
      return { ok: true };
    },
    async post(rota, payload) {
      if (rota === '/api/estoque_movimentos') {
        gravacoes.movimentos.push(payload);
        return { id: 7000 + gravacoes.movimentos.length };
      }
      if (rota === '/api/realocacoes') {
        gravacoes.realocacoes.push(payload);
        return { id: 8000 };
      }
      if (rota === '/api/produtos_em_cada_ponto') {
        proximoLote += 1;
        lotes[proximoLote] = { id: proximoLote, ...payload };
        gravacoes.lotesNovos.push({ id: proximoLote, ...payload });
        return { id: proximoLote };
      }
      return { ok: true };
    }
  };
}

/** Coletor no lugar do `registrarEntrada` da matéria-prima. */
function coletorDeInsumos() {
  const devolvidos = [];
  const fn = async (insumoId, quantidade) => { devolvidos.push({ insumoId, quantidade }); };
  return { devolvidos, fn };
}

test('peça do estoque volta para o LOTE de onde saiu', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 3 }],
    registrarEntradaInsumo: insumos.fn
  });

  assert.equal(api.lotes[501].quantidade, 3, 'as 2 prontas voltaram ao lote 501 (1 + 2)');
  assert.equal(api.lotes[502].quantidade, 1, 'a parcial voltou ao lote 502 (0 + 1)');
  assert.equal(api.gravacoes.lotesNovos.length, 0, 'nenhum lote novo: elas têm origem conhecida');
  assert.equal(
    insumos.devolvidos.length, 0,
    'peça que veio do estoque não devolve matéria-prima: o material dela foi '
    + 'consumido num pedido antigo, não neste'
  );
});

test('peça produzida do zero entra no estoque como lote no fim da rota', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  // 5 de volta: 3 têm lote de origem, 2 eram do zero.
  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 5 }],
    registrarEntradaInsumo: insumos.fn
  });

  assert.equal(api.gravacoes.lotesNovos.length, 1, 'as 2 do zero viram UM lote novo');
  const novo = api.gravacoes.lotesNovos[0];
  assert.equal(novo.quantidade, 2);
  assert.equal(novo.ultimo_insumo_id, 30, 'no fim da rota: a peça está acabada');
  assert.equal(
    insumos.devolvidos.length, 0,
    'a peça EXISTE: o material virou peça. Devolver os dois contaria o mesmo '
    + 'material duas vezes'
  );
});

test('descarte devolve a matéria-prima só das peças que seriam produzidas do zero', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  // Descarta as 5: 3 vieram do estoque, 2 seriam do zero.
  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'discard', quantity: 5 }],
    registrarEntradaInsumo: insumos.fn
  });

  assert.equal(api.lotes[501].quantidade, 1, 'nada volta para os lotes: foi descartado');
  assert.equal(api.lotes[502].quantidade, 0);

  const por = id => insumos.devolvidos.find(d => d.insumoId === id)?.quantidade ?? 0;
  // Só as 2 do zero pagam material, e pela rota inteira.
  assert.equal(por(10), 4, '2 unidades × 2');
  assert.equal(por(20), 2, '2 × 1');
  assert.equal(por(30), 8, '2 × 4');
});

test('devolver ao estoque NÃO devolve matéria-prima junto', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [
      { item: { id: 1000 }, action: 'stock', quantity: 4 },
      { item: { id: 1000 }, action: 'discard', quantity: 1 }
    ],
    registrarEntradaInsumo: insumos.fn
  });

  // Das 5: 4 voltam (3 de lote + 1 do zero) e 1 é descartada — e essa 1 é do
  // zero, então só ela paga material.
  const por = id => insumos.devolvidos.find(d => d.insumoId === id)?.quantidade ?? 0;
  assert.equal(por(10), 2, '1 unidade × 2 — não as 5');
  assert.equal(por(30), 4, '1 × 4');
});

test('realocação não devolve nada: a peça troca de dono', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 2 }],
    registrarEntradaInsumo: insumos.fn
  });

  assert.equal(api.lotes[501].quantidade, 1, 'o lote não muda');
  assert.equal(insumos.devolvidos.length, 0, 'nem o material');
  assert.equal(resumo.pecasRealocadas, 2);

  assert.equal(api.gravacoes.realocacoes.length, 1, 'fica registrado para onde foi');
  assert.equal(api.gravacoes.realocacoes[0].pedido_id_destino, 77);
  assert.ok(
    api.gravacoes.movimentos.some(m => m.tipo_movimento === 'transferencia'),
    'e há um movimento de transferência ligando os dois pedidos'
  );
});

test('sem decisão do usuário, nada é mexido', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [],
    registrarEntradaInsumo: insumos.fn
  });

  assert.equal(api.lotes[501].quantidade, 1, 'devolver "por padrão" seria inventar a decisão');
  assert.equal(resumo.pecasDevolvidas, 0);
  assert.equal(insumos.devolvidos.length, 0);
  // A reserva encerra de qualquer forma: a promessa deste pedido não vale mais.
  assert.ok(api.gravacoes.reservas.some(r => r.status === 'retornada'));
});

test('todo movimento do estorno fica no razão, com pedido e peça', async () => {
  const api = montarApi();
  const insumos = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    usuarioId: 13,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 3 }],
    registrarEntradaInsumo: insumos.fn
  });

  const retornos = api.gravacoes.movimentos.filter(m => m.tipo_movimento === 'retorno_cancelamento');
  assert.equal(retornos.length, 2, 'um por lote devolvido');
  assert.ok(
    retornos.every(m => Number(m.pedido_id) === 99 && Number(m.pedido_item_id) === 1000),
    'cada movimento diz de qual pedido e de qual peça veio'
  );
  assert.ok(retornos.every(m => Number(m.created_by) === 13), 'e quem fez');
  assert.ok(retornos.every(m => m.lote_id), 'e para qual lote voltou');
});
