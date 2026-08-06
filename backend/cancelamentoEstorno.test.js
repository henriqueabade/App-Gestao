const test = require('node:test');
const assert = require('node:assert/strict');
const { estornarCancelamento, opcoesDeEstorno } = require('./cancelamentoEstorno');

/**
 * Estorno do cancelamento, escolhendo o ESTÁGIO de retorno de cada peça.
 *
 * O que se protege aqui é a conta: estoque devolvido a mais é produto que não
 * existe, devolvido a menos é produto que some. Nenhuma das duas aparece no dia
 * seguinte — aparecem no inventário, meses depois.
 *
 * Rota de 15 passos, 1 unidade de cada insumo por passo, para a conferência ser
 * direta: "voltaram os passos 13, 14 e 15" vira "voltou 1 de cada um deles".
 */
const ROTA = Array.from({ length: 15 }, (_, i) => ({
  id: 100 + i + 1,          // passo_id
  produto_id: 7,
  insumo_id: 10 + i + 1,    // insumo 11..25
  quantidade: 1,
  ordem_insumo: i + 1
}));

const passoDaOrdem = ordem => ROTA.find(p => p.ordem_insumo === ordem);

/**
 * @param {object} cenario
 *   `ext`: linhas de pedido_itens_ext (peças que vieram do estoque)
 *   `reserva`: quantidade que seria produzida do zero
 */
