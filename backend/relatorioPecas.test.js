const test = require('node:test');
const assert = require('node:assert/strict');
const {
  alteracoesRecebidas,
  reconstruirSelecaoOriginal,
  destinacoesDoCancelamento
} = require('./relatorioPecas');

/**
 * As três seções do relatório de peças.
 *
 * O que se protege aqui é a leitura de quem confere DEPOIS: sem separar seleção
 * original, alterações e composição atual, uma peça que chegou de um pedido
 * cancelado aparece como se tivesse sido escolhida na conversão — e o que ela
 * substituiu não aparece em lugar nenhum.
 */

const ROTA = Array.from({ length: 15 }, (_, i) => ({
  passo_id: 100 + i + 1,
  insumo_id: 10 + i + 1,
  ordem_insumo: i + 1,
  insumo_nome: `Insumo ${i + 1}`,
  processo: i + 1 >= 13 ? 'Embalagem' : 'Montagem'
}));

const passo = ordem => ROTA.find(p => p.ordem_insumo === ordem);
const rotaDoProduto = async () => ROTA;

const ITENS = [{ id: 2000, produto_id: 7, nome: 'Peça X', codigo: 'PX' }];

/** API mínima: só o que estas funções leem. */
function apiFalsa(numeros = { 99: 'PED99' }) {
  return {
    async get(rota) {
      const id = rota.split('/').pop();
      if (rota.startsWith('/api/pedidos/')) return { id: Number(id), numero: numeros[id] || null };
      return [];
    }
  };
}

test('a alteração diz o que chegou, o que saiu e de onde veio', async () => {
  const brutas = [
    {
      pedido_item_id_destino: 2000,
      quantidade: 2,
      ultimo_insumo_id_origem: passo(15).passo_id,
      tipo_destino_substituido: 'producao_zero',
      pedido_id_origem: 99
    },
    {
      pedido_item_id_destino: 2000,
      quantidade: 1,
      ultimo_insumo_id_origem: passo(9).passo_id,
      ultimo_insumo_id_substituido: passo(15).passo_id,
      tipo_destino_substituido: 'pronta',
      movimento_id_peca_liberada: 426,
      pedido_id_origem: 99
    }
  ];

  const linhas = await alteracoesRecebidas(apiFalsa(), brutas, rotaDoProduto, ITENS);

  assert.equal(linhas.length, 2, 'uma linha por substituição');
  assert.equal(linhas[0].recebida, 'Pronta 15/15');
  assert.equal(linhas[0].substituiu, 'Produzir do zero');
  assert.equal(linhas[0].liberou_peca, false, 'produção do zero não libera peça');
  assert.equal(linhas[0].origem, 'PED99', 'o NÚMERO do pedido, não o id');

  assert.equal(linhas[1].recebida, 'Insumo 9 9/15');
  assert.equal(linhas[1].substituiu, 'Pronta 15/15');
  assert.equal(linhas[1].liberou_peca, true, 'a peça pronta substituída voltou ao estoque');
});

test('a seleção original é a composição atual com as substituições desfeitas', async () => {
  // Composição ATUAL: 2 prontas (que chegaram) + 1 parcial em 9/15 (que chegou)
  // + 3 do zero.
  const atual = [
    {
      peca: 'Peça X', codigo: 'PX', origem: 'Pronta do estoque', quantidade: 2,
      etapa: 'Embalagem', item_parada: 'Insumo 15', lote_id: 502,
      itens_faltantes: 0, itens_da_rota: 15
    },
    {
      peca: 'Peça X', codigo: 'PX', origem: 'Parcial do estoque', quantidade: 1,
      etapa: 'Montagem', item_parada: 'Insumo 9', lote_id: 509,
      itens_faltantes: 6, itens_da_rota: 15
    },
    {
      peca: 'Peça X', codigo: 'PX', origem: 'Produzir do zero', quantidade: 3,
      etapa: 'Montagem', item_parada: '—', lote_id: null,
      itens_faltantes: 15, itens_da_rota: 15
    }
  ];

  const brutas = [
    // 2 prontas chegaram no lugar de 2 produções do zero.
    {
      pedido_item_id_destino: 2000, quantidade: 2,
      ultimo_insumo_id_origem: passo(15).passo_id,
      tipo_destino_substituido: 'producao_zero', pedido_id_origem: 99
    },
    // 1 peça em 9/15 chegou no lugar de 1 pronta.
    {
      pedido_item_id_destino: 2000, quantidade: 1,
      ultimo_insumo_id_origem: passo(9).passo_id,
      ultimo_insumo_id_substituido: passo(15).passo_id,
      tipo_destino_substituido: 'pronta', lote_id_substituido: 502,
      pedido_id_origem: 99
    }
  ];

  const original = await reconstruirSelecaoOriginal(atual, brutas, rotaDoProduto, ITENS);

  const porOrigem = nome => original.find(l => l.origem === nome && l.item_parada !== '—')
    || original.find(l => l.origem === nome);

  // As 2 prontas que chegaram saem; a pronta que foi substituída volta.
  assert.equal(porOrigem('Pronta do estoque').quantidade, 1, '2 chegaram, 1 foi substituída');
  // A parcial que chegou some por completo — ela não estava aqui.
  assert.equal(
    original.some(l => l.item_parada === 'Insumo 9'), false,
    'a peça em 9/15 veio do outro pedido: não fazia parte da seleção'
  );
  // E as 2 produções do zero substituídas voltam para a conta.
  assert.equal(porOrigem('Produzir do zero').quantidade, 5, '3 restantes + 2 substituídas');
});

