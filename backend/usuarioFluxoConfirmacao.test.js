const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcrypt');
const { newDb } = require('pg-mem');

function createTable(db) {
  db.public.none(`CREATE TABLE usuarios (
    id serial primary key,
    nome text,
    email text,
    perfil text,
    senha text,
    verificado boolean default false,
    status text default 'nao_confirmado',
    confirmacao boolean default false,
    email_confirmado boolean default false,
    email_confirmado_em timestamp,
    confirmacao_token text,
    confirmacao_token_gerado_em timestamp,
    confirmacao_token_expira_em timestamp,
    confirmacao_token_revogado_em timestamp,
    status_atualizado_em timestamp,
    hora_ativacao timestamptz
  );`);
}

function setupEnvironment() {
  const db = newDb();
  createTable(db);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const dbModulePath = require.resolve('./db');
  const originalDbModule = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    exports: {
      init: () => pool,
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
    }
  };

  const confirmModulePath = require.resolve('../src/email/sendEmailConfirmationRequest');
  const originalConfirmModule = require.cache[confirmModulePath];
  const confirmationEmails = [];
  require.cache[confirmModulePath] = {
    exports: {
      sendEmailConfirmationRequest: async payload => {
        confirmationEmails.push(payload);
      }
    }
  };

  const supAdminModulePath = require.resolve('../src/email/sendSupAdminReviewNotification');
  const originalSupAdminModule = require.cache[supAdminModulePath];
  const supAdminEmails = [];
  require.cache[supAdminModulePath] = {
    exports: {
      sendSupAdminReviewNotification: async payload => {
        supAdminEmails.push(payload);
      }
    }
  };

  const activationModulePath = require.resolve('../src/email/sendUserActivationNotice');
  const originalActivationModule = require.cache[activationModulePath];
  const activationEmails = [];
  require.cache[activationModulePath] = {
    exports: {
      sendUserActivationNotice: async payload => {
        activationEmails.push(payload);
      }
    }
  };

  const backendPath = require.resolve('./backend');
  const usuariosControllerPath = require.resolve('./usuariosController');

  delete require.cache[backendPath];
  delete require.cache[usuariosControllerPath];

  async function cleanup() {
    delete require.cache[backendPath];
    delete require.cache[usuariosControllerPath];

    if (originalDbModule) {
      require.cache[dbModulePath] = originalDbModule;
    } else {
      delete require.cache[dbModulePath];
    }

    if (originalConfirmModule) {
      require.cache[confirmModulePath] = originalConfirmModule;
    } else {
      delete require.cache[confirmModulePath];
    }

    if (originalSupAdminModule) {
      require.cache[supAdminModulePath] = originalSupAdminModule;
    } else {
      delete require.cache[supAdminModulePath];
    }

    if (originalActivationModule) {
      require.cache[activationModulePath] = originalActivationModule;
    } else {
      delete require.cache[activationModulePath];
    }
  }

  return {
    pool,
    cleanup,
    confirmationEmails,
    supAdminEmails,
    activationEmails
  };
}

function createServer() {
  const app = express();
  app.use(express.json());
  const usuariosController = require('./usuariosController');
  app.use('/api/usuarios', usuariosController);
  const server = http.createServer(app);

  return {
    server,
    async listen() {
      await new Promise(resolve => server.listen(0, resolve));
      const address = server.address();
      if (typeof address === 'object' && address) {
        return address.port;
      }
      throw new Error('Falha ao obter porta do servidor de teste');
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    }
  };
}

test('registrarUsuario cria token e envia e-mail de confirmação', async () => {
  const { pool, cleanup, confirmationEmails } = setupEnvironment();
  try {
    const { registrarUsuario } = require('./backend');
    const resultado = await registrarUsuario('Fulano', 'FULANO@example.com', 'senhaSegura', 5432);
    assert.ok(resultado.id);

    const registro = await pool.query('SELECT * FROM usuarios WHERE id = $1', [resultado.id]);
    const usuario = registro.rows[0];
    assert.strictEqual(usuario.email, 'fulano@example.com');
    assert.strictEqual(usuario.status, 'nao_confirmado');
    assert.strictEqual(usuario.confirmacao, false);
    assert.strictEqual(usuario.email_confirmado, false);
    assert.ok(typeof usuario.confirmacao_token === 'string' && usuario.confirmacao_token.length > 20);
    assert.ok(usuario.confirmacao_token_expira_em instanceof Date);

    assert.strictEqual(confirmationEmails.length, 1);
    assert.strictEqual(confirmationEmails[0].to, 'FULANO@example.com');
    assert.strictEqual(confirmationEmails[0].token, usuario.confirmacao_token);
  } finally {
    await cleanup();
  }
});

