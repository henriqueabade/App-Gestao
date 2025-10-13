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
    senha text,
    telefone text,
    telefone_celular text,
    whatsapp text,
    descricao text,
    foto_usuario bytea,
    verificado boolean default false,
    status text default 'nao_confirmado',
    confirmacao boolean default false,
    email_confirmado boolean default false,
    email_confirmado_em timestamp,
    aprovacao_token text,
    aprovacao_token_gerado_em timestamp,
    aprovacao_token_expira_em timestamp,
    confirmacao_token text,
    confirmacao_token_gerado_em timestamp,
    confirmacao_token_expira_em timestamp,
    status_atualizado_em timestamp,
    hora_ativacao timestamptz,
    ultima_alteracao timestamp,
    ultima_alteracao_em timestamp,
    ultima_atividade_em timestamp,
    ultima_acao_em timestamp,
    ultima_entrada timestamp,
    ultima_saida timestamp,
    permissoes jsonb default '{}'::jsonb
  );`);
  db.public.none(`CREATE TABLE usuarios_login_cache (
    usuario_id integer primary key,
    nome text,
    email text,
    perfil text,
    telefone text,
    telefone_celular text,
    whatsapp text,
    foto_usuario bytea,
    atualizado_em timestamp
  );`);
  db.public.none(
    "INSERT INTO usuarios (nome, email, perfil, verificado, telefone) VALUES ('Maria', 'maria@example.com', 'admin', false, '(11) 4000-0000');"
  );
  db.public.none(
    "INSERT INTO usuarios (nome, email, perfil, verificado, telefone, permissoes) VALUES ('Supervisor', 'sup@example.com', 'Sup Admin', true, '(11) 5000-0000', '{\"usuarios\":{\"permissoes\":{\"permitido\":true}}}');"
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

  const userActivityPath = require.resolve('./userActivity');
  const originalUserActivityModule = require.cache[userActivityPath];
  delete require.cache[userActivityPath];

  const emailChangeModulePath = require.resolve('../src/email/sendEmailChangeConfirmation');
  const originalEmailChangeModule = require.cache[emailChangeModulePath];
  const emailChangeRequests = [];
  require.cache[emailChangeModulePath] = {
    exports: {
      sendEmailChangeConfirmation: async payload => {
        emailChangeRequests.push(payload);
      }
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
    if (originalUserActivityModule) {
      require.cache[userActivityPath] = originalUserActivityModule;
    } else {
      delete require.cache[userActivityPath];
    }
    if (originalEmailChangeModule) {
      require.cache[emailChangeModulePath] = originalEmailChangeModule;
    } else {
      delete require.cache[emailChangeModulePath];
    }
    delete require.cache[usuariosControllerPath];
  }

  return { pool, listen, close, emailChangeRequests };
}

async function authenticatedFetch(port, path, options = {}) {
  const headers = new Headers(options.headers || {});
  const { usuarioId = 1, ...rest } = options;
  headers.set('authorization', `Bearer ${usuarioId}`);
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...rest,
    headers
  });
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
    assert.strictEqual(primeiroUsuario.statusInterno, 'ativo');
    assert.strictEqual(primeiroUsuario.statusBadge, 'badge-success');
    assert.strictEqual(primeiroUsuario.confirmado, true);
    assert.strictEqual(primeiroUsuario.hora_ativacao !== null, true);
    assert.ok(primeiroUsuario.confirmadoEm);

    const primeiroRegistro = await pool.query(
      'SELECT verificado, hora_ativacao, status FROM usuarios WHERE id = 1'
    );
    assert.strictEqual(primeiroRegistro.rows[0].verificado, true);
    assert.strictEqual(primeiroRegistro.rows[0].status, 'ativo');
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
    assert.strictEqual(segundoUsuario.statusInterno, 'aguardando_aprovacao');
    assert.strictEqual(segundoUsuario.statusBadge, 'badge-danger');
    assert.strictEqual(segundoUsuario.confirmado, false);
    assert.ok(segundoUsuario.hora_ativacao);
    assert.ok(segundoUsuario.confirmadoEm);

    const segundoRegistro = await pool.query(
      'SELECT verificado, hora_ativacao, status FROM usuarios WHERE id = 1'
    );
    assert.strictEqual(segundoRegistro.rows[0].verificado, false);
    assert.strictEqual(segundoRegistro.rows[0].status, 'aguardando_aprovacao');
    assert.ok(segundoRegistro.rows[0].hora_ativacao instanceof Date);
    assert.ok(segundoRegistro.rows[0].hora_ativacao.getTime() >= primeiraAtivacao.getTime());
  } finally {
    await close();
  }
});

test('GET /api/usuarios/me exige autenticação', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await fetch(`http://127.0.0.1:${port}/api/usuarios/me`);
    assert.strictEqual(resposta.status, 401);
  } finally {
    await close();
  }
});