function montarApi({ ext = [], reserva = 0, lotes = {}, qtdAProduzir = null, destino = {} } = {}) {
  // Composição do pedido de DESTINO, que muda ao receber peças. O mock a
  // mantém viva para que a "necessidade depois" seja calculada de verdade.
  const itemDestino = {
    id: 2000, pedido_id: 77, produto_id: 7, quantidade: 6,
    qtd_a_produzir: destino.qtdAProduzir ?? 6,
    qtd_usar_pronta: destino.qtdUsarPronta ?? 0,
    nome: 'Peça X', codigo: 'PX'
  };
  const extDestinoAtual = [...(destino.extInicial || [])];
  const estado = { ...lotes };
  const gravacoes = {
    movimentos: [], realocacoes: [], lotesNovos: [], reservas: [],
    extDestino: [], eventos: [], itensAtualizados: []
  };
  let proximoLote = 900;

  return {
    lotes: estado,
    gravacoes,
    async get(rota, opcoes = {}) {
      const q = opcoes?.query || {};
      if (rota === '/api/pedidos/99') return { id: 99, numero: 'PED99' };
      if (rota === '/api/pedidos/77') return { id: 77, numero: 'PED77' };
      if (rota === '/api/pedidos_itens') {
        // O pedido de DESTINO tem a mesma peça, para receber a realocação.
        if (String(q.pedido_id) === '77') return [itemDestino];
        return [{
          id: 1000, pedido_id: 99, produto_id: 7, quantidade: 99,
          nome: 'Peça X', codigo: 'PX',
          // `qtd_a_produzir` é a fonte da quantidade "do zero"; os cenários que
          // não a informam caem na reserva, como os pedidos antigos.
          ...(qtdAProduzir === null ? {} : { qtd_a_produzir: qtdAProduzir })
        }];
      }
      if (rota === '/api/pedido_itens_ext') {
        if (String(q.id_pedido) === '77') return extDestinoAtual;
        if (String(q.pedido_item_id) === '2000') return extDestinoAtual;
        return ext;
      }
      if (rota === '/api/reservas_estoque') {
        if (String(q.pedido_id) === '77') {
          return [{ id: 950, pedido_id: 77, pedido_item_id: 2000, quantidade: 6, status: 'producao' }];
        }
        return reserva > 0
          ? [{ id: 900, pedido_id: 99, pedido_item_id: 1000, quantidade: reserva, status: 'producao' }]
          : [];
      }
      if (rota === '/api/produtos_insumos') return ROTA;
      if (rota === '/api/materia_prima') {
        // Cada insumo tem nome e PROCESSO: é com o processo que o lote criado
        // no estorno nasce completo.
        return ROTA.map(p => ({
          id: p.insumo_id,
          nome: `Insumo ${p.ordem_insumo}`,
          processo: p.ordem_insumo >= 13 ? 'Embalagem' : 'Montagem'
        }));
      }
      if (rota === '/api/produtos_em_cada_ponto') return Object.values(estado);
      if (rota.startsWith('/api/produtos_em_cada_ponto/')) {
        return estado[Number(rota.split('/').pop())] || { error: 'não encontrado' };
      }
      return [];
    },
    async put(rota, payload) {
      if (rota.startsWith('/api/produtos_em_cada_ponto/')) {
        const id = Number(rota.split('/').pop());
        if (estado[id]) estado[id].quantidade = payload.quantidade;
      }
      if (rota.startsWith('/api/reservas_estoque/')) {
        gravacoes.reservas.push({ id: rota.split('/').pop(), ...payload });
      }
      if (rota.startsWith('/api/pedidos_itens/')) {
        gravacoes.itensAtualizados.push({ id: rota.split('/').pop(), ...payload });
        // A composição do destino muda de verdade: é dela que sai a
        // "necessidade depois".
        if (String(rota.split('/').pop()) === '2000') Object.assign(itemDestino, payload);
      }
      if (rota.startsWith('/api/pedido_itens_ext/')) {
        const id = Number(rota.split('/').pop());
        const linha = extDestinoAtual.find(r => Number(r.id) === id);
        if (linha) Object.assign(linha, payload);
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
      if (rota === '/api/pedido_itens_ext') {
        gravacoes.extDestino.push(payload);
        const criado = { id: 9000 + gravacoes.extDestino.length, ...payload };
        extDestinoAtual.push(criado);
        return criado;
      }
      if (rota === '/api/pedido_historico_eventos') {
        gravacoes.eventos.push(payload);
        return { id: 9500 };
      }
      if (rota === '/api/produtos_em_cada_ponto') {
        proximoLote += 1;
        estado[proximoLote] = { id: proximoLote, ...payload, quantidade: 0 };
        gravacoes.lotesNovos.push({ id: proximoLote, ...payload });
        return { id: proximoLote, ...payload, quantidade: 0 };
      }
      return { ok: true };
    }
  };
}

function coletorDeInsumos() {
  const devolvidos = new Map();
  // Por pedido: a devolução do DESTINO de uma realocação é dele, não do pedido
  // cancelado — e o histórico do insumo tem de atribuí-la a quem a causou.
  const porPedidoMap = new Map();

  const fn = async (insumoId, quantidade, _usuarioId, contexto = {}) => {
    const id = Number(insumoId);
    devolvidos.set(id, (devolvidos.get(id) || 0) + Number(quantidade));

    const pedido = Number(contexto?.pedidoId);
    if (!porPedidoMap.has(pedido)) porPedidoMap.set(pedido, new Map());
    const doPedido = porPedidoMap.get(pedido);
    doPedido.set(id, (doPedido.get(id) || 0) + Number(quantidade));
  };

  return {
    devolvidos,
    fn,
    de: ordem => devolvidos.get(passoDaOrdem(ordem).insumo_id) || 0,
    porPedido: pedidoId => porPedidoMap.get(Number(pedidoId)) || new Map()
  };
}

// ---------------------------------------------------------------------------
// Os cinco cenários descritos pelo usuário
// ---------------------------------------------------------------------------

test('peça do zero devolvida no ponto 12/15: peça entra em 12 e os passos 13-15 voltam', async () => {
  const api = montarApi({ reserva: 1 });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 12 }],
    registrarEntradaInsumo: ins.fn
  });

  const novo = api.gravacoes.lotesNovos[0];
  assert.ok(novo, 'não havia lote no ponto 12: tem de ser criado, senão a peça se perde');
  assert.equal(novo.ultimo_insumo_id, passoDaOrdem(12).insumo_id);
  assert.equal(api.lotes[novo.id].quantidade, 1);

  assert.equal(ins.de(13), 1, 'o passo 13 não foi percorrido: volta');
  assert.equal(ins.de(14), 1);
  assert.equal(ins.de(15), 1);
  assert.equal(ins.de(12), 0, 'o passo 12 foi percorrido: a peça está nele');
  assert.equal(ins.de(1), 0);
  assert.equal(ins.devolvidos.size, 3, 'exatamente os 3 que faltavam');
});