test('GET /api/usuarios/confirmar-email valida token e atualiza status', async () => {
  const { pool, cleanup, supAdminEmails } = setupEnvironment();
  const token = 'token-confirm';
  try {
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha, status, confirmacao_token, confirmacao_token_expira_em)
       VALUES ($1, $2, $3, 'nao_confirmado', $4, $5)`,
      ['Joana', 'joana@example.com', 'hash', token, new Date(Date.now() + 60 * 60 * 1000)]
    );

    const { listen, close } = createServer();
    const port = await listen();

    try {
      const resposta = await fetch(`http://127.0.0.1:${port}/api/usuarios/confirmar-email?token=${token}`);
      assert.strictEqual(resposta.status, 200);
      const corpo = await resposta.text();
      assert.ok(corpo.includes('Confirmação registrada'));

      const registro = await pool.query(
        'SELECT confirmacao, email_confirmado, status, confirmacao_token FROM usuarios WHERE email = $1',
        ['joana@example.com']
      );
      const usuario = registro.rows[0];
      assert.strictEqual(usuario.confirmacao, true);
      assert.strictEqual(usuario.email_confirmado, true);
      assert.strictEqual(usuario.status, 'aguardando_aprovacao');
      assert.strictEqual(usuario.confirmacao_token, null);

      assert.strictEqual(supAdminEmails.length, 1);
      assert.strictEqual(supAdminEmails[0].usuarioEmail, 'joana@example.com');
    } finally {
      await close();
    }
  } finally {
    await cleanup();
  }
});

test('GET /api/usuarios/reportar-email-incorreto revoga token e alerta Sup Admin', async () => {
  const { pool, cleanup, supAdminEmails } = setupEnvironment();
  const token = 'token-reporte';
  try {
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha, status, confirmacao, email_confirmado, confirmacao_token, confirmacao_token_expira_em)
       VALUES ($1, $2, $3, 'nao_confirmado', false, false, $4, $5)`,
      ['Carlos', 'carlos@example.com', 'hash', token, new Date(Date.now() + 60 * 60 * 1000)]
    );

    const { listen, close } = createServer();
    const port = await listen();

    try {
      const resposta = await fetch(`http://127.0.0.1:${port}/api/usuarios/reportar-email-incorreto?token=${token}`);
      assert.strictEqual(resposta.status, 200);
      const corpo = await resposta.text();
      assert.ok(corpo.includes('Relato registrado'));

      const registro = await pool.query(
        'SELECT confirmacao, email_confirmado, status, confirmacao_token FROM usuarios WHERE email = $1',
        ['carlos@example.com']
      );
      const usuario = registro.rows[0];
      assert.strictEqual(usuario.confirmacao, false);
      assert.strictEqual(usuario.email_confirmado, false);
      assert.strictEqual(usuario.status, 'nao_confirmado');
      assert.strictEqual(usuario.confirmacao_token, null);

      assert.strictEqual(supAdminEmails.length, 1);
      assert.strictEqual(supAdminEmails[0].usuarioEmail, 'carlos@example.com');
    } finally {
      await close();
    }
  } finally {
    await cleanup();
  }
});

test('POST /api/usuarios/aprovar exige Sup Admin e envia e-mail de ativação', async () => {
  const { pool, cleanup, activationEmails } = setupEnvironment();
  try {
    const senhaSupAdmin = await bcrypt.hash('senhaSupAdmin', 10);
    await pool.query(
      `INSERT INTO usuarios (nome, email, senha, perfil, status, verificado, confirmacao, email_confirmado)
       VALUES ('Administrador', 'admin@example.com', $1, 'Sup Admin', 'ativo', true, true, true)`,
      [senhaSupAdmin]
    );

    await pool.query(
      `INSERT INTO usuarios (nome, email, senha, status, confirmacao, email_confirmado, confirmacao_token)
       VALUES ('Beatriz', 'bia@example.com', 'hash', 'aguardando_aprovacao', true, true, 'token-aprovar')`
    );

    const { listen, close } = createServer();
    const port = await listen();

    try {
      const resposta = await fetch(`http://127.0.0.1:${port}/api/usuarios/aprovar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          usuarioId: 2,
          supAdminEmail: 'admin@example.com',
          supAdminSenha: 'senhaSupAdmin'
        })
      });

      assert.strictEqual(resposta.status, 200);
      const corpo = await resposta.json();
      assert.strictEqual(corpo.message, 'Usuário aprovado com sucesso.');
      assert.strictEqual(corpo.usuario.statusInterno, 'ativo');

      const registro = await pool.query(
        'SELECT status, verificado, confirmacao, email_confirmado, hora_ativacao FROM usuarios WHERE email = $1',
        ['bia@example.com']
      );
      const usuario = registro.rows[0];
      assert.strictEqual(usuario.status, 'ativo');
      assert.strictEqual(usuario.verificado, true);
      assert.strictEqual(usuario.confirmacao, true);
      assert.strictEqual(usuario.email_confirmado, true);
      assert.ok(usuario.hora_ativacao instanceof Date);

      assert.strictEqual(activationEmails.length, 1);
      assert.strictEqual(activationEmails[0].to, 'bia@example.com');
    } finally {
      await close();
    }
  } finally {
    await cleanup();
  }
});
