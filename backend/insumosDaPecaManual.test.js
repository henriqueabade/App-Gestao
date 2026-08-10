const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * Matéria-prima das peças mexidas à mão no módulo de Produtos.
 *
 * Colocar uma peça no estoque é afirmar que ela existe; se existe, alguém a
 * produziu, e produzir consome insumo. Enquanto essa baixa não existia, o
 * estoque de peças subia e o de matéria-prima ficava parado — o sistema passava
 * a acreditar em material que já tinha virado peça.
 *
 * Mas nem toda entrada é produção (correção de inventário, devolução, peça
 * comprada pronta), então o abatimento é ESCOLHA de quem registra. O que se
 * defende aqui é a conta quando a resposta é sim: só o trecho da rota ATÉ o
 * ponto da peça, nunca a rota inteira.
 */

// Rota de 15 passos; o passo N consome N unidades do insumo (10 + N), para a
// conferência distinguir um passo do outro sem ambiguidade.
const ROTA = Array.from({ length: 15 }, (_, i) => ({
  id: 100 + i + 1,
  produto_id: 7,
  insumo_id: 10 + i + 1,
  quantidade: i + 1,
  ordem_insumo: i + 1
}));

const insumoDaOrdem = ordem => 10 + ordem;

function montarAmbiente({ lote = null, rota = ROTA } = {}) {
  const caminhoDb = require.resolve('./db');
  const caminhoProdutos = require.resolve('./produtos');
  const caminhoMateria = require.resolve('./materiaPrima');
  const anterior = require.cache[caminhoDb];

  const registro = { entradas: [], saidas: [], movimentos: [], lotes: [] };

  const fake = {
    async get(rotaHttp, opcoes = {}) {
      if (rotaHttp === '/produtos_insumos') {
        const produtoId = opcoes?.query?.produto_id;
        return rota.filter(p => String(p.produto_id) === String(produtoId));
      }
      if (rotaHttp.startsWith('/produtos_em_cada_ponto/')) return lote;
      return [];
    },
    async post(rotaHttp, payload) {
      if (rotaHttp === '/estoque_movimentos') {
        registro.movimentos.push(payload);
        return { id: registro.movimentos.length };
      }
      if (rotaHttp === '/produtos_em_cada_ponto') {
        registro.lotes.push(payload);
        return { id: 500, ...payload };
      }
      return { ok: true };
    },
    async put() { return { ok: true }; },
    async delete() { return { ok: true }; }
  };

  require.cache[caminhoDb] = new Module(caminhoDb, null);
  require.cache[caminhoDb].filename = caminhoDb;
  require.cache[caminhoDb].loaded = true;
  require.cache[caminhoDb].exports = fake;

  delete require.cache[caminhoProdutos];
  delete require.cache[caminhoMateria];
  const produtos = require(caminhoProdutos);

  // O módulo de Matéria-Prima é quem mexe no saldo; aqui só se registra a
  // chamada, para conferir QUAIS insumos e QUANTO de cada um.
  const materia = require(caminhoMateria);
  materia.registrarEntrada = async (id, quantidade, usuarioId, contexto) => {
    registro.entradas.push({ id: Number(id), quantidade: Number(quantidade), usuarioId, contexto });
  };
  materia.registrarSaida = async (id, quantidade, usuarioId, contexto) => {
    registro.saidas.push({ id: Number(id), quantidade: Number(quantidade), usuarioId, contexto });
  };

  return {
    produtos,
    registro,
    restaurar() {
      if (anterior) require.cache[caminhoDb] = anterior;
      else delete require.cache[caminhoDb];
      delete require.cache[caminhoProdutos];
      delete require.cache[caminhoMateria];
    }
  };
}

