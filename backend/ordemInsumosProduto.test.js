const test = require('node:test');
const assert = require('node:assert');

/**
 * A posição que o usuário monta no modal do processo é gravada em
 * `ordem_insumo`. O back-end tem de devolver os insumos nessa ordem — antes ele
 * ordenava primeiro pelo NOME do processo, o que embaralhava a sequência.
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
  delete require.cache[require.resolve('./produtos')];
  return require('./produtos');
}

const PRODUTO = { id: 1, codigo: 'P-001', nome: 'Mesa' };

const MATERIAS = [
  { id: 10, nome: 'Item X', unidade: 'un', processo: 'Marcenaria', preco_unitario: 2 },
  { id: 11, nome: 'Item Z', unidade: 'un', processo: 'Marcenaria', preco_unitario: 3 },
  { id: 12, nome: 'Item C', unidade: 'un', processo: 'Marcenaria', preco_unitario: 4 },
  { id: 13, nome: 'Item A', unidade: 'un', processo: 'Acabamento', preco_unitario: 5 }
];

test('insumos voltam na posição que o usuário montou, não em ordem de id', async () => {
  const { listarInsumosProduto } = carregarComTabelas({
    produtos: [PRODUTO],
    // Gravados fora de ordem de propósito: só `ordem_insumo` manda.
    produtos_insumos: [
      { id: 3, produto_id: 1, insumo_id: 12, quantidade: 1, ordem_insumo: 3 },
      { id: 1, produto_id: 1, insumo_id: 10, quantidade: 1, ordem_insumo: 1 },
      { id: 2, produto_id: 1, insumo_id: 11, quantidade: 1, ordem_insumo: 2 }
    ],
    materia_prima: MATERIAS,
    produtos_lotes: []
  });

  const itens = await listarInsumosProduto({ produtoId: 1 });

  assert.deepStrictEqual(
    itens.map(i => i.nome),
    ['Item X', 'Item Z', 'Item C'],
    'posição 1 = Item X, 2 = Item Z, 3 = Item C'
  );
});

test('processo não reordena a sequência: "Marcenaria" antes de "Acabamento" se foi assim que o usuário montou', async () => {
  const { listarInsumosProduto } = carregarComTabelas({
    produtos: [PRODUTO],
    produtos_insumos: [
      { id: 1, produto_id: 1, insumo_id: 10, quantidade: 1, ordem_insumo: 1 },
      { id: 2, produto_id: 1, insumo_id: 11, quantidade: 1, ordem_insumo: 2 },
      { id: 3, produto_id: 1, insumo_id: 13, quantidade: 1, ordem_insumo: 3 }
    ],
    materia_prima: MATERIAS,
    produtos_lotes: []
  });

  const itens = await listarInsumosProduto({ produtoId: 1 });

  // Em ordem alfabética de processo, "Acabamento" viria primeiro.
  assert.deepStrictEqual(itens.map(i => i.nome), ['Item X', 'Item Z', 'Item A']);
  assert.deepStrictEqual(itens.map(i => i.ordem_insumo), [1, 2, 3]);
});
