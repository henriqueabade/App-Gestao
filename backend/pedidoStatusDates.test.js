const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { newDb } = require('pg-mem');

function setupDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE pedidos (
      id integer primary key,
      situacao text,
      data_envio timestamp,
      data_entrega timestamp
    );
  `);
  return db;
}

test('PUT /api/pedidos/:id/status atualiza datas de envio e entrega', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO pedidos (id, situacao) VALUES (1, 'Em Produção');`);

  const dbModulePath = require.resolve('./db');
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };
  delete require.cache[require.resolve('./pedidosController')];
  const pedidosRouter = require('./pedidosController');

  const app = express();
  app.use(express.json());
  app.use('/api/pedidos', pedidosRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  let res = await fetch(`http://localhost:${port}/api/pedidos/1/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Enviado' })
  });
  assert.strictEqual(res.status, 200);
  const { rows: afterSend } = await pool.query('SELECT data_envio, data_entrega FROM pedidos WHERE id=1');
  assert(afterSend[0].data_envio);
  assert.strictEqual(afterSend[0].data_entrega, null);
  const envioDate = afterSend[0].data_envio;

  res = await fetch(`http://localhost:${port}/api/pedidos/1/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'Entregue' })
  });
  assert.strictEqual(res.status, 200);
  const { rows: afterDeliver } = await pool.query('SELECT data_envio, data_entrega FROM pedidos WHERE id=1');
  assert(afterDeliver[0].data_entrega);
  assert.strictEqual(afterDeliver[0].data_envio.toISOString(), envioDate.toISOString());

  server.close();
});

