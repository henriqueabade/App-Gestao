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
  return db;
}

test('adicionarMateria rejeita nomes duplicados', async () => {
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
  const { adicionarMateria } = require('./materiaPrima');

  await adicionarMateria({
    nome: 'Insumo A',
    quantidade: 1,
    preco_unitario: 0,
    categoria: 'Cat',
    unidade: 'kg',
    infinito: false,
    processo: 'Proc',
    descricao: ''
  });

  await assert.rejects(
    adicionarMateria({
      nome: 'Insumo A',
      quantidade: 1,
      preco_unitario: 0,
      categoria: 'Cat',
      unidade: 'kg',
      infinito: false,
      processo: 'Proc',
      descricao: ''
    }),
    /DUPLICADO/
  );
});

test('atualizarMateria rejeita nomes duplicados', async () => {
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
  const { adicionarMateria, atualizarMateria } = require('./materiaPrima');

  const ins1 = await adicionarMateria({
    nome: 'Insumo A',
    quantidade: 1,
    preco_unitario: 0,
    categoria: 'Cat',
    unidade: 'kg',
    infinito: false,
    processo: 'Proc',
    descricao: ''
  });
  const ins2 = await adicionarMateria({
    nome: 'Insumo B',
    quantidade: 1,
    preco_unitario: 0,
    categoria: 'Cat',
    unidade: 'kg',
    infinito: false,
    processo: 'Proc',
    descricao: ''
  });

  await assert.rejects(
    atualizarMateria(ins2.id, {
      nome: 'Insumo A',
      categoria: 'Cat',
      quantidade: 1,
      unidade: 'kg',
      preco_unitario: 0,
      processo: 'Proc',
      infinito: false,
      descricao: ''
    }),
    /DUPLICADO/
  );
});

