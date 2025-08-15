const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.none(`CREATE TABLE produtos (
    id serial primary key,
    codigo text unique,
    pct_fabricacao numeric,
    pct_acabamento numeric,
    pct_montagem numeric,
    pct_embalagem numeric,
    pct_markup numeric,
    pct_comissao numeric,
    pct_imposto numeric,
    preco_base numeric,
    preco_venda numeric,
    nome text unique,
    ncm text,
    categoria text,
    status text,
    data timestamp
  );`);
  db.public.none(`CREATE TABLE produtos_insumos (
    id serial primary key,
    produto_codigo text,
    insumo_id int,
    quantidade numeric
  );`);
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
  const { adicionarProduto, atualizarProduto, salvarProdutoDetalhado } = require('./produtos');
  return { adicionarProduto, atualizarProduto, salvarProdutoDetalhado, pool };
}

test('adicionarProduto exige todos os campos', async () => {
  const { adicionarProduto } = setup();
  await assert.rejects(
    adicionarProduto({ nome: 'Prod1', preco_venda: 0, pct_markup: 0, status: 'ativo' }),
    /Código é obrigatório/
  );
  await assert.rejects(
    adicionarProduto({ codigo: 'P1', preco_venda: 0, pct_markup: 0, status: 'ativo' }),
    /Nome é obrigatório/
  );
  await assert.rejects(
    adicionarProduto({ codigo: 'P1', nome: 'Prod1', pct_markup: 0, status: 'ativo' }),
    /Preço de venda é obrigatório/
  );
  await assert.rejects(
    adicionarProduto({ codigo: 'P1', nome: 'Prod1', preco_venda: 0, status: 'ativo' }),
    /Markup é obrigatório/
  );
  await assert.rejects(
    adicionarProduto({ codigo: 'P1', nome: 'Prod1', preco_venda: 0, pct_markup: 0 }),
    /Status é obrigatório/
  );
});

test('atualizarProduto atualiza produtos_insumos ao mudar codigo', async () => {
  const { adicionarProduto, atualizarProduto, pool } = setup();
  const { id } = await adicionarProduto({
    codigo: 'P1',
    nome: 'Prod1',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  await pool.query(
    "INSERT INTO produtos_insumos (produto_codigo, insumo_id, quantidade) VALUES ('P1',1,1)"
  );
  await atualizarProduto(id, {
    codigo: 'P2',
    nome: 'Prod1',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  const res = await pool.query('SELECT produto_codigo FROM produtos_insumos');
  assert.strictEqual(res.rows[0].produto_codigo, 'P2');
});

test('adicionarProduto rejeita códigos e nomes duplicados', async () => {
  const { adicionarProduto } = setup();
  await adicionarProduto({
    codigo: 'A1',
    nome: 'ProdA',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  await assert.rejects(
    adicionarProduto({
      codigo: 'A1',
      nome: 'ProdB',
      preco_venda: 0,
      pct_markup: 0,
      status: 'ativo'
    }),
    /Código já existe/
  );
  await assert.rejects(
    adicionarProduto({
      codigo: 'A2',
      nome: 'ProdA',
      preco_venda: 0,
      pct_markup: 0,
      status: 'ativo'
    }),
    /Nome já existe/
  );
});

test('atualizarProduto rejeita duplicados de código e nome', async () => {
  const { adicionarProduto, atualizarProduto } = setup();
  const p1 = await adicionarProduto({
    codigo: 'B1',
    nome: 'ProdB1',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  const p2 = await adicionarProduto({
    codigo: 'B2',
    nome: 'ProdB2',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  await assert.rejects(
    atualizarProduto(p2.id, {
      codigo: 'B1',
      nome: 'ProdB2',
      preco_venda: 0,
      pct_markup: 0,
      status: 'ativo'
    }),
    /Código já existe/
  );
  await assert.rejects(
    atualizarProduto(p2.id, {
      codigo: 'B2',
      nome: 'ProdB1',
      preco_venda: 0,
      pct_markup: 0,
      status: 'ativo'
    }),
    /Nome já existe/
  );
});

test('salvarProdutoDetalhado rejeita código e nome duplicados', async () => {
  const { adicionarProduto, salvarProdutoDetalhado } = setup();
  await adicionarProduto({
    codigo: 'C1',
    nome: 'ProdC1',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  await adicionarProduto({
    codigo: 'C2',
    nome: 'ProdC2',
    preco_venda: 0,
    pct_markup: 0,
    status: 'ativo'
  });
  await assert.rejects(
    salvarProdutoDetalhado('C2', {
      codigo: 'C1',
      pct_fabricacao: 0,
      pct_acabamento: 0,
      pct_montagem: 0,
      pct_embalagem: 0,
      pct_markup: 0,
      pct_comissao: 0,
      pct_imposto: 0,
      preco_base: 0,
      preco_venda: 0
    }, {}),
    /Código já existe/
  );
  await assert.rejects(
    salvarProdutoDetalhado('C2', {
      nome: 'ProdC1',
      pct_fabricacao: 0,
      pct_acabamento: 0,
      pct_montagem: 0,
      pct_embalagem: 0,
      pct_markup: 0,
      pct_comissao: 0,
      pct_imposto: 0,
      preco_base: 0,
      preco_venda: 0
    }, {}),
    /Nome já existe/
  );
});
