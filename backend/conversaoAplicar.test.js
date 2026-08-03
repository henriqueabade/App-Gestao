const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * Conversão ponta a ponta, contra uma API falsa.
 *
 * O cálculo puro já tinha teste, mas o que quebrou em produção foi a EXECUÇÃO:
 * as peças parciais eram calculadas e nunca chegavam a baixar lote nenhum.
 * Nenhum teste olhava para as chamadas de gravação — este olha.
 *
 * O cenário é o do produto real que falhou: rota de três passos
 * (Corte -> Montagem -> Embalagem), com lotes parados em cada ponto.
 */

const ROTA = [
  { id: 1, produto_id: 7, insumo_id: 10, quantidade: 2, ordem_insumo: 1 },
  { id: 2, produto_id: 7, insumo_id: 20, quantidade: 1, ordem_insumo: 2 },
  { id: 3, produto_id: 7, insumo_id: 30, quantidade: 4, ordem_insumo: 3 }
];

const MATERIAS = {
  10: { id: 10, nome: 'Madeira', unidade: 'm', processo: 'Corte', quantidade: 1000 },
  20: { id: 20, nome: 'Elástico', unidade: 'un', processo: 'Montagem', quantidade: 1000 },
  30: { id: 30, nome: 'Etiqueta', unidade: 'un', processo: 'Embalagem', quantidade: 1000 }
};

/** Lotes: um pronto (parou na etiqueta) e dois parciais. */
function lotesIniciais() {
  return [
    { id: 501, produto_id: 7, quantidade: 4, ultimo_insumo_id: 30, etapa_id: 3, data_hora_completa: '2026-01-03' },
    { id: 502, produto_id: 7, quantidade: 4, ultimo_insumo_id: 20, etapa_id: 2, data_hora_completa: '2026-01-02' },
    { id: 503, produto_id: 7, quantidade: 2, ultimo_insumo_id: 10, etapa_id: 1, data_hora_completa: '2026-01-01' }
  ];
}

function montarAmbiente() {
  const caminhoMateria = require.resolve('./materiaPrima');
  const caminhoProdutos = require.resolve('./produtos');
  const caminhoAlvo = require.resolve('./conversaoAplicar');
  const anteriores = {
    materia: require.cache[caminhoMateria],
    produtos: require.cache[caminhoProdutos]
  };

  const saidasDeInsumo = [];
  const fake = (caminho, exports) => {
    require.cache[caminho] = new Module(caminho, null);
    require.cache[caminho].filename = caminho;
    require.cache[caminho].loaded = true;
    require.cache[caminho].exports = exports;
  };

  fake(caminhoMateria, {
    registrarSaida: async (id, quantidade) => { saidasDeInsumo.push({ id, quantidade }); }
  });
  fake(caminhoProdutos, { invalidarCacheLotes: () => {} });

  delete require.cache[caminhoAlvo];
  const { aplicarConversaoNoEstoque } = require(caminhoAlvo);

  const lotes = lotesIniciais();
  const gravacoes = { faltantes: [], ext: [], lotesAtualizados: [], movimentos: [], reservas: [], eventos: [] };

  const api = {
    async get(rota, opcoes = {}) {
      if (rota === '/api/produtos_insumos') {
        return ROTA.filter(r => String(r.produto_id) === String(opcoes?.query?.produto_id));
      }
      if (rota.startsWith('/api/materia_prima/')) {
        return MATERIAS[Number(rota.split('/').pop())] || null;
      }
      if (rota === '/api/produtos_em_cada_ponto') {
        return lotes.filter(l => String(l.produto_id) === String(opcoes?.query?.produto_id));
      }
      return [];
    },
    async post(rota, payload) {
      if (rota.includes('pedidos_itens_faltantes')) gravacoes.faltantes.push(payload);
      else if (rota.includes('estoque_movimentos')) { gravacoes.movimentos.push(payload); return { id: 900 + gravacoes.movimentos.length }; }
      else if (rota.includes('reservas_estoque')) { gravacoes.reservas.push(payload); return { id: 700 + gravacoes.reservas.length }; }
      else if (rota.includes('pedido_historico_eventos')) { gravacoes.eventos.push(payload); return { id: 800 }; }
      else if (rota.includes('pedido_itens_ext')) { gravacoes.ext.push({ tabela: 'pedido_itens_ext', ...payload }); return { id: 600 + gravacoes.ext.length }; }
      else gravacoes.ext.push(payload);
      return { ok: true };
    },
    async put(rota, payload) {
      if (rota.includes('produtos_em_cada_ponto')) {
        const id = Number(rota.split('/').pop());
        const lote = lotes.find(l => l.id === id);
        if (lote) lote.quantidade = payload.quantidade;
        gravacoes.lotesAtualizados.push({ id, quantidade: payload.quantidade });
      }
      return { ok: true };
    }
  };

  return {
    aplicarConversaoNoEstoque,
    api,
    lotes,
    gravacoes,
    saidasDeInsumo,
    // Tabelas do app sem auto-incremento usam estes ajudantes.
    getMaxId: async () => 0,
    inserirLinhaComId: async (_api, tabela, payload, id) => {
      gravacoes.ext.push({ tabela, ...payload, id });
      return id;
    },
    restaurar: () => {
      if (anteriores.materia) require.cache[caminhoMateria] = anteriores.materia;
      else delete require.cache[caminhoMateria];
      if (anteriores.produtos) require.cache[caminhoProdutos] = anteriores.produtos;
      else delete require.cache[caminhoProdutos];
      delete require.cache[caminhoAlvo];
    }
  };
}