test('inserir peça em 10/15 abatendo consome os DEZ primeiros passos', async () => {
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(10),
      quantidade: 2,
      usuarioId: 13,
      abaterInsumos: true
    });

    const saidas = amb.registro.saidas;
    assert.equal(saidas.length, 10, 'dez passos, não os quinze da rota inteira');

    // Passo N consome N por peça; com 2 peças, 2N.
    for (const ordem of [1, 5, 10]) {
      const linha = saidas.find(s => s.id === insumoDaOrdem(ordem));
      assert.ok(linha, `o passo ${ordem} tem de sair`);
      assert.equal(linha.quantidade, ordem * 2, `passo ${ordem}: ${ordem} por peça × 2 peças`);
    }
    // Nada depois do ponto onde a peça parou.
    for (const ordem of [11, 15]) {
      assert.equal(
        saidas.some(s => s.id === insumoDaOrdem(ordem)), false,
        `o passo ${ordem} ainda não foi feito nesta peça`
      );
    }

    assert.equal(amb.registro.entradas.length, 0, 'nada volta ao estoque numa entrada de peça');
  } finally {
    amb.restaurar();
  }
});

test('inserir SEM abater não toca na matéria-prima', async () => {
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(10),
      quantidade: 2,
      usuarioId: 13,
      abaterInsumos: false
    });

    assert.equal(amb.registro.saidas.length, 0);
    assert.equal(amb.registro.entradas.length, 0);
    // A peça entra do mesmo jeito — é só o material que não se move.
    assert.equal(amb.registro.lotes.length, 1);
  } finally {
    amb.restaurar();
  }
});

test('peça pronta (15/15) abatendo consome a rota inteira', async () => {
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Embalagem',
      ultimoInsumoId: insumoDaOrdem(15),
      quantidade: 1,
      usuarioId: 13,
      abaterInsumos: true
    });

    assert.equal(amb.registro.saidas.length, 15);
  } finally {
    amb.restaurar();
  }
});

test('aumentar a quantidade do lote consome; diminuir devolve', async () => {
  const lote = {
    id: 42, produto_id: 7, quantidade: 3, ultimo_insumo_id: insumoDaOrdem(3)
  };

  const subindo = montarAmbiente({ lote });
  try {
    await subindo.produtos.atualizarLoteProduto(42, 5, 13, { ajustarInsumos: true });
    // 3 -> 5 = 2 peças a mais, nos 3 primeiros passos.
    assert.equal(subindo.registro.saidas.length, 3);
    assert.equal(
      subindo.registro.saidas.find(s => s.id === insumoDaOrdem(2)).quantidade, 4,
      'passo 2: 2 por peça × 2 peças'
    );
    assert.equal(subindo.registro.entradas.length, 0);
  } finally {
    subindo.restaurar();
  }

  const descendo = montarAmbiente({ lote });
  try {
    await descendo.produtos.atualizarLoteProduto(42, 1, 13, { ajustarInsumos: true });
    // 3 -> 1 = 2 peças a menos: o material delas volta.
    assert.equal(descendo.registro.entradas.length, 3);
    assert.equal(descendo.registro.entradas.find(e => e.id === insumoDaOrdem(2)).quantidade, 4);
    assert.equal(descendo.registro.saidas.length, 0);
  } finally {
    descendo.restaurar();
  }
});

test('ajuste sem mudar a quantidade não movimenta nada', async () => {
  const amb = montarAmbiente({
    lote: { id: 42, produto_id: 7, quantidade: 3, ultimo_insumo_id: insumoDaOrdem(3) }
  });
  try {
    await amb.produtos.atualizarLoteProduto(42, 3, 13, { ajustarInsumos: true });
    assert.equal(amb.registro.saidas.length, 0);
    assert.equal(amb.registro.entradas.length, 0);
  } finally {
    amb.restaurar();
  }
});