test('peça do zero revertida (estágio 0): nenhuma peça e os 15 insumos voltam', async () => {
  const api = montarApi({ reserva: 1 });
  const ins = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'discard', quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(api.gravacoes.lotesNovos.length, 0, 'a peça nunca existiu: nada entra no estoque');
  assert.equal(resumo.pecasDevolvidas, 0);
  assert.equal(ins.devolvidos.size, 15, 'a rota inteira volta');
  assert.equal(ins.de(1), 1);
  assert.equal(ins.de(15), 1);
});

test('peça que entrou pela metade em 5/15, revertida: volta ao lote de origem e os passos 6-15 voltam', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(5).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'discard', quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(api.lotes[501].quantidade, 1, 'volta para o MESMO lote de onde saiu');
  assert.equal(api.gravacoes.lotesNovos.length, 0);
  assert.equal(ins.devolvidos.size, 10, 'os 10 passos que este pedido pagou para completá-la');
  assert.equal(ins.de(6), 1);
  assert.equal(ins.de(15), 1);
  assert.equal(
    ins.de(5), 0,
    'os passos 1 a 5 foram pagos por OUTRO pedido: devolvê-los criaria material do nada'
  );
  assert.equal(ins.de(1), 0);
});

test('peça pronta (15/15) devolvida: entra no estoque e a matéria-prima não muda', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502 }],
    lotes: { 502: { id: 502, produto_id: 7, quantidade: 3, ultimo_insumo_id: passoDaOrdem(15).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(api.lotes[502].quantidade, 4, 'a peça pronta volta ao lote (3 + 1)');
  assert.equal(
    ins.devolvidos.size, 0,
    'ela chegou pronta: este pedido não gastou insumo nenhum com ela'
  );
});

test('realocação NÃO devolve a peça ao estoque: ela troca de dono', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(5).insumo_id } }
  });
  const ins = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(
    api.lotes[501].quantidade, 0,
    'devolver ao lote E entregar ao outro pedido colocaria a mesma unidade em '
    + 'dois lugares — foi o que inflou o estoque no teste do PED22'
  );
  assert.equal(resumo.pecasRealocadas, 1);
  assert.equal(resumo.pecasAoEstoque, 0, 'ela não passa pelo estoque geral');
});

test('realocação: a ORIGEM devolve o que ia gastar, o DESTINO o que já não precisa', async () => {
  // Peça parada em 5/15 sai do pedido 99 para o 77.
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(5).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  // A conta é simétrica e fecha a rota inteira, sem sobreposição:
  //   origem devolve 6..15 (não vai produzir)
  //   destino devolve 1..5 (recebe pronto o que ia fazer)
  assert.equal(ins.porPedido(99).size, 10, 'a origem devolve os passos 6 a 15');
  assert.equal(ins.porPedido(77).size, 5, 'o destino devolve os passos 1 a 5');
  assert.equal(ins.porPedido(99).get(passoDaOrdem(6).insumo_id), 1);
  assert.equal(ins.porPedido(77).get(passoDaOrdem(5).insumo_id), 1);
  assert.equal(
    ins.porPedido(77).get(passoDaOrdem(6).insumo_id), undefined,
    'o passo 6 é do lado da origem: contá-lo nos dois criaria material do nada'
  );
});

test('o destino devolve pela DIFERENÇA, não pelo material das peças recebidas', async () => {
  // O caso do PED24: ele ia produzir 6 do zero e recebeu 7 peças prontas.
  // Somar "o material das 7" devolveria uma ficha técnica inteira a mais —
  // material que ninguém abateu. O certo é: necessidade antes (6 fichas)
  // menos necessidade depois (0) = 6 fichas.
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 7, ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502 }],
    lotes: { 502: { id: 502, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(15).insumo_id } },
    destino: { qtdAProduzir: 6, extInicial: [] }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 7 }],
    registrarEntradaInsumo: ins.fn
  });

  const doDestino = ins.porPedido(77);
  assert.equal(
    doDestino.get(passoDaOrdem(1).insumo_id), 6,
    'seis fichas, não sete: só 6 peças substituíam produção'
  );
  assert.equal(doDestino.get(passoDaOrdem(15).insumo_id), 6);
  assert.equal(doDestino.size, 15, 'a rota inteira, uma vez por insumo');
});