test('a peça PARCIAL é de fato baixada do lote — não só a pronta', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000,
        produto_id: 7,
        quantidade: 4,
        qtd_usar_pronta: 1,          // 1 pronta (lote 501)
        qtd_a_produzir: 3,           // 3 a produzir, sendo...
        parciais: [{ ultimo_insumo_id: 20, quantidade: 2, ordem: 2 }] // ...2 aproveitando o lote 502
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const lotePronto = amb.lotes.find(l => l.id === 501);
    const loteParcial = amb.lotes.find(l => l.id === 502);

    assert.equal(lotePronto.quantidade, 3, 'a peça pronta saiu do estoque (4 - 1)');
    assert.equal(
      loteParcial.quantidade, 1,
      'a peça PARCIAL também tem de sair (4 - 3). Era exatamente isto que não acontecia: '
      + 'o lote continuava no estoque, disponível para ser vendido de novo.'
    );
  } finally {
    amb.restaurar();
  }
});

test('a parcial consome só os insumos que FALTAM, não a rota inteira', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000,
        produto_id: 7,
        quantidade: 3,
        qtd_usar_pronta: 0,
        qtd_a_produzir: 3,
        // 2 unidades já passaram por Corte e Montagem (pararam no insumo 20).
        parciais: [{ ultimo_insumo_id: 20, quantidade: 2, ordem: 2 }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const por = id => amb.saidasDeInsumo.find(s => s.id === id)?.quantidade ?? 0;

    // As 3 saem do lote parado na Montagem: nenhuma volta ao Corte nem à
    // Montagem, só falta embalar.
    assert.equal(por(10), 0, 'Madeira: nenhuma unidade precisa ser cortada de novo');
    assert.equal(por(20), 0, 'Elástico: nenhuma precisa ser montada de novo');
    assert.equal(por(30), 12, 'Etiqueta: as 3 passam pela embalagem × 4 = 12');

    // Sem a correção seriam 6, 3 e 12: matéria-prima abatida a mais para
    // processos que essas peças já tinham passado.
  } finally {
    amb.restaurar();
  }
});

test('produzir tudo do zero continua pagando a rota inteira', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      // A revisão FOI feita e escolheu produzir tudo do zero.
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 0, qtd_a_produzir: 3,
        decisaoInformada: true, qtd_produzir_parcial: 0, forcarProduzirDoZero: true
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const por = id => amb.saidasDeInsumo.find(s => s.id === id)?.quantidade ?? 0;
    assert.equal(por(10), 6, '3 × 2');
    assert.equal(por(20), 3, '3 × 1');
    assert.equal(por(30), 12, '3 × 4');
  } finally {
    amb.restaurar();
  }
});

test('tudo pronto do estoque não consome insumo nenhum', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{ pedido_item_id: 1000, produto_id: 7, quantidade: 3, qtd_usar_pronta: 3, qtd_a_produzir: 0 }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.deepEqual(amb.saidasDeInsumo, [], 'peça pronta já consumiu o insumo quando foi produzida');
    assert.equal(amb.lotes.find(l => l.id === 501).quantidade, 1, '4 - 3');
  } finally {
    amb.restaurar();
  }
});

test('o ponto de onde a peça saiu fica registrado, para permitir o estorno', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 1, qtd_a_produzir: 2,
        parciais: [{ ultimo_insumo_id: 20, quantidade: 2, ordem: 2 }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const registros = amb.gravacoes.ext.filter(r => r.tabela === 'pedido_itens_ext');
    assert.equal(registros.length, 2, 'um registro por lote consumido: o pronto e o parcial');
    assert.ok(registros.some(r => Number(r.ultimo_insumo_id) === 30), 'o lote pronto');
    assert.ok(registros.some(r => Number(r.ultimo_insumo_id) === 20), 'o lote parcial');
  } finally {
    amb.restaurar();
  }
});

