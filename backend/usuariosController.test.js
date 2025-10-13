const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.none(`CREATE TABLE usuarios (
    id serial primary key,
    nome text,
    email text,
    perfil text,
    verificado boolean default false,
    hora_ativacao timestamp
  );`);
  db.public.none(
    "INSERT INTO usuarios (nome, email, perfil, verificado) VALUES ('Maria', 'maria@example.com', 'admin', false);"
  );

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('./db');
  const originalModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      query: (text, params) => pool.query(text, params)
    }
  };

  const usuariosControllerPath = require.resolve('./usuariosController');
  delete require.cache[usuariosControllerPath];
  const usuariosController = require('./usuariosController');

  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', usuariosController);

  const server = http.createServer(app);

  async function listen() {
    await new Promise(resolve => server.listen(0, resolve));
    const address = server.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  async function close() {
    await new Promise(resolve => server.close(resolve));
    if (originalModule) {
      require.cache[dbModulePath] = originalModule;
    } else {
      delete require.cache[dbModulePath];
    }
    delete require.cache[usuariosControllerPath];
  }

  return { pool, listen, close };
}

test('PATCH /api/usuarios/:id/status alterna verificado e atualiza hora_ativacao', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}/api/usuarios/1/status`;

  try {
    const primeiraResposta = await fetch(baseUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ativo: true })
    });

    assert.strictEqual(primeiraResposta.status, 200);
    const primeiroUsuario = await primeiraResposta.json();
    assert.strictEqual(primeiroUsuario.status, 'Ativo');
    assert.strictEqual(primeiroUsuario.hora_ativacao !== null, true);

    const primeiroRegistro = await pool.query(
      'SELECT verificado, hora_ativacao FROM usuarios WHERE id = 1'
    );
    assert.strictEqual(primeiroRegistro.rows[0].verificado, true);
    const primeiraAtivacao = primeiroRegistro.rows[0].hora_ativacao;
    assert.ok(primeiraAtivacao instanceof Date);

    await new Promise(resolve => setTimeout(resolve, 5));

    const segundaResposta = await fetch(baseUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'Inativo' })
    });

    assert.strictEqual(segundaResposta.status, 200);
    const segundoUsuario = await segundaResposta.json();
    assert.strictEqual(segundoUsuario.status, 'Inativo');
    assert.ok(segundoUsuario.hora_ativacao);

    const segundoRegistro = await pool.query(
      'SELECT verificado, hora_ativacao FROM usuarios WHERE id = 1'
    );
    assert.strictEqual(segundoRegistro.rows[0].verificado, false);
    assert.ok(segundoRegistro.rows[0].hora_ativacao instanceof Date);
    assert.ok(segundoRegistro.rows[0].hora_ativacao.getTime() >= primeiraAtivacao.getTime());
  } finally {
    await close();
  }
});