test('realocação de peça PRONTA: o destino devolve a rota inteira', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 3, ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502 }],
    lotes: { 502: { id: 502, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(15).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 3 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(ins.porPedido(99).size, 0, 'a origem não gastou nada com peça pronta');
  assert.equal(ins.porPedido(77).size, 15, 'o destino não produz mais NADA dessas peças');
  assert.equal(ins.porPedido(77).get(passoDaOrdem(1).insumo_id), 3, '3 unidades × 1 por passo');
  assert.equal(ins.porPedido(77).get(passoDaOrdem(15).insumo_id), 3);
});

test('substituir uma peça que o destino tinha do estoque LIBERA aquela peça', async () => {
  // O caso que o usuário descreveu: uma peça pronta do destino é substituída
  // por uma que chega em 10/15. A pronta fica livre e volta ao estoque — ela
  // existe fisicamente e não pode ficar presa a um pedido que não a usa mais.
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(10).id, etapa_id: 501 }],
    lotes: {
      501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(10).insumo_id },
      502: { id: 502, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(15).insumo_id }
    },
    destino: {
      qtdAProduzir: 0,
      qtdUsarPronta: 1,
      // O destino tem 1 peça PRONTA vinda do estoque, do lote 502.
      extInicial: [{
        id: 5000, id_pedido: 77, pedido_item_id: 2000, quantidade: 1,
        ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502
      }]
    }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{
      item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 1,
      pedidoItemDestino: 2000,
      grupoDestino: { origem: 'estoque', ordem_origem: 15 }
    }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(
    api.lotes[502].quantidade, 1,
    'a peça pronta do destino foi substituída e voltou ao lote dela'
  );
  assert.ok(
    api.gravacoes.movimentos.some(m =>
      m.tipo_movimento === 'retorno_cancelamento'
      && Number(m.pedido_id) === 77
      && /substituída por peça realocada/.test(m.decision_note || '')),
    'com movimento no pedido de DESTINO, dizendo o motivo'
  );
});

test('realocação registra os DOIS lados: item e movimento de destino', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(5).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  const rea = api.gravacoes.realocacoes[0];
  assert.ok(rea, 'a realocação é registrada');
  assert.equal(Number(rea.pedido_id_destino), 77);
  assert.ok(rea.movimento_id_origem, 'com o movimento de saída');
  assert.equal(
    Number(rea.pedido_item_id_destino), 2000,
    'e o item do pedido de destino que recebeu — sem isso ninguém sabe qual '
    + 'composição atualizar'
  );
  assert.ok(rea.movimento_id_destino, 'e o movimento de entrada do outro lado');

  // A peça passa a constar como vinda do estoque no DESTINO.
  const extDestino = api.gravacoes.extDestino[0];
  assert.ok(extDestino, 'o destino ganha a peça em pedido_itens_ext');
  assert.equal(Number(extDestino.id_pedido), 77);
  assert.equal(Number(extDestino.pedido_item_id), 2000);
  assert.equal(Number(extDestino.quantidade), 1);

  // E o histórico do destino registra o recebimento.
  assert.ok(
    api.gravacoes.eventos.some(e => Number(e.pedido_id) === 77),
    'o pedido de destino recebe evento no histórico'
  );
});

test('a mensagem cita o NÚMERO do pedido, não o id', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(5).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'reallocate', orderId: 77, quantity: 1 }],
    registrarEntradaInsumo: ins.fn
  });

  const transferencia = api.gravacoes.movimentos.find(
    m => m.tipo_movimento === 'transferencia' && Number(m.pedido_id) === 99
  );
  assert.match(
    transferencia.decision_note, /PED77/,
    '"realocada para o pedido 63" não diz nada a quem conhece o pedido como PED17'
  );
  assert.doesNotMatch(transferencia.decision_note, /pedido 77\b/);
});

