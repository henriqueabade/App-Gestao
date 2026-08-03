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
  const gravacoes = { faltantes: [], ext: [], lotesAtualizados: [] };

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
      loteParcial.quantidade, 2,
      'a peça PARCIAL também tem de sair (4 - 2). Era exatamente isto que não acontecia: '
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

    // 1 unidade do zero passa por tudo; as 2 parciais só pela Embalagem.
    assert.equal(por(10), 2, 'Madeira: só 1 unidade do zero × 2 = 2 (as parciais já foram cortadas)');
    assert.equal(por(20), 1, 'Elástico: só 1 unidade do zero × 1 = 1 (as parciais já foram montadas)');
    assert.equal(por(30), 12, 'Etiqueta: as 3 unidades passam pela embalagem × 4 = 12');

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
        decisaoInformada: true, qtd_produzir_parcial: 0
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

test('a revisão que se contradiz é corrigida, e o aviso é dado', async () => {
  const amb = montarAmbiente();
  try {
    const resumo = await amb.aplicarConversaoNoEstoque(amb.api, {
      pedidoId: 99,
      // Diz que há 2 parciais no total, mas não lista quais lotes.
      itens: [{
        pedido_item_id: 1000, produto_id: 7, quantidade: 3,
        qtd_usar_pronta: 0, qtd_a_produzir: 3,
        decisaoInformada: true, qtd_produzir_parcial: 2, parciais: []
      }],
      getMaxId: amb.getMaxId,
      inserirLinhaComId: amb.inserirLinhaComId
    });

    assert.notEqual(amb.lotes.find(l => l.id === 502).quantidade, 4, 'o lote parcial tem de sair do estoque');
    assert.ok(
      resumo.avisos.some(a => /parcial/i.test(a)),
      'quando o sistema decide por conta própria, ele precisa dizer'
    );
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
