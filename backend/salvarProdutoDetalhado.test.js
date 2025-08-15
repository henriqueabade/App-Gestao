const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

function createMockDb() {
  const db = newDb();
  db.public.none(`CREATE TABLE produtos (
    codigo text primary key,
    pct_fabricacao numeric,
    pct_acabamento numeric,
    pct_montagem numeric,
    pct_embalagem numeric,
    pct_markup numeric,
    pct_comissao numeric,
    pct_imposto numeric,
    preco_base numeric,
    preco_venda numeric,
    nome text,
    ncm text,
    data timestamp
  );`);
  db.public.none(`CREATE TABLE produtos_insumos (
    id serial primary key,
    produto_codigo text references produtos(codigo),
    insumo_id integer,
    quantidade numeric
  );`);
  db.public.none(`INSERT INTO produtos (codigo, pct_fabricacao, pct_acabamento, pct_montagem, pct_embalagem, pct_markup, pct_comissao, pct_imposto, preco_base, preco_venda)
                  VALUES ('P001',0,0,0,0,0,0,0,0,0);`);
  return db;
}

test('salvarProdutoDetalhado preenche produto_codigo ao inserir insumo', async () => {
  const mem = createMockDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = { exports: { query: (text, params) => pool.query(text, params), connect: () => pool.connect() } };
  delete require.cache[require.resolve('./produtos')];
  const { salvarProdutoDetalhado } = require('./produtos');

  await salvarProdutoDetalhado('P001', {
    pct_fabricacao: 1,
    pct_acabamento: 1,
    pct_montagem: 1,
    pct_embalagem: 1,
    pct_markup: 1,
    pct_comissao: 1,
    pct_imposto: 1,
    preco_base: 10,
    preco_venda: 20
  }, {
    inseridos: [{ insumo_id: 5, quantidade: 2 }]
  });

  const res = await pool.query('SELECT produto_codigo FROM produtos_insumos');
  assert.strictEqual(res.rows.length, 1);
  assert.strictEqual(res.rows[0].produto_codigo, 'P001');
});

test('salvarProdutoDetalhado atualiza codigo e mantém vínculos', async () => {
  const mem = createMockDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = { exports: { query: (text, params) => pool.query(text, params), connect: () => pool.connect() } };
  delete require.cache[require.resolve('./produtos')];
  const { salvarProdutoDetalhado } = require('./produtos');

  await pool.query('INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade) VALUES ($1,$2,$3)', ['P001', 1, 1]);

  await salvarProdutoDetalhado('P001', {
    pct_fabricacao: 0,
    pct_acabamento: 0,
    pct_montagem: 0,
    pct_embalagem: 0,
    pct_markup: 0,
    pct_comissao: 0,
    pct_imposto: 0,
    preco_base: 0,
    preco_venda: 0,
    codigo: 'P002'
  }, {});

  const resProdutos = await pool.query('SELECT codigo FROM produtos ORDER BY codigo');
  assert.deepStrictEqual(resProdutos.rows.map(r => r.codigo), ['P002']);
  const resInsumos = await pool.query('SELECT produto_codigo FROM produtos_insumos');
  assert.strictEqual(resInsumos.rows[0].produto_codigo, 'P002');
});