test('sem os campos novos, a unidade volta como produção do zero', async () => {
  // Realocação antiga, gravada antes de `tipo_destino_substituido` existir.
  const atual = [{
    peca: 'Peça X', codigo: 'PX', origem: 'Pronta do estoque', quantidade: 1,
    etapa: 'Embalagem', item_parada: 'Insumo 15', lote_id: 502,
    itens_faltantes: 0, itens_da_rota: 15
  }];
  const brutas = [{
    pedido_item_id_destino: 2000, quantidade: 1,
    ultimo_insumo_id_origem: passo(15).passo_id
  }];

  const original = await reconstruirSelecaoOriginal(atual, brutas, rotaDoProduto, ITENS);

  // Nunca inventa peça no estoque: o palpite seguro é a produção do zero.
  assert.equal(original.length, 1);
  assert.equal(original[0].origem, 'Produzir do zero');
  assert.equal(original[0].quantidade, 1);
});

test('a destinação do cancelamento sai legível, com a falha quando houve', async () => {
  const api = {
    async get(rota) {
      if (rota === '/api/cancelamento_destinacoes') {
        return [
          {
            pedido_item_id: 2000, tipo_destino: 'descarte_restaura_lote', quantidade: 1,
            ultimo_insumo_id: passo(9).passo_id
          },
          {
            pedido_item_id: 2000, tipo_destino: 'realocacao', quantidade: 2,
            ultimo_insumo_id: passo(15).passo_id, pedido_id_destino: 77, realocacao_id: 14
          },
          {
            pedido_item_id: 2000, tipo_destino: 'retorno_estoque', quantidade: 1,
            ultimo_insumo_id: passo(12).passo_id, falha: 'lote não encontrado'
          }
        ];
      }
      if (rota === '/api/realocacoes') {
        return [{
          id: 14, tipo_destino_substituido: 'pronta',
          ultimo_insumo_id_substituido: passo(15).passo_id
        }];
      }
      if (rota.startsWith('/api/pedidos/')) return { id: 77, numero: 'PED77' };
      return [];
    }
  };

  const linhas = await destinacoesDoCancelamento(api, 99, rotaDoProduto, ITENS);

  assert.equal(linhas.length, 3);
  assert.equal(linhas[0].rotulo, 'Descartada (restaurou o lote de origem)');
  assert.equal(linhas[0].estagio_origem, 'Insumo 9 9/15');
  assert.equal(linhas[0].substituiu, null, 'quem volta ao estoque não substitui nada');

  assert.equal(linhas[1].rotulo, 'Realocada para outro pedido');
  assert.equal(linhas[1].pedido_destino, 'PED77');
  // Sem isto, "realocada para o PED77" não fecha a história: substituir uma
  // produção do zero e substituir uma peça pronta são consequências diferentes.
  assert.equal(linhas[1].substituiu, 'Pronta 15/15 (pronta)');

  assert.equal(
    linhas[2].falha, 'lote não encontrado',
    'o que falhou fica visível no relatório: sem transação, é assim que se sabe '
    + 'o que conferir à mão'
  );
});

test('a destinação diz quando o lugar era de uma produção do zero', async () => {
  const api = {
    async get(rota) {
      if (rota === '/api/cancelamento_destinacoes') {
        return [{
          pedido_item_id: 2000, tipo_destino: 'realocacao', quantidade: 4,
          ultimo_insumo_id: passo(14).passo_id, pedido_id_destino: 77, realocacao_id: 10
        }];
      }
      if (rota === '/api/realocacoes') {
        return [{ id: 10, tipo_destino_substituido: 'producao_zero' }];
      }
      if (rota.startsWith('/api/pedidos/')) return { id: 77, numero: 'PED77' };
      return [];
    }
  };

  const [linha] = await destinacoesDoCancelamento(api, 99, rotaDoProduto, ITENS);
  assert.equal(linha.estagio_origem, 'Insumo 14 14/15');
  assert.equal(linha.substituiu, 'Produção do zero');
});

test('sem as tabelas da auditoria, as seções somem sem derrubar o relatório', async () => {
  const api = { async get() { throw new Error('relation "cancelamento_destinacoes" does not exist'); } };

  assert.deepEqual(await destinacoesDoCancelamento(api, 99, rotaDoProduto, ITENS), []);
  assert.deepEqual(await alteracoesRecebidas(api, [], rotaDoProduto, ITENS), []);
});