// ---------------------------------------------------------------------------
// Travas
// ---------------------------------------------------------------------------

test('não dá para devolver uma peça num ponto ANTERIOR ao que ela entrou', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(10).id, etapa_id: 501 }],
    lotes: { 501: { id: 501, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(10).insumo_id } }
  });
  const ins = coletorDeInsumos();

  const { avisos } = await estornarCancelamento(api, {
    pedidoId: 99,
    // Ninguém desmonta uma peça: ela entrou em 10, não pode voltar em 3.
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 3 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(api.lotes[501].quantidade, 1, 'foi devolvida no ponto de origem');
  assert.equal(ins.devolvidos.size, 5, 'e só os passos 11 a 15 voltam');
  assert.ok(avisos.some(a => /não pode voltar no ponto/.test(a)), 'e o usuário é avisado');
});

test('o mesmo item pode ser devolvido em pontos diferentes, até cobrir tudo', async () => {
  const api = montarApi({ reserva: 3 });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [
      { item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 15 },
      { item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 10 },
      { item: { id: 1000 }, action: 'discard', quantity: 1 }
    ],
    registrarEntradaInsumo: ins.fn
  });

  // 1 acabada (0 insumos) + 1 no ponto 10 (passos 11-15 = 5) + 1 revertida (15).
  assert.equal(ins.de(15), 2, 'a acabada não devolve; as outras duas sim');
  assert.equal(ins.de(11), 2);
  assert.equal(ins.de(10), 1, 'só a revertida devolve o passo 10');
  assert.equal(ins.de(1), 1);
  assert.equal(api.gravacoes.lotesNovos.length, 2, 'um lote no ponto 15 e outro no 10');
});

test('decisão além do que o pedido tinha é ignorada, com aviso', async () => {
  const api = montarApi({ reserva: 1 });
  const ins = coletorDeInsumos();

  const { avisos, resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'discard', quantity: 5 }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(ins.de(1), 1, 'só 1 unidade existia: devolver 5 inventaria material');
  assert.equal(resumo.pecasNaoDevolvidas, 1);
  assert.ok(avisos.some(a => /além do que o pedido tinha/.test(a)));
});

test('sem decisão do usuário, nada é mexido', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 2, ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502 }],
    lotes: { 502: { id: 502, produto_id: 7, quantidade: 3, ultimo_insumo_id: passoDaOrdem(15).insumo_id } }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, { pedidoId: 99, acoes: [], registrarEntradaInsumo: ins.fn });

  assert.equal(api.lotes[502].quantidade, 3, 'devolver "por padrão" seria inventar a decisão');
  assert.equal(ins.devolvidos.size, 0);
  assert.ok(api.gravacoes.reservas.every(r => r.status === 'retornada'));
});

test('cada devolução deixa rastro: pedido, peça, lote e autor', async () => {
  const api = montarApi({ reserva: 1 });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    usuarioId: 13,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 12 }],
    registrarEntradaInsumo: ins.fn
  });

  const daPeca = api.gravacoes.movimentos.find(
    m => m.tipo_movimento === 'retorno_cancelamento' && m.tipo_item === 'peca'
  );
  assert.ok(daPeca, 'a peça devolvida vira movimento');
  assert.equal(Number(daPeca.pedido_id), 99);
  assert.equal(Number(daPeca.pedido_item_id), 1000);
  assert.ok(daPeca.lote_id, 'com o lote em que entrou');
  assert.equal(Number(daPeca.created_by), 13);

  const deInsumo = api.gravacoes.movimentos.filter(
    m => m.tipo_movimento === 'retorno_cancelamento' && m.tipo_item === 'insumo'
  );
  assert.equal(deInsumo.length, 3, 'e cada insumo devolvido também — uma linha por insumo');
});