test('GET /api/usuarios/me retorna dados do usuário autenticado', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/me');
    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.nome, 'Maria');
    assert.strictEqual(corpo.email, 'maria@example.com');
    assert.strictEqual(corpo.telefone, '(11) 4000-0000');
  } finally {
    await close();
  }
});

test('PUT /api/usuarios/me atualiza dados textuais e foto em base64', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  const tinyPng = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108020000009077053E0000000A49444154789C6360000002000100FFFF03000006000557BF0000000049454E44AE426082',
    'hex'
  );

  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/me', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Maria Atualizada',
        telefone: '(11) 98888-0000',
        whatsapp: '(11) 91111-2222',
        foto: `data:image/png;base64,${tinyPng.toString('base64')}`
      })
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.nome, 'Maria Atualizada');
    assert.strictEqual(corpo.telefone, '(11) 98888-0000');
    assert.ok(typeof corpo.fotoUsuario === 'string' && corpo.fotoUsuario.length > 10);

    const registro = await pool.query(
      'SELECT nome, telefone, whatsapp, foto_usuario FROM usuarios WHERE id = $1',
      [1]
    );
    assert.strictEqual(registro.rows[0].nome, 'Maria Atualizada');
    assert.strictEqual(registro.rows[0].telefone, '(11) 98888-0000');
    assert.strictEqual(registro.rows[0].whatsapp, '(11) 91111-2222');
    assert.ok(Buffer.isBuffer(registro.rows[0].foto_usuario));

    const cache = await pool.query(
      'SELECT nome, telefone, foto_usuario FROM usuarios_login_cache WHERE usuario_id = $1',
      [1]
    );
    assert.strictEqual(cache.rows.length, 1);
    assert.strictEqual(cache.rows[0].nome, 'Maria Atualizada');
    assert.strictEqual(cache.rows[0].telefone, '(11) 98888-0000');
    assert.ok(Buffer.isBuffer(cache.rows[0].foto_usuario));
  } finally {
    await close();
  }
});

test('PUT /api/usuarios/me aceita upload multipart de foto', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  const tinyPng = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108020000009077053E0000000A49444154789C6360000002000100FFFF03000006000557BF0000000049454E44AE426082',
    'hex'
  );

  try {
    const form = new FormData();
    form.append('nome', 'Maria Upload');
    form.append('foto', new Blob([tinyPng], { type: 'image/png' }), 'avatar.png');

    const resposta = await authenticatedFetch(port, '/api/usuarios/me', {
      method: 'PUT',
      body: form
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.nome, 'Maria Upload');
    assert.ok(typeof corpo.fotoUsuario === 'string');

    const registro = await pool.query('SELECT nome, foto_usuario FROM usuarios WHERE id = $1', [1]);
    assert.strictEqual(registro.rows[0].nome, 'Maria Upload');
    assert.ok(Buffer.isBuffer(registro.rows[0].foto_usuario));
  } finally {
    await close();
  }
});

test('PUT /api/usuarios/me rejeita alteração direta de e-mail', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/me', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'outra@example.com' })
    });
    assert.strictEqual(resposta.status, 400);
  } finally {
    await close();
  }
});

test('POST /api/usuarios/me/email-confirmation cria token e envia e-mail', async () => {
  const { listen, close, pool, emailChangeRequests } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/me/email-confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'novo@example.com' })
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.ok(typeof corpo.expiraEm === 'string');

    const registro = await pool.query(
      'SELECT email, token, expira_em FROM usuarios_confirmacoes_email WHERE usuario_id = $1',
      [1]
    );
    assert.strictEqual(registro.rows.length, 1);
    assert.strictEqual(registro.rows[0].email, 'novo@example.com');
    assert.ok(typeof registro.rows[0].token === 'string' && registro.rows[0].token.length > 10);
    assert.ok(registro.rows[0].expira_em instanceof Date);

    assert.strictEqual(emailChangeRequests.length, 1);
    assert.strictEqual(emailChangeRequests[0].to, 'novo@example.com');
    assert.strictEqual(emailChangeRequests[0].token, registro.rows[0].token);
  } finally {
    await close();
  }
});

