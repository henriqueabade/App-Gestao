/**
 * Filtro local + `select` (06/10/2026, desempenho — Fase 2).
 *
 * Matéria-prima e Produtos leem com `getFiltrado`/`fetchSingle`, que além do
 * filtro na API refiltram aqui, comparando `linha[coluna]`. Várias leituras
 * pediam só `select: 'id'` filtrando por OUTRA coluna ("a categoria tem
 * dependência?", "o produto está em algum orçamento?"). A API antiga ignorava
 * o `select` e devolvia a linha inteira; quando ela passou a respeitá-lo, a
 * linha vinha sem a coluna do filtro, o refiltro descartava tudo e a resposta
 * virava sempre "não" — dava para excluir categoria em uso e produto que está
 * em orçamento. No modo DEV, que já respeitava o `select`, o defeito existia.
 *
 * Aqui a API de mentira RESPEITA o `select`, como a de verdade agora.
 */
const test = require('node:test');
const assert = require('node:assert');

const CONTROLES = new Set(['select', 'order', 'limit', 'offset']);

/** Uma API em memória com o contrato da genérica: WHERE nas colunas, `select` respeitado. */
function apiQueRespeitaOSelect(tabelas) {
  const pedidos = [];
  const tabelaDe = caminho => String(caminho).replace(/^\/(api\/)?/, '').split(/[/?]/)[0];
  const projetar = (linha, select) => {
    const nomes = String(select || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!nomes.length || nomes.includes('*') || nomes.some(n => n.startsWith('-'))) return { ...linha };
    return Object.fromEntries(nomes.filter(n => n in linha).map(n => [n, linha[n]]));
  };
  const get = async (caminho, { query = {} } = {}) => {
    pedidos.push({ caminho, query: { ...query } });
    const linhas = tabelas[tabelaDe(caminho)] || [];
    const filtradas = linhas.filter(l => Object.entries(query).every(([k, v]) =>
      CONTROLES.has(k) || !(k in l) || Array.isArray(v) || String(l[k]) === String(v)));
    return filtradas.map(l => projetar(l, query.select));
  };
  const apagados = [];
  return {
    pedidos,
    apagados,
    get,
    post: async (_c, corpo) => ({ id: 999, ...corpo }),
    put: async (_c, corpo) => ({ ...corpo }),
    patch: async (_c, corpo) => ({ ...corpo }),
    delete: async caminho => { apagados.push(caminho); return { sucesso: true }; }
  };
}

function carregarCom(modulo, api) {
  const caminhoDb = require.resolve('./db');
  const antes = require.cache[caminhoDb];
  require.cache[caminhoDb] = { id: caminhoDb, filename: caminhoDb, loaded: true, exports: api };
  delete require.cache[require.resolve(modulo)];
  try {
    return require(modulo);
  } finally {
    delete require.cache[require.resolve(modulo)];
    if (antes) require.cache[caminhoDb] = antes; else delete require.cache[caminhoDb];
  }
}

const MATERIAS = [
  { id: 1, nome: 'MDF', categoria: 'Madeira', unidade: 'chapa', processo: 'Marcenaria', quantidade: 3, preco_unitario: 10 },
  { id: 2, nome: 'Verniz', categoria: 'Acabamento', unidade: 'litro', processo: 'Pintura', quantidade: 1, preco_unitario: 5 }
];

test('Matéria-prima: categoria, unidade e processo em uso continuam com dependência', async () => {
  const api = apiQueRespeitaOSelect({ materia_prima: MATERIAS });
  const mp = carregarCom('./materiaPrima', api);
  assert.strictEqual(await mp.categoriaTemDependencias('Madeira'), true, 'categoria em uso pareceu livre');
  assert.strictEqual(await mp.unidadeTemDependencias('litro'), true, 'unidade em uso pareceu livre');
  assert.strictEqual(await mp.processoTemDependencias('Pintura'), true, 'processo em uso pareceu livre');
  assert.strictEqual(await mp.categoriaTemDependencias('Vidro'), false);
  // O `select` pedido ganha a coluna do filtro — continua enxuto.
  const pedido = api.pedidos.find(p => p.query.categoria === 'Madeira');
  assert.strictEqual(pedido.query.select, 'id,categoria');
});

test('Matéria-prima: excluir categoria e unidade em uso é recusado', async () => {
  const api = apiQueRespeitaOSelect({
    materia_prima: MATERIAS,
    categoria: [{ id: 7, nome_categoria: 'Madeira' }],
    unidades: [{ id: 8, tipo: 'chapa' }]
  });
  const mp = carregarCom('./materiaPrima', api);
  await assert.rejects(() => mp.removerCategoria('Madeira'), err => err.code === 'DEPENDENTE');
  await assert.rejects(() => mp.removerUnidade('chapa'), err => err.code === 'DEPENDENTE');
  assert.deepStrictEqual(api.apagados, [], 'apagou o que estava em uso');
});

test('Produtos: produto que está em orçamento não é excluído; coleção em uso também não', async () => {
  const api = apiQueRespeitaOSelect({
    produtos: [{ id: 5, codigo: 'P-5', nome: 'Mesa', categoria: 'Clássica' }],
    orcamentos_itens: [{ id: 40, produto_id: 5, quantidade: 1 }],
    colecao: [{ id: 3, nome: 'Clássica' }]
  });
  const produtos = carregarCom('./produtos', api);
  const silencioso = console.info;
  console.info = () => {};
  try {
    await assert.rejects(() => produtos.excluirProduto(5), /Orçamentos/);
  } finally {
    console.info = silencioso;
  }
  await assert.rejects(() => produtos.removerColecao('Clássica'), err => err.code === 'DEPENDENTE');
  assert.deepStrictEqual(api.apagados, [], 'apagou o que estava em uso');
});

test('Produtos: as linhas da rota do produto são achadas para apagar', async () => {
  const api = apiQueRespeitaOSelect({
    produtos: [{ id: 6, codigo: 'P-6', nome: 'Cadeira' }],
    orcamentos_itens: [],
    produtos_insumos: [{ id: 70, produto_id: 6, insumo_id: 1 }, { id: 71, produto_id: 6, insumo_id: 2 }, { id: 72, produto_id: 9, insumo_id: 1 }]
  });
  const produtos = carregarCom('./produtos', api);
  const silencioso = console.info;
  console.info = () => {};
  try {
    await produtos.excluirProduto(6).catch(() => null); // o que vem depois (lotes, tabela fixa) não importa aqui
  } finally {
    console.info = silencioso;
  }
  const rota = api.apagados.filter(c => c.startsWith('/produtos_insumos/')).sort();
  assert.deepStrictEqual(rota, ['/produtos_insumos/70', '/produtos_insumos/71']);
});
