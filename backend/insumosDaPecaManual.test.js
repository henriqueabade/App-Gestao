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
