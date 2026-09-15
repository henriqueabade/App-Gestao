const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { createLocalDataClient } = require('./localDataClient');

test('detalhes DEV carregam lotes sem coluna ultimo_item e resolvem o nome pelo insumo', async t => {
  const memory = newDb();
  memory.public.none(`
    CREATE TABLE produtos (id integer PRIMARY KEY, codigo text, nome text);
    CREATE TABLE produtos_insumos (id integer, produto_id integer, produto_codigo text, insumo_id integer, quantidade numeric, ordem_insumo integer);
    CREATE TABLE materia_prima (id integer PRIMARY KEY, nome text, preco_unitario numeric, unidade text, processo text);
    CREATE TABLE produtos_em_cada_ponto (
      id integer PRIMARY KEY, produto_id integer, quantidade numeric,
      ultimo_insumo_id integer, data_hora_completa timestamptz,
      etapa_id integer, tempo_estimado_minutos integer
    );
    INSERT INTO produtos VALUES (1, 'PECA-01', 'Peça de teste');
    INSERT INTO materia_prima VALUES (10, 'Madeira', 20, 'm2', 'Corte');
    INSERT INTO produtos_em_cada_ponto VALUES
      (1, 1, 3, 10, '2026-09-15T12:00:00Z', 2, 30),
      (2, 1, 1, NULL, '2026-09-14T12:00:00Z', 1, 15),
      (3, 2, 5, 10, '2026-09-15T12:00:00Z', 2, 30);
  `);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const dbPath = require.resolve('./db');
  const produtosPath = require.resolve('./produtos');
  const previousDb = require.cache[dbPath];
  const previousProdutos = require.cache[produtosPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: createLocalDataClient(pool) };
  delete require.cache[produtosPath];
  t.after(async () => {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousProdutos) require.cache[produtosPath] = previousProdutos;
    else delete require.cache[produtosPath];
    await pool.end();
  });
  const detalhes = await require('./produtos').listarDetalhesProduto(1);
  assert.equal(detalhes.produto.id, 1);
  assert.deepEqual(detalhes.lotes.map(lote => lote.id), [1, 2]);
  assert.equal(detalhes.lotes[0].ultimo_item, 'Madeira');
  assert.equal(detalhes.lotes[1].ultimo_item, null);
  assert.equal(Number(detalhes.lotes[0].quantidade), 3);
});