test('GET /api/usuarios/confirm-email aplica novo e-mail confirmado', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    const iniciar = await authenticatedFetch(port, '/api/usuarios/me/email-confirmation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'confirmado@example.com' })
    });
    assert.strictEqual(iniciar.status, 200);

    const dados = await pool.query(
      'SELECT token FROM usuarios_confirmacoes_email WHERE usuario_id = $1',
      [1]
    );
    const token = dados.rows[0].token;
    assert.ok(token);

    const resposta = await fetch(`http://127.0.0.1:${port}/api/usuarios/confirm-email?token=${token}`);
    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.text();
    assert.ok(corpo.includes('E-mail atualizado'));

    const usuario = await pool.query('SELECT email, confirmacao, email_confirmado FROM usuarios WHERE id = $1', [1]);
    assert.strictEqual(usuario.rows[0].email, 'confirmado@example.com');
    assert.strictEqual(usuario.rows[0].confirmacao, true);
    assert.strictEqual(usuario.rows[0].email_confirmado, true);

    const registro = await pool.query(
      'SELECT token, confirmado_em FROM usuarios_confirmacoes_email WHERE usuario_id = $1',
      [1]
    );
    assert.strictEqual(registro.rows[0].token, null);
    assert.ok(registro.rows[0].confirmado_em instanceof Date);

    const cache = await pool.query('SELECT email FROM usuarios_login_cache WHERE usuario_id = $1', [1]);
    assert.strictEqual(cache.rows[0].email, 'confirmado@example.com');
  } finally {
    await close();
  }
});

test('GET /api/usuarios/:id permite Sup Admin visualizar dados completos', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/1', { usuarioId: 2 });
    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.id, 1);
    assert.ok(Array.isArray(corpo.permissoesResumo));
    assert.ok(Object.prototype.hasOwnProperty.call(corpo, 'permissoes'));
    assert.deepStrictEqual(corpo.permissoes, {});
  } finally {
    await close();
  }
});

test('GET /api/usuarios/:id impede acesso a dados de terceiros sem privilégio', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/2');
    assert.strictEqual(resposta.status, 403);
  } finally {
    await close();
  }
});

test('PATCH /api/usuarios/:id permite atualização de dados pessoais autorizados', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/1', {
      method: 'PATCH',
      usuarioId: 2,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Maria Ajustada',
        telefone: '(11) 4123-4567',
        whatsapp: '(11) 4555-7788',
        descricao: 'Perfil atualizado pelo Sup Admin'
      })
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.nome, 'Maria Ajustada');
    assert.strictEqual(corpo.telefone, '(11) 4123-4567');
    assert.strictEqual(corpo.whatsapp, '(11) 4555-7788');
    assert.strictEqual(corpo.descricao, 'Perfil atualizado pelo Sup Admin');

    const registro = await pool.query(
      'SELECT nome, telefone, whatsapp, descricao FROM usuarios WHERE id = $1',
      [1]
    );
    assert.strictEqual(registro.rows[0].nome, 'Maria Ajustada');
    assert.strictEqual(registro.rows[0].telefone, '(11) 4123-4567');
    assert.strictEqual(registro.rows[0].whatsapp, '(11) 4555-7788');
    assert.strictEqual(registro.rows[0].descricao, 'Perfil atualizado pelo Sup Admin');
  } finally {
    await close();
  }
});

test('PUT /api/usuarios/:id/permissoes atualiza permissões granuladas', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    const payload = {
      permissoes: {
        usuarios: {
          permissoes: true,
          editar: false
        },
        pedidos: {
          visualizar: { permitido: true },
          editar: {
            permitido: true,
            campos: {
              valor_total: { visualizar: true, editar: false }
            }
          }
        }
      }
    };

    const resposta = await authenticatedFetch(port, '/api/usuarios/1/permissoes', {
      method: 'PUT',
      usuarioId: 2,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.permissoes.usuarios.permissoes.permitido, true);
    assert.strictEqual(corpo.permissoes.pedidos.editar.permitido, true);
    assert.strictEqual(
      corpo.permissoes.pedidos.editar.campos.valor_total.visualizar,
      true
    );
    assert.strictEqual(
      corpo.permissoes.pedidos.editar.campos.valor_total.editar,
      false
    );
    assert.ok(Array.isArray(corpo.permissoesResumo));

    const registro = await pool.query('SELECT permissoes FROM usuarios WHERE id = $1', [1]);
    assert.deepStrictEqual(registro.rows[0].permissoes, corpo.permissoes);
  } finally {
    await close();
  }
});

test('PUT /api/usuarios/:id/permissoes bloqueia usuários sem privilégio de Sup Admin', async () => {
  const { listen, close } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/2/permissoes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ permissoes: { usuarios: { permissoes: true } } })
    });
    assert.strictEqual(resposta.status, 403);
  } finally {
    await close();
  }
});
