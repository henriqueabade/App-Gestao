const test = require('node:test');
const assert = require('node:assert');

/**
 * Alimenta a seção "Utilizado em:" do popup (i) da matéria-prima.
 * O `db` atual é um cliente REST (`pool.get('/tabela', { query })`), então o
 * teste troca o módulo por uma tabela em memória.
 */
function carregarComTabelas(tabelas) {
  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      get: async (caminho) => tabelas[caminho.replace(/^\//, '')] || []
    }
  };
  delete require.cache[require.resolve('./materiaPrima')];
  return require('./materiaPrima');
}

test('listarProdutosPorInsumo devolve os códigos dos produtos que usam o insumo', async () => {
  const { listarProdutosPorInsumo } = carregarComTabelas({
    produtos_insumos: [
      { id: 1, produto_id: 10, produto_codigo: 'P-002', insumo_id: 7 },
      { id: 2, produto_id: 11, produto_codigo: 'P-001', insumo_id: 7 },
      { id: 3, produto_id: 12, produto_codigo: 'P-003', insumo_id: 99 }
    ],
    produtos: [
      { id: 10, codigo: 'P-002', nome: 'Mesa' },
      { id: 11, codigo: 'P-001', nome: 'Cadeira' },
      { id: 12, codigo: 'P-003', nome: 'Banco' }
    ]
  });

  const resultado = await listarProdutosPorInsumo(7);

  assert.deepStrictEqual(
    resultado.map(p => p.codigo),
    ['P-001', 'P-002'],
    'só os produtos do insumo 7, ordenados pelo código'
  );
  assert.strictEqual(resultado[0].nome, 'Cadeira');
});

test('listarProdutosPorInsumo resolve vínculos antigos que só têm produto_codigo', async () => {
  const { listarProdutosPorInsumo } = carregarComTabelas({
    produtos_insumos: [
      { id: 1, produto_id: null, produto_codigo: 'P-005', insumo_id: 3 }
    ],
    produtos: [{ id: 50, codigo: 'P-005', nome: 'Aparador' }]
  });

  const resultado = await listarProdutosPorInsumo(3);

  assert.deepStrictEqual(resultado.map(p => p.codigo), ['P-005']);
});

test('listarProdutosPorInsumo não repete o produto que usa o insumo em dois processos', async () => {
  const { listarProdutosPorInsumo } = carregarComTabelas({
    produtos_insumos: [
      { id: 1, produto_id: 10, produto_codigo: 'P-010', insumo_id: 4 },
      { id: 2, produto_id: 10, produto_codigo: 'P-010', insumo_id: 4 }
    ],
    produtos: [{ id: 10, codigo: 'P-010', nome: 'Rack' }]
  });

  assert.strictEqual((await listarProdutosPorInsumo(4)).length, 1);
});

test('listarProdutosPorInsumo devolve lista vazia quando ninguém usa o insumo', async () => {
  const { listarProdutosPorInsumo } = carregarComTabelas({
    produtos_insumos: [{ id: 1, produto_id: 10, produto_codigo: 'P-010', insumo_id: 4 }],
    produtos: [{ id: 10, codigo: 'P-010', nome: 'Rack' }]
  });

  assert.deepStrictEqual(await listarProdutosPorInsumo(123), []);
});

test('listarInsumosPorProduto pesquisa nome ou código e retorna apenas vínculos reais', async () => {
  const { listarInsumosPorProduto } = carregarComTabelas({
    produtos: [
      { id: 10, codigo: 'P-010', nome: 'Aquário Redondo' },
      { id: 11, codigo: 'P-011', nome: 'Mesa Lateral' }
    ],
    produtos_insumos: [
      { produto_id: 10, produto_codigo: 'P-010', insumo_id: 4 },
      { produto_id: 10, produto_codigo: 'P-010', insumo_id: 7 },
      { produto_id: 11, produto_codigo: 'P-011', insumo_id: 9 }
    ]
  });

  assert.deepStrictEqual(await listarInsumosPorProduto('aquário'), [4, 7]);
  assert.deepStrictEqual(await listarInsumosPorProduto('P-011'), [9]);
  assert.deepStrictEqual(await listarInsumosPorProduto('produto inexistente'), []);
});

test('listarInsumosPorProduto aceita vínculo antigo somente com produto_codigo', async () => {
  const { listarInsumosPorProduto } = carregarComTabelas({
    produtos: [{ id: 20, codigo: 'ABC-20', nome: 'Banco' }],
    produtos_insumos: [{ produto_id: null, produto_codigo: 'abc-20', insumo_id: 12 }]
  });

  assert.deepStrictEqual(await listarInsumosPorProduto('abc-20'), [12]);
});