test('excluir o lote devolvendo repõe o material de todas as peças', async () => {
  const amb = montarAmbiente({
    lote: { id: 42, produto_id: 7, quantidade: 4, ultimo_insumo_id: insumoDaOrdem(2) }
  });
  try {
    const r = await amb.produtos.excluirLoteProduto(42, 13, { devolverInsumos: true });

    assert.equal(amb.registro.entradas.length, 2, 'os dois passos que a peça tinha');
    assert.equal(amb.registro.entradas.find(e => e.id === insumoDaOrdem(1)).quantidade, 4);
    assert.equal(amb.registro.entradas.find(e => e.id === insumoDaOrdem(2)).quantidade, 8);
    assert.equal(r.insumosMovimentados, 2);
  } finally {
    amb.restaurar();
  }
});

test('excluir SEM devolver não repõe nada', async () => {
  const amb = montarAmbiente({
    lote: { id: 42, produto_id: 7, quantidade: 4, ultimo_insumo_id: insumoDaOrdem(2) }
  });
  try {
    await amb.produtos.excluirLoteProduto(42, 13, { devolverInsumos: false });
    assert.equal(amb.registro.entradas.length, 0);
  } finally {
    amb.restaurar();
  }
});

test('ponto desconhecido na rota não movimenta nada', async () => {
  // Sem saber onde a peça parou, debitar a rota inteira tiraria material que
  // talvez nunca tenha sido usado. Não mexer é o único caminho seguro.
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: 9999,
      quantidade: 2,
      usuarioId: 13,
      abaterInsumos: true
    });
    assert.equal(amb.registro.saidas.length, 0);
  } finally {
    amb.restaurar();
  }
});

test('o movimento do insumo entra no razão, com autor e lote', async () => {
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(2),
      quantidade: 1,
      usuarioId: 13,
      abaterInsumos: true
    });

    const doInsumo = amb.registro.movimentos.filter(m => m.tipo_item === 'insumo');
    assert.equal(doInsumo.length, 2, 'um movimento por passo consumido');
    assert.ok(
      doInsumo.every(m => m.tipo_movimento === 'consumo_insumo' && Number(m.created_by) === 13),
      'com tipo de consumo e quem fez'
    );
    assert.ok(doInsumo.every(m => m.lote_id === 500), 'e o lote que originou a baixa');

    // E a peça continua tendo o movimento dela, separado.
    assert.equal(amb.registro.movimentos.filter(m => m.tipo_item === 'peca').length, 1);
  } finally {
    amb.restaurar();
  }
});

// ---------------------------------------------------------------------------
// RASTREABILIDADE: qual peça causou o consumo
//
// Os abatimentos já saíam certos; o que faltava era o vínculo. Sem ele, o
// extrato do insumo mostrava "-1,452 cm³" sem dizer produto, quantidade nem
// estágio — e a única pista era o horário, que não é vínculo.
// ---------------------------------------------------------------------------

test('cada consumo aponta a movimentação de peça que o causou', async () => {
  const amb = montarAmbiente();
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(3),
      quantidade: 3,
      usuarioId: 13,
      abaterInsumos: true
    });

    // O movimento da PEÇA é o primeiro gravado; os consumos vêm depois.
    const daPeca = amb.registro.movimentos.find(m => m.tipo_item === 'peca');
    assert.ok(daPeca, 'a peça tem movimento próprio');

    // 1. No histórico da matéria-prima.
    assert.equal(amb.registro.saidas.length, 3);
    for (const saida of amb.registro.saidas) {
      assert.equal(
        saida.contexto?.estoqueMovimentoId, 1,
        'o consumo guarda o id do movimento da peça — é por ele que o extrato '
        + 'mostra produto, quantidade e estágio'
      );
    }

    // 2. E no razão de estoque, nos dois sentidos.
    const doInsumo = amb.registro.movimentos.filter(m => m.tipo_item === 'insumo');
    assert.equal(doInsumo.length, 3);
    assert.ok(
      doInsumo.every(m => m.source_movement_id === 1),
      'o movimento do insumo aponta para o movimento da peça'
    );
  } finally {
    amb.restaurar();
  }
});