test('faltando insumo, a falta é registrada com o que realmente falta', async () => {
  const amb = montarAmbiente();
  try {
    // Estoque curto de etiqueta: 5 quando são necessárias 12.
    const original = MATERIAS[30].quantidade;
    MATERIAS[30] = { ...MATERIAS[30], quantidade: 5 };

    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{ pedido_item_id: 1000, produto_id: 7, quantidade: 3, qtd_usar_pronta: 0, qtd_a_produzir: 3 }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const falta = amb.gravacoes.faltantes.find(f => Number(f.insumo_id) === 30);
    assert.ok(falta, 'a falta precisa ser gravada');
    assert.equal(falta.quantidade, 7, '12 necessárias - 5 em estoque');
    assert.equal(falta.processo, 'Embalagem');
    assert.equal(falta.pedido_item_id, 1000, 'a falta tem dono');

    MATERIAS[30] = { ...MATERIAS[30], quantidade: original };
  } finally {
    amb.restaurar();
  }
});

// ===================================================================
// Quando a revisão não diz quais lotes parciais usar
//
// Há duas situações opostas e é preciso distinguir, senão se erra dos dois
// lados: derivar sempre atropela quem escolheu produzir do zero; não derivar
// nunca deixa lote parcial no estoque como se estivesse livre.
// ===================================================================

test('sem revisão, os lotes parciais são aproveitados a partir do estoque', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      // Nada de `decisaoInformada`: conversão sem revisão de estoque.
      itens: [{ pedido_item_id: 1000, produto_id: 7, quantidade: 3, qtd_usar_pronta: 0, qtd_a_produzir: 3 }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    // O lote mais adiantado (502, parou na Montagem) é aproveitado primeiro.
    assert.equal(amb.lotes.find(l => l.id === 502).quantidade, 1, '4 - 3 aproveitadas');
    const por = id => amb.saidasDeInsumo.find(s => s.id === id)?.quantidade ?? 0;
    assert.equal(por(10), 0, 'nenhuma foi cortada agora: as 3 já estavam montadas');
    assert.equal(por(30), 12, 'todas passam pela embalagem');
  } finally {
    amb.restaurar();
  }
});

test('mandar produzir do zero protege o lote parcial de ser consumido', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 0, qtd_a_produzir: 3,
        decisaoInformada: true, forcarProduzirDoZero: true
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(
      amb.lotes.find(l => l.id === 502).quantidade, 4,
      "o usuário decidiu produzir do zero: consumir o lote dele desfaria a escolha"
    );
    assert.equal(amb.gravacoes.reservas.length, 1, "as 3 viram reserva de produção");
  } finally {
    amb.restaurar();
  }
});

test('o lote PRONTO não é confundido com parcial na derivação', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{ pedido_item_id: 1000, produto_id: 7, quantidade: 6, qtd_usar_pronta: 4, qtd_a_produzir: 2 }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.lotes.find(l => l.id === 501).quantidade, 0, 'as 4 prontas saíram do lote pronto');
    assert.equal(
      amb.lotes.find(l => l.id === 502).quantidade, 2,
      'as 2 restantes vieram do lote parcial, não do pronto contado duas vezes'
    );
  } finally {
    amb.restaurar();
  }
});

// ===================================================================
// Abatimento PELO ID DO LOTE
//
// É o caminho principal: a revisão guarda em memória qual linha de
// produtos_em_cada_ponto foi escolhida e manda o id junto. O abatimento não
// procura nada — usa o id. Procurar era o que falhava com os parciais.
// ===================================================================

test('abate exatamente o lote cujo id a revisão escolheu', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 1, qtd_a_produzir: 2, decisaoInformada: true,
        lotes: [
          { lote_id: 501, quantidade: 1, ultimo_insumo_id: 30, ordem: 3, parcial: false },
          { lote_id: 503, quantidade: 2, ultimo_insumo_id: 10, ordem: 1, parcial: true }
        ]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.lotes.find(l => l.id === 501).quantidade, 3, 'lote pronto: 4 - 1');
    assert.equal(
      amb.lotes.find(l => l.id === 503).quantidade, 0,
      'o lote 503 foi o ESCOLHIDO, mesmo havendo o 502 mais adiantado disponível'
    );
    assert.equal(amb.lotes.find(l => l.id === 502).quantidade, 4, 'o 502 não foi tocado');
  } finally {
    amb.restaurar();
  }
});