test('cada grupo recebe a SUA decisão, não a do grupo mais adiantado', async () => {
  // O caso do print: 7 unidades da mesma peça em três origens diferentes.
  const api = montarApi({
    ext: [
      { id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 1, ultimo_insumo_id: passoDaOrdem(15).id, etapa_id: 502 },
      { id: 2, id_pedido: 99, pedido_item_id: 1000, quantidade: 4, ultimo_insumo_id: passoDaOrdem(7).id, etapa_id: 503 }
    ],
    reserva: 2,
    lotes: {
      502: { id: 502, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(15).insumo_id },
      503: { id: 503, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(7).insumo_id }
    }
  });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [
      // A pronta volta pronta: não devolve material.
      { item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 15,
        grupo: { origem: 'estoque', ordem_origem: 15, lote_id: 502 } },
      // As 4 da Montagem voltam como estavam: devolvem os passos 8..15.
      { item: { id: 1000 }, action: 'stock', quantity: 4, ordem: 7,
        grupo: { origem: 'estoque', ordem_origem: 7, lote_id: 503 } },
      // As 2 do zero são revertidas: devolvem a rota inteira.
      { item: { id: 1000 }, action: 'discard', quantity: 2, ordem: 0,
        grupo: { origem: 'producao', ordem_origem: 0, lote_id: null } }
    ],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(api.lotes[502].quantidade, 1, 'a pronta voltou ao lote dela');
  assert.equal(api.lotes[503].quantidade, 4, 'as 4 parciais voltaram ao lote delas');

  // Passo 1: só as 2 do zero pagaram por ele.
  assert.equal(ins.de(1), 2, 'os passos iniciais são só das peças do zero');
  assert.equal(ins.de(7), 2, 'o passo 7 também: as parciais já estavam nele');
  // Passo 8: as 4 parciais (que pararam em 7) + as 2 do zero.
  assert.equal(ins.de(8), 6, '4 parciais + 2 do zero');
  assert.equal(ins.de(15), 6, 'e a pronta não entra em nenhum: ela não gastou nada');
});

test('o lote criado no estorno nasce COMPLETO: processo, insumo e produto', async () => {
  const api = montarApi({ reserva: 1 });
  const ins = coletorDeInsumos();

  await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'stock', quantity: 1, ordem: 12 }],
    registrarEntradaInsumo: ins.fn
  });

  const novo = api.gravacoes.lotesNovos[0];
  assert.ok(novo, 'o lote tem de ser criado');
  assert.equal(Number(novo.produto_id), 7);
  assert.equal(Number(novo.ultimo_insumo_id), passoDaOrdem(12).insumo_id);
  assert.equal(
    novo.etapa_id, 'Montagem',
    'o PROCESSO tem de vir junto: sem ele o lote entra no estoque com a coluna '
    + '"Processo atual" vazia, e ninguém sabe o que aquela peça é'
  );
  assert.ok(novo.data_hora_completa, 'e a data da alteração');
});

test('o MESMO grupo dividido em vários destinos respeita o saldo dele', async () => {
  // 4 unidades paradas em 7/15. O usuário devolve 2 acabadas e 2 em 10/15.
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 4, ultimo_insumo_id: passoDaOrdem(7).id, etapa_id: 503 }],
    lotes: { 503: { id: 503, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(7).insumo_id } }
  });
  const ins = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [
      { item: { id: 1000 }, action: 'stock', quantity: 2, ordem: 15,
        grupo: { origem: 'estoque', ordem_origem: 7, lote_id: 503 } },
      { item: { id: 1000 }, action: 'stock', quantity: 2, ordem: 10,
        grupo: { origem: 'estoque', ordem_origem: 7, lote_id: 503 } }
    ],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(resumo.pecasDevolvidas, 4, 'as 4 do grupo, nem uma a mais');

  // 2 acabadas não devolvem nada; 2 em 10/15 devolvem os passos 11..15.
  assert.equal(ins.de(11), 2, 'só as 2 que pararam em 10 devolvem o passo 11');
  assert.equal(ins.de(15), 2);
  assert.equal(
    ins.de(8), 0,
    'o passo 8 foi percorrido pelos DOIS destinos (um parou em 10, outro em 15): '
    + 'esse material virou peça e não volta'
  );
  assert.equal(ins.de(7), 0, 'o passo 7 é a origem: não volta para ninguém');

  const novo = api.gravacoes.lotesNovos.find(l => Number(l.ultimo_insumo_id) === passoDaOrdem(10).insumo_id);
  assert.ok(novo, 'as 2 de 10/15 criaram o lote naquele ponto');
});