test('a devolução da exclusão também fica ligada à peça', async () => {
  const amb = montarAmbiente({
    lote: { id: 42, produto_id: 7, quantidade: 2, ultimo_insumo_id: insumoDaOrdem(2) }
  });
  try {
    await amb.produtos.excluirLoteProduto(42, 13, { devolverInsumos: true });

    assert.equal(amb.registro.entradas.length, 2);
    for (const entrada of amb.registro.entradas) {
      assert.ok(
        entrada.contexto?.estoqueMovimentoId,
        'a devolução também aponta o movimento da peça que a causou'
      );
    }
  } finally {
    amb.restaurar();
  }
});

test('insumo que falha não some: volta na lista de falhas', async () => {
  // Falha parcial é FALHA. A tela não pode fechar nem dizer sucesso — e para
  // isso ela precisa receber o que não foi movimentado.
  const amb = montarAmbiente();
  try {
    const materia = require.cache[require.resolve('./materiaPrima')].exports;
    const original = materia.registrarSaida;
    materia.registrarSaida = async (id, quantidade, usuarioId, contexto) => {
      if (Number(id) === insumoDaOrdem(2)) throw new Error('saldo insuficiente');
      return original(id, quantidade, usuarioId, contexto);
    };

    const r = await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(3),
      quantidade: 1,
      usuarioId: 13,
      abaterInsumos: true
    });

    assert.equal(r.insumosMovimentados, 2, 'os outros dois passaram');
    assert.equal(r.falhasInsumos.length, 1, 'e o que falhou é devolvido a quem chamou');
    assert.match(r.falhasInsumos[0], /saldo insuficiente/);
  } finally {
    amb.restaurar();
  }
});

// ---------------------------------------------------------------------------
// SALDO NEGATIVO: previsto antes, aprovado com justificativa, marcado depois
//
// Abater às cegas e descobrir no inventário é o que transforma um erro de
// digitação em estoque furado. Negativo pode acontecer — material recebido e
// não lançado, ficha técnica velha —, mas é DECISÃO: alguém aprova e escreve
// o porquê, e isso fica no movimento do insumo que ficou negativo.
// ---------------------------------------------------------------------------

/** Ambiente com saldo controlado por insumo, para prever o que fica negativo. */
function ambienteComSaldos(saldos, extras = {}) {
  const amb = montarAmbiente(extras);
  const dbFake = require.cache[require.resolve('./db')].exports;
  const getOriginal = dbFake.get.bind(dbFake);
  dbFake.get = async (rota, opcoes) => {
    if (rota === '/materia_prima') {
      return Object.entries(saldos).map(([id, valor]) => ({
        id: Number(id),
        nome: `Insumo ${id}`,
        unidade: 'un',
        quantidade: valor.quantidade ?? valor,
        infinito: Boolean(valor.infinito)
      }));
    }
    return getOriginal(rota, opcoes);
  };
  return amb;
}

test('a previsão diz qual insumo fica negativo, sem gravar nada', async () => {
  // Passo 1 consome 1/peça, passo 2 consome 2/peça, passo 3 consome 3/peça.
  // Com 4 peças: 4, 8 e 12.
  const amb = ambienteComSaldos({
    [insumoDaOrdem(1)]: 100,
    [insumoDaOrdem(2)]: 5,
    [insumoDaOrdem(3)]: 12
  });
  try {
    const r = await amb.produtos.previsaoDeInsumosDaPeca({
      produtoId: 7,
      ultimoInsumoId: insumoDaOrdem(3),
      unidades: 4,
      direcao: 'saida'
    });

    assert.equal(r.insumos.length, 3, 'os três passos da rota até o ponto');
    assert.equal(r.negativos.length, 1, 'só o que de fato fecha abaixo de zero');
    assert.equal(r.negativos[0].insumo_id, insumoDaOrdem(2));
    assert.equal(r.negativos[0].saldo_atual, 5);
    assert.equal(r.negativos[0].quantidade, 8);
    assert.equal(r.negativos[0].saldo_previsto, -3);

    // Exatamente zero NÃO é negativo.
    const noLimite = r.insumos.find(i => i.insumo_id === insumoDaOrdem(3));
    assert.equal(noLimite.saldo_previsto, 0);
    assert.equal(noLimite.negativo, false);

    // E nada foi gravado: previsão é leitura.
    assert.equal(amb.registro.saidas.length, 0);
    assert.equal(amb.registro.movimentos.length, 0);
  } finally {
    amb.restaurar();
  }
});