test('o id escolhido manda também na conta dos insumos', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 2,
        qtd_usar_pronta: 0, qtd_a_produzir: 2, decisaoInformada: true,
        // As 2 peças saem do lote 503, que parou no CORTE (ordem 1).
        lotes: [{ lote_id: 503, quantidade: 2, ultimo_insumo_id: 10, ordem: 1, parcial: true }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const por = id => amb.saidasDeInsumo.find(s => s.id === id)?.quantidade ?? 0;
    assert.equal(por(10), 0, 'já foram cortadas');
    assert.equal(por(20), 2, 'faltam montar: 2 × 1');
    assert.equal(por(30), 8, 'faltam embalar: 2 × 4');
  } finally {
    amb.restaurar();
  }
});

test('lote que sumiu entre a revisão e a confirmação vira aviso, não baixa errada', async () => {
  const amb = montarAmbiente();
  try {
    const resumo = await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 1,
        qtd_usar_pronta: 0, qtd_a_produzir: 1, decisaoInformada: true,
        lotes: [{ lote_id: 999, quantidade: 1, ultimo_insumo_id: 20, ordem: 2, parcial: true }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.deepEqual(amb.gravacoes.lotesAtualizados, [], 'não pode baixar outro lote no lugar');
    assert.ok(resumo.avisos.some(a => /não existe mais/i.test(a)), 'o usuário precisa saber');
  } finally {
    amb.restaurar();
  }
});

test('lote com menos do que foi escolhido baixa o que há e avisa a diferença', async () => {
  const amb = montarAmbiente();
  try {
    const resumo = await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 5,
        qtd_usar_pronta: 0, qtd_a_produzir: 5, decisaoInformada: true,
        // O lote 503 só tem 2.
        lotes: [{ lote_id: 503, quantidade: 5, ultimo_insumo_id: 10, ordem: 1, parcial: true }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.lotes.find(l => l.id === 503).quantidade, 0, 'zera o que havia');
    assert.ok(resumo.avisos.some(a => /faltaram/i.test(a)), 'a diferença precisa ser dita');
  } finally {
    amb.restaurar();
  }
});

// ===================================================================
// O RAZÃO DE ESTOQUE
//
// Cada tabela responde a uma pergunta diferente, e a separação é o que faz o
// cancelamento funcionar: `pedido_itens_ext` diz o que DEVOLVER (veio do
// estoque) e `reservas_estoque` diz o que ENTRA como peça nova (foi produzida).
// Misturar as duas ou devolve peça que nunca existiu, ou perde peça que existia.
// ===================================================================

test('peça do estoque vai para pedido_itens_ext; do zero NÃO vai', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 5,
        qtd_usar_pronta: 1, qtd_a_produzir: 4, decisaoInformada: true,
        // 1 pronta do estoque; as outras 3 são do zero.
        lotes: [{ lote_id: 501, quantidade: 1, ultimo_insumo_id: 30, ordem: 3, parcial: false }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const ext = amb.gravacoes.ext.filter(r => r.tabela === 'pedido_itens_ext');
    assert.equal(ext.length, 1, 'só a peça que veio do estoque');
    assert.equal(ext[0].quantidade, 1);
    assert.equal(ext[0].id_pedido, 99, 'o pedido precisa estar na linha');
  } finally {
    amb.restaurar();
  }
});

test('peça do zero vira reserva em produção, com o último insumo', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 0, qtd_a_produzir: 3,
        decisaoInformada: true, forcarProduzirDoZero: true
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.gravacoes.reservas.length, 1);
    const reserva = amb.gravacoes.reservas[0];
    assert.equal(reserva.quantidade, 3);
    assert.equal(reserva.status, 'producao', 'nasce em produção — a peça ainda será fabricada');
    assert.equal(reserva.item_id, 7);
    assert.equal(reserva.ultimo_insumo_id, 30, 'a peça nasce completa: último passo da rota');
    assert.equal(reserva.pedido_id, 99);
  } finally {
    amb.restaurar();
  }
});