test('destinos que somam mais que o grupo não inventam peças', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 4, ultimo_insumo_id: passoDaOrdem(7).id, etapa_id: 503 }],
    lotes: { 503: { id: 503, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(7).insumo_id } }
  });
  const ins = coletorDeInsumos();

  const { resumo, avisos } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [
      { item: { id: 1000 }, action: 'stock', quantity: 4, ordem: 15,
        grupo: { origem: 'estoque', ordem_origem: 7, lote_id: 503 } },
      // A tela impede, mas se passar (duas abas, payload adulterado) o backend
      // não pode devolver 8 peças de um grupo que tinha 4.
      { item: { id: 1000 }, action: 'stock', quantity: 4, ordem: 10,
        grupo: { origem: 'estoque', ordem_origem: 7, lote_id: 503 } }
    ],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(resumo.pecasDevolvidas, 4, 'o grupo tinha 4: o excedente é recusado');
  assert.ok(avisos.some(a => /além do que o pedido tinha/.test(a)));
});

test('SEM reserva gravada, as peças do zero continuam existindo para o estorno', async () => {
  // O caso do PED18: a conversão abateu a rota inteira de 6 peças do zero, mas
  // a reserva não chegou a ser gravada. Lendo a quantidade da reserva, o grupo
  // "do zero" sumia e o cancelamento não devolvia NADA — nem peça, nem insumo.
  const api = montarApi({ reserva: 0, qtdAProduzir: 6 });
  const ins = coletorDeInsumos();

  const { resumo } = await estornarCancelamento(api, {
    pedidoId: 99,
    acoes: [{ item: { id: 1000 }, action: 'discard', quantity: 6, ordem: 0,
      grupo: { origem: 'producao', ordem_origem: 0, lote_id: null } }],
    registrarEntradaInsumo: ins.fn
  });

  assert.equal(resumo.pecasNaoDevolvidas, 6, 'as 6 existem, mesmo sem reserva');
  assert.equal(ins.devolvidos.size, 15, 'e a rota inteira volta para cada uma');
  assert.equal(ins.de(1), 6, '6 unidades × 1 por passo');
  assert.equal(ins.de(15), 6);
});

test('do zero = qtd_a_produzir menos o que veio pela metade', async () => {
  // 6 a produzir, das quais 4 foram cobertas por um lote parado em 7/15.
  const api = montarApi({
    qtdAProduzir: 6,
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 4, ultimo_insumo_id: passoDaOrdem(7).id, etapa_id: 503 }],
    lotes: { 503: { id: 503, produto_id: 7, quantidade: 0, ultimo_insumo_id: passoDaOrdem(7).insumo_id } }
  });

  const { itens } = await opcoesDeEstorno(api, 99);
  const grupos = itens[0].grupos;
  const daProducao = grupos.find(g => g.origem === 'producao');

  assert.ok(daProducao, 'o grupo do zero tem de existir');
  assert.equal(daProducao.quantidade, 2, '6 a produzir - 4 aproveitadas pela metade');
});

test('opcoesDeEstorno diz o piso e o teto de cada peça', async () => {
  const api = montarApi({
    ext: [{ id: 1, id_pedido: 99, pedido_item_id: 1000, quantidade: 2, ultimo_insumo_id: passoDaOrdem(5).id, etapa_id: 501 }],
    reserva: 3
  });

  const { itens } = await opcoesDeEstorno(api, 99);
  const item = itens[0];

  assert.equal(item.rota.length, 15, 'a rota inteira é o TETO das opções');
  const doEstoque = item.grupos.find(g => g.origem === 'estoque');
  const daProducao = item.grupos.find(g => g.origem === 'producao');
  assert.equal(doEstoque.ordem_origem, 5, 'as 2 do estoque não podem voltar antes do ponto 5');
  assert.equal(doEstoque.quantidade, 2);
  assert.equal(daProducao.ordem_origem, 0, 'as 3 do zero podem voltar de qualquer ponto, ou nenhum');
  assert.equal(daProducao.quantidade, 3);
});
