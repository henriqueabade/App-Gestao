const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { newDb } = require('pg-mem');
const { seedRbacPermissions } = require('./scripts/seed_rbac_permissions');

function setupDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE pedidos (
      id integer primary key,
      situacao text,
      data_envio timestamp,
      data_entrega timestamp,
      data_aprovacao timestamp,
      data_cancelamento timestamp
    );
  `);
  db.public.none(`
    CREATE TABLE usuarios (
      id integer primary key,
      nome text,
      email text,
      classificacao text,
      perfil text
    );
  `);
  return db;
}

async function bootstrapPedidosApp(pool) {
  const dbModulePath = require.resolve('./db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  await seedRbacPermissions({ query: (text, params) => pool.query(text, params) });
  await pool.query(
    "INSERT INTO usuarios (id, nome, email, classificacao, perfil) VALUES (1, 'Sup', 'sup@example.com', 'sup_admin', 'Sup Admin')"
  );
  await pool.query(
    "INSERT INTO usuarios (id, nome, email, classificacao, perfil) VALUES (2, 'Sem Role', 'semrole@example.com', NULL, 'Visitante')"
  );

  delete require.cache[require.resolve('./pedidosController')];
  const pedidosRouter = require('./pedidosController');

  const app = express();
  app.use(express.json());
  app.use('/api/pedidos', pedidosRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }
    delete require.cache[require.resolve('./pedidosController')];
  }

  return { port, close };
}

test('PUT /api/pedidos/:id/status atualiza datas de envio e entrega', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO pedidos (id, situacao) VALUES (1, 'Em Produção');`);

  const { port, close } = await bootstrapPedidosApp(pool);

  let res = await fetch(`http://localhost:${port}/api/pedidos/1/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer 1' },
    body: JSON.stringify({ status: 'Enviado' })
  });
  assert.strictEqual(res.status, 200);
  const { rows: afterSend } = await pool.query('SELECT data_envio, data_entrega FROM pedidos WHERE id=1');
  assert(afterSend[0].data_envio);
  assert.strictEqual(afterSend[0].data_entrega, null);
  const envioDate = afterSend[0].data_envio;

  res = await fetch(`http://localhost:${port}/api/pedidos/1/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer 1' },
    body: JSON.stringify({ status: 'Entregue' })
  });
  assert.strictEqual(res.status, 200);
  const { rows: afterDeliver } = await pool.query('SELECT data_envio, data_entrega FROM pedidos WHERE id=1');
  assert(afterDeliver[0].data_entrega);
  assert.strictEqual(afterDeliver[0].data_envio.toISOString(), envioDate.toISOString());

  await close();
});

test('PUT /api/pedidos/:id/status retorna 403 sem permissão de edição', async () => {
  const mem = setupDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  await pool.query(`INSERT INTO pedidos (id, situacao) VALUES (2, 'Em Produção');`);

  const { port, close } = await bootstrapPedidosApp(pool);

  const res = await fetch(`http://localhost:${port}/api/pedidos/2/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer 2' },
    body: JSON.stringify({ status: 'Entregue' })
  });
  assert.strictEqual(res.status, 403);
  const body = await res.json();
  assert.deepStrictEqual(body, { error: 'forbidden', feature: 'pedidos.editar' });

  await close();
});