test('cada peça e cada insumo geram movimento no razão', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 1, qtd_a_produzir: 2, decisaoInformada: true,
        lotes: [
          { lote_id: 501, quantidade: 1, ultimo_insumo_id: 30, ordem: 3, parcial: false },
          { lote_id: 502, quantidade: 2, ultimo_insumo_id: 20, ordem: 2, parcial: true }
        ]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const tipos = amb.gravacoes.movimentos.map(m => m.tipo_movimento);
    assert.ok(tipos.every(t => typeof t === 'string' && t), 'todo movimento precisa de tipo');
    assert.equal(amb.gravacoes.movimentos.filter(m => m.tipo_item === 'peca').length, 2, 'a pronta e a parcial');
    assert.ok(amb.gravacoes.movimentos.some(m => m.tipo_item === 'insumo'), 'os insumos');

    const daPeca = amb.gravacoes.movimentos.find(m => m.lote_id === 502);
    assert.equal(daPeca.tipo_item, 'peca', 'o enum do banco usa "peca", não "produto"');
    assert.equal(daPeca.lote_id, 502, 'o lote exato, para o estorno saber onde devolver');
    assert.equal(daPeca.ultimo_insumo_id, 20, 'e em que ponto da rota ela estava');
    assert.equal(daPeca.pedido_id, 99);
  } finally {
    amb.restaurar();
  }
});

test('o pedido ganha um evento de conversão no histórico', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{ pedido_item_id: 1000, produto_id: 7, quantidade: 1, qtd_usar_pronta: 0, qtd_a_produzir: 1 }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.gravacoes.eventos.length, 1);
    assert.equal(amb.gravacoes.eventos[0].tipo_evento, 'conversao');
    assert.equal(amb.gravacoes.eventos[0].pedido_id, 99);
    assert.match(amb.gravacoes.eventos[0].descricao, /reserva/i, 'a descrição diz o que foi feito');
  } finally {
    amb.restaurar();
  }
});

test('tudo pronto do estoque não cria reserva de produção', async () => {
  const amb = montarAmbiente();
  try {
    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 3, qtd_a_produzir: 0, decisaoInformada: true,
        lotes: [{ lote_id: 501, quantidade: 3, ultimo_insumo_id: 30, ordem: 3, parcial: false }]
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.deepEqual(amb.gravacoes.reservas, [], 'nada será produzido: não há o que reservar');
    assert.equal(amb.gravacoes.ext.filter(r => r.tabela === 'pedido_itens_ext').length, 1);
  } finally {
    amb.restaurar();
  }
});

// ===================================================================
// O CENÁRIO REAL QUE FALHOU (pedido 61 / ORC22)
//
// Produto com 3 lotes: um pronto (Embalagem) e dois pela metade (Montagem e
// Acabamento). A revisão pediu 1 pronta + 2 + 3 parciais + 1 do zero.
//
// O que acontecia: as duas parciais eram CALCULADAS certo e depois o
// abatimento saía procurando um lote pelo `ultimo_insumo_id` e não achava —
// "faltaram 2", "faltaram 3". Agora o id do lote viaja junto e não há procura.
// ===================================================================

test('parcial derivado baixa o lote pelo id, sem procurar', async () => {
  const amb = montarAmbiente();
  try {
    const resumo = await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000,
        produto_id: 7,
        quantidade: 7,
        qtd_usar_pronta: 1,   // 1 do lote pronto (501)
        qtd_a_produzir: 6     // 4 parciais disponíveis + 2 do zero
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.equal(amb.lotes.find(l => l.id === 501).quantidade, 3, 'a pronta saiu (4 - 1)');
    assert.equal(
      amb.lotes.find(l => l.id === 502).quantidade, 0,
      'o lote da Montagem foi todo aproveitado — antes ele nem era tocado'
    );
    assert.equal(
      amb.lotes.find(l => l.id === 503).quantidade, 0,
      'o lote do Corte também'
    );

    assert.ok(
      !resumo.avisos.some(a => /faltaram/i.test(a)),
      'não pode sobrar aviso de "faltaram": os lotes existiam e foram achados pelo id'
    );
  } finally {
    amb.restaurar();
  }
});

test('dois lotes no mesmo ponto da rota são baixados cada um na sua linha', async () => {
  const amb = montarAmbiente();
  try {
    // Dois lotes parados no MESMO insumo (20): antes eles eram agrupados por
    // insumo e o abatimento tentava tirar tudo de um só.
    amb.lotes.push({
      id: 504, produto_id: 7, quantidade: 3, ultimo_insumo_id: 20,
      etapa_id: 2, data_hora_completa: '2026-02-01'
    });

    await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 6,
        qtd_usar_pronta: 0, qtd_a_produzir: 6
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    const baixados = amb.gravacoes.lotesAtualizados.map(l => l.id);
    assert.ok(baixados.includes(502), 'o lote 502 foi baixado');
    assert.ok(baixados.includes(504), 'o lote 504, no mesmo ponto, também');
  } finally {
    amb.restaurar();
  }
});