test('insumo infinito nunca conta como negativo', async () => {
  const amb = ambienteComSaldos({
    [insumoDaOrdem(1)]: { quantidade: 0, infinito: true },
    [insumoDaOrdem(2)]: { quantidade: 0, infinito: false }
  });
  try {
    const r = await amb.produtos.previsaoDeInsumosDaPeca({
      produtoId: 7,
      ultimoInsumoId: insumoDaOrdem(2),
      unidades: 1,
      direcao: 'saida'
    });

    assert.equal(r.negativos.length, 1);
    assert.equal(r.negativos[0].insumo_id, insumoDaOrdem(2), 'o infinito fica de fora');
  } finally {
    amb.restaurar();
  }
});

test('devolução não gera negativo: o saldo só sobe', async () => {
  const amb = ambienteComSaldos({ [insumoDaOrdem(1)]: 0, [insumoDaOrdem(2)]: 0 });
  try {
    const r = await amb.produtos.previsaoDeInsumosDaPeca({
      produtoId: 7,
      ultimoInsumoId: insumoDaOrdem(2),
      unidades: 3,
      direcao: 'entrada'
    });

    assert.equal(r.negativos.length, 0);
    assert.equal(r.insumos[0].saldo_previsto, 3, 'entrada soma');
  } finally {
    amb.restaurar();
  }
});

test('a justificativa fica SÓ no insumo que ficou negativo', async () => {
  const amb = ambienteComSaldos({
    [insumoDaOrdem(1)]: 100,
    [insumoDaOrdem(2)]: 1
  });
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(2),
      quantidade: 1,
      usuarioId: 13,
      abaterInsumos: true,
      justificativaNegativo: 'Material recebido e ainda não lançado'
    });

    const doInsumo = amb.registro.movimentos.filter(m => m.tipo_item === 'insumo');
    const negativo = doInsumo.find(m => Number(m.item_id) === insumoDaOrdem(2));
    const normal = doInsumo.find(m => Number(m.item_id) === insumoDaOrdem(1));

    assert.equal(negativo.saldo_negativo_autorizado, true, 'o que fechou negativo é marcado');
    assert.match(negativo.decision_note, /Material recebido e ainda não lançado/);

    assert.equal(
      normal.saldo_negativo_autorizado, null,
      'marcar todos diria que houve decisão de negativar onde não houve'
    );
    assert.equal(
      /Saldo negativo autorizado/.test(normal.decision_note || ''), false,
      'e a nota do negativo não contamina os outros'
    );

    // A justificativa também vai para o histórico da matéria-prima.
    const doHistorico = amb.registro.saidas.find(s => s.id === insumoDaOrdem(2));
    assert.match(doHistorico.contexto.nota, /Saldo negativo autorizado/);
  } finally {
    amb.restaurar();
  }
});

test('sem negativo, nada é marcado como autorizado', async () => {
  const amb = ambienteComSaldos({ [insumoDaOrdem(1)]: 100, [insumoDaOrdem(2)]: 100 });
  try {
    await amb.produtos.inserirLoteProduto({
      produtoId: 7,
      etapa: 'Montagem',
      ultimoInsumoId: insumoDaOrdem(2),
      quantidade: 1,
      usuarioId: 13,
      abaterInsumos: true
    });

    const doInsumo = amb.registro.movimentos.filter(m => m.tipo_item === 'insumo');
    assert.ok(doInsumo.length > 0);
    assert.ok(doInsumo.every(m => m.saldo_negativo_autorizado === null));
  } finally {
    amb.restaurar();
  }
});
