const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.none(`CREATE TABLE produtos (
    id serial primary key,
    codigo text
  );`);
  db.public.none(`CREATE TABLE produtos_insumos (
    id serial primary key,
    produto_codigo text
  );`);
  db.public.none(`CREATE TABLE produtos_em_cada_ponto (
    id serial primary key,
    produto_id int
  );`);
  db.public.none(`CREATE TABLE orcamentos_itens (
    id serial primary key,
    produto_id int
  );`);
  db.public.none("INSERT INTO produtos (id, codigo) VALUES (1, 'P001');");
  db.public.none("INSERT INTO produtos_insumos (produto_codigo) VALUES ('P001');");
  db.public.none('INSERT INTO produtos_em_cada_ponto (produto_id) VALUES (1);');
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };
  const produtosPath = require.resolve('./produtos');
  delete require.cache[produtosPath];
  const { excluirProduto } = require('./produtos');
  return { excluirProduto, pool };
}

test('excluirProduto remove dependências', async () => {
  const { excluirProduto, pool } = setup();
  await excluirProduto(1);
  assert.strictEqual((await pool.query('SELECT * FROM produtos')).rowCount, 0);
  assert.strictEqual((await pool.query('SELECT * FROM produtos_insumos')).rowCount, 0);
  assert.strictEqual((await pool.query('SELECT * FROM produtos_em_cada_ponto')).rowCount, 0);
});

test('excluirProduto bloqueia se estiver em orçamento', async () => {
  const { excluirProduto, pool } = setup();
  await pool.query('INSERT INTO orcamentos_itens (produto_id) VALUES (1);');
  await assert.rejects(() => excluirProduto(1), /orçamento/i);
});

