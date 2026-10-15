const test = require('node:test');
const assert = require('node:assert/strict');
const {
  alteracoesRecebidas,
  reconstruirSelecaoOriginal,
  destinacoesDoCancelamento,
  composicaoDoItem,
  edicoesDoPedido
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

test('composição respeita a quantidade viva e conta passos posteriores em rotas espaçadas', () => {
  const rota = [1, 5, 10].map((ordem_insumo, i) => ({ passo_id: 201 + i, ordem_insumo, processo: 'Marcenaria', insumo_nome: `Passo ${i}` }));
  const item = { id: 11, produto_id: 2, nome: 'Caixa', quantidade: 2, qtd_a_produzir: 99, qtd_usar_pronta: 1 };
  const registros = [{ quantidade: 1, ultimo_insumo_id: 203 }, { quantidade: 8, ultimo_insumo_id: 201 }];
  const linhas = composicaoDoItem(item, registros, rota);
  assert.equal(linhas.reduce((s, l) => s + l.quantidade, 0), 2);
  assert.equal(linhas[0].origem, 'Pronta do estoque');
  assert.equal(linhas[1].quantidade, 1);
  assert.equal(linhas[1].itens_faltantes, 2);
  assert.equal(linhas[1].pedido_item_id, 11);
  assert.deepEqual(composicaoDoItem({ ...item, quantidade: 0 }, registros, rota), []);
});

test('edições preservam identidade, ordem, motivo e devoluções de itens que já saíram do pedido', async () => {
  const antiga = { id: 1, pedido_id: 121, criado_em: '2026-10-01T10:00:00Z', concluida_em: '2026-10-01T10:00:01Z', motivo: 'Trocar a caixa',
    antes: JSON.stringify({ itens: [{ id: 10, produto_id: 1, codigo: 'ANT', nome: 'Peça antiga', quantidade: 2 }] }),
    depois: JSON.stringify({ linhas: [{ tipo: 'existente', item_id: 10, produto_id: 1, quantidade: 0 }] }),
    resumo: JSON.stringify({ saem: [{ pedido_item_id: 10, peca: 'ANT — Peça antiga', pecas: [{ quantidade: 2, origem: 'producao', ordem_destino: 1 }] }], materia_prima_volta: [[100, 2]], materia_prima_sai_prevista: [[101, 4]] }),
    resultado: JSON.stringify({ avisos: ['Conferir material'] }), valor_antes: 100, valor_depois: 200 };
  const nova = { ...antiga, id: 2, criado_em: '2026-10-02T10:00:00Z', antes: { itens: [] }, depois: { linhas: [] }, resumo: {} };
  const estrangeira = { ...antiga, id: 3, pedido_id: 999 };
  const api = { get: async () => [nova, estrangeira, antiga] };
  const materias = new Map([[100, { nome: 'Madeira', unidade: 'm²' }], [101, { nome: 'Cera', unidade: 'kg' }]]);
  const historico = await edicoesDoPedido(api, 121, async () => [{ ordem_insumo: 1, insumo_nome: 'Madeira' }], [{ id: 10, produto_id: 1, quantidade: 0 }], materias);
  assert.deepEqual(historico.map(e => e.id), [1, 2]);
  assert.equal(historico[0].linhas[0].peca, 'ANT — Peça antiga');
  assert.equal(historico[0].linhas[0].quantidade_antes, 2);
  assert.equal(historico[0].linhas[0].quantidade_depois, 0);
  assert.match(historico[0].saidas[0].destino, /Madeira/);
  assert.equal(historico[0].materia_prima_devolvida[0].quantidade, 2);
  assert.equal(historico[0].materia_prima_devolvida[0].confirmado, false, 'o plano não comprova que a devolução foi executada');
  assert.equal(historico[0].saidas[0].confirmado, false);
  assert.equal(historico[0].materia_prima_nova_prevista[0].nome, 'Cera');
  assert.deepEqual(historico[0].avisos, ['Conferir material']);
  antiga.resultado = { pecas_ao_estoque: 2, insumos_devolvidos: 1, avisos: [] };
  const [confirmada] = await edicoesDoPedido(api, 121, async () => [{ ordem_insumo: 1, insumo_nome: 'Madeira' }], [], materias);
  assert.equal(confirmada.materia_prima_devolvida[0].confirmado, true);
  assert.equal(confirmada.saidas[0].confirmado, true);
});

test('auditoria sem permissão é avisada e falhas de rede continuam sendo erros', async () => {
  const avisos = [];
  const api = { get: async () => { throw Object.assign(new Error('Sem permissão'), { status: 403 }); } };
  assert.deepEqual(await edicoesDoPedido(api, 121, async () => [], [], new Map(), avisos), []);
  assert.match(avisos[0], /mapa de permissões/);
  await assert.rejects(() => edicoesDoPedido({ get: async () => { throw new Error('Conexão interrompida'); } }, 121, async () => [], []), /Conexão interrompida/);
});

test('relatórios HTTP usam composição atual, limitam faltas e exibem a auditoria sem efetuar escritas', async () => {
  const Module = require('node:module');
  const fs = require('node:fs');
  const express = require('express');
  const tabelas = {
    pedidos: [{ id: 121, numero: 'PED121' }],
    pedidos_itens: [
      { id: 10, pedido_id: 121, produto_id: 2, nome: 'Retirada', quantidade: 0, qtd_a_produzir: 99 },
      { id: 11, pedido_id: 121, produto_id: 2, nome: 'Caixa', quantidade: 2, qtd_usar_pronta: 1, qtd_a_produzir: 1 },
      { id: 13, pedido_id: 121, produto_id: 2, nome: 'Parcial', quantidade: 1, qtd_a_produzir: 1 },
      { id: 14, pedido_id: 121, produto_id: 3, nome: 'Caixa', quantidade: 1, qtd_a_produzir: 1 }
    ],
    pedido_itens_ext: [{ pedido_item_id: 11, id_pedido: 121, ultimo_insumo_id: 203, quantidade: 1 }, { pedido_item_id: 13, id_pedido: 121, ultimo_insumo_id: 201, quantidade: 1 }],
    materia_prima: [100, 101, 102].map(id => ({ id, nome: id === 102 ? 'Cera' : 'Madeira', unidade: 'kg', processo: id === 102 ? 'Acabamento' : 'Marcenaria' })),
    produtos_insumos: [
      { id: 201, produto_id: 2, insumo_id: 100, ordem_insumo: 1, quantidade: 1 },
      { id: 202, produto_id: 2, insumo_id: 101, ordem_insumo: 5, quantidade: 2 },
      { id: 203, produto_id: 2, insumo_id: 102, ordem_insumo: 10, quantidade: 3 },
      { id: 301, produto_id: 3, insumo_id: 100, ordem_insumo: 1, quantidade: 2 }
    ],
    pedidos_itens_faltantes: [
      { pedido_id: 121, pedido_item_id: 10, insumo_id: 100, quantidade: 99 },
      { pedido_id: 121, pedido_item_id: 13, insumo_id: 100, quantidade: 99 },
      ...[1, 2].map(id => ({ id, pedido_id: 121, pedido_item_id: 13, insumo_id: 101, insumo_nome: 'Madeira', unidade: 'kg', processo: 'Marcenaria', quantidade: 20 }))
    ],
    pedido_edicoes: [{ id: 1, pedido_id: 121, motivo: 'Retirada da peça', criado_em: '2026-10-01', antes: { itens: [{ id: 10, produto_id: 2, nome: 'Retirada', quantidade: 1 }] }, depois: { linhas: [{ tipo: 'existente', item_id: 10, produto_id: 2, quantidade: 0 }] }, resumo: {}, resultado: {} }]
  };
  const api = { get: async (caminho, { query = {} } = {}) => {
    const [, tabela, id] = caminho.split('/').filter(Boolean);
    let linhas = tabelas[tabela] || [];
    if (id) return linhas.find(l => String(l.id) === id) || null;
    return linhas.filter(l => Object.entries(query).every(([k, v]) => String(l[k]) === String(v)));
  } };
  const caminho = require.resolve('./pedidosController');
  const modulo = new Module(caminho, module);
  modulo.filename = caminho;
  modulo.paths = module.paths;
  const requerer = modulo.require.bind(modulo);
  modulo.require = nome => nome === './apiHttpClient' ? { createApiClient: () => api }
    : nome === './permissionsController' ? { exigirPermissao: () => (_req, _res, next) => next(), exigirSupAdmin: (_req, _res, next) => next() } : requerer(nome);
  modulo._compile(fs.readFileSync(caminho, 'utf8'), caminho);
  const app = express();
  app.use('/api/pedidos', modulo.exports);
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  try {
    const base = `http://127.0.0.1:${servidor.address().port}/api/pedidos/121`;
    const pecas = await (await fetch(`${base}/pecas-selecionadas`)).json();
    assert.equal(pecas.houve_edicao, true);
    assert.equal(pecas.edicoes[0].motivo, 'Retirada da peça');
    assert.deepEqual(pecas.selecaoOriginal, []);
    assert.equal(pecas.pecas.some(p => p.peca === 'Retirada'), false);
    assert.equal(pecas.pecas.reduce((s, p) => s + p.quantidade, 0), 4);
    assert.equal(pecas.pecas.find(p => p.peca === 'Parcial').itens_faltantes, 2);
    const producao = await (await fetch(`${base}/relatorio-producao`)).json();
    const marcenaria = producao.processos.find(p => p.processo === 'Marcenaria');
    assert.equal(producao.edicoes.length, 1);
    assert.equal(producao.processos.some(p => p.pecas.some(i => i.peca === 'Retirada')), false);
    assert.deepEqual(marcenaria.totais.map(i => [i.insumo_id, i.quantidade]).sort(), [[100, 3], [101, 4]]);
    assert.equal(marcenaria.faltantes.length, 1);
    assert.equal(marcenaria.faltantes[0].insumo_id, 101);
    assert.equal(marcenaria.faltantes[0].quantidade, 2);
  } finally {
    await new Promise(r => servidor.close(r));
  }
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
