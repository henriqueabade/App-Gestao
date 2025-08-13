const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.none(`CREATE TABLE produtos_em_cada_ponto (
    id serial primary key,
    produto_id int,
    etapa_id text,
    ultimo_insumo_id int,
    quantidade int,
    data_hora_completa timestamp
  );`);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params)
    }
  };
  const produtosPath = require.resolve('./produtos');
  delete require.cache[produtosPath];
  const { inserirLoteProduto } = require('./produtos');
  return { inserirLoteProduto, pool };
}

test('inserirLoteProduto insere e retorna o lote criado', async () => {
  const { inserirLoteProduto, pool } = setup();
  const lote = await inserirLoteProduto({
    produtoId: 1,
    etapaId: 'Corte',
    ultimoInsumoId: 3,
    quantidade: 5
  });
  assert.strictEqual(lote.produto_id, 1);
  assert.strictEqual(lote.etapa_id, 'Corte');
  assert.strictEqual(lote.ultimo_insumo_id, 3);
  assert.strictEqual(lote.quantidade, 5);
  assert(lote.data_hora_completa instanceof Date);
  const rows = await pool.query('SELECT * FROM produtos_em_cada_ponto');
  assert.strictEqual(rows.rows.length, 1);
});

test('inserirLoteProduto permite múltiplas inserções', async () => {
  const { inserirLoteProduto, pool } = setup();
  await inserirLoteProduto({ produtoId: 1, etapaId: 'Corte', ultimoInsumoId: 1, quantidade: 1 });
  await inserirLoteProduto({ produtoId: 2, etapaId: 'Costura', ultimoInsumoId: 2, quantidade: 2 });
  const rows = await pool.query('SELECT quantidade FROM produtos_em_cada_ponto ORDER BY id');
  assert.deepStrictEqual(rows.rows.map(r => r.quantidade), [1, 2]);
});
