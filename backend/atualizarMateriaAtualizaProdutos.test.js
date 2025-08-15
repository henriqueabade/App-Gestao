const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

function setupDb() {
  const db = newDb();
  db.public.none(`CREATE TABLE materia_prima (
    id serial primary key,
    nome text,
    categoria text,
    quantidade numeric,
    unidade text,
    preco_unitario numeric,
    processo text,
    infinito boolean,
    descricao text,
    data_preco timestamp,
    data_estoque timestamp
  );`);
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
    data timestamp
  );`);
  db.public.none(`CREATE TABLE produtos_insumos (
    produto_codigo text,
    insumo_id int,
    quantidade numeric
  );`);
  return db;
}

test('atualizarMateria atualiza precos de produtos relacionados', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect(),
    },
  };
  delete require.cache[require.resolve('./materiaPrima')];
  const { atualizarMateria } = require('./materiaPrima');

  await pool.query(`INSERT INTO materia_prima (id, nome, categoria, quantidade, unidade, preco_unitario, processo, infinito, descricao, data_preco, data_estoque) VALUES (1,'Insumo A','Cat',0,'kg',10,'Proc',false,'desc',NOW(),NOW())`);
  await pool.query(`INSERT INTO produtos (codigo, pct_fabricacao, pct_acabamento, pct_montagem, pct_embalagem, pct_markup, pct_comissao, pct_imposto, preco_base, preco_venda, data) VALUES ('P1',10,5,0,0,20,5,10,0,0,NOW())`);
  await pool.query(`INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade) VALUES ('P1',1,2)`);

  await atualizarMateria(1, { nome:'Insumo A', categoria:'Cat', quantidade:0, unidade:'kg', preco_unitario:15, processo:'Proc', infinito:false, descricao:'desc' });

  const res = await pool.query('SELECT preco_base, preco_venda FROM produtos WHERE codigo=$1', ['P1']);
  const base = Number(res.rows[0].preco_base);
  const venda = Number(res.rows[0].preco_venda);
  assert.strictEqual(base, 30);
  assert.ok(Math.abs(venda - 47.6470588235) < 1e-6);
});
