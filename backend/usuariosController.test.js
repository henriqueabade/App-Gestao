const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { newDb } = require('pg-mem');

function setup() {
  const db = newDb();
  db.public.registerFunction({
    name: 'trim',
    args: ['text'],
    returns: 'text',
    implementation: value => (value == null ? null : String(value).trim())
  });
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
    ,modelo_permissoes_id integer
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
  db.public.none(`CREATE TABLE modelos_permissoes (
    id serial primary key,
    nome text unique not null,
    permissoes jsonb not null default '{}'::jsonb,
    criado_em timestamp default NOW(),
    atualizado_em timestamp default NOW()
  );`);
  db.public.none(`CREATE TABLE roles_modules_matrix (
    id serial primary key,
    modelo_id integer not null,
    modulo text not null,
    acao text not null,
    permitido boolean default false,
    escopos jsonb default '{}'::jsonb
  );`);
  db.public.none(`CREATE TABLE perm_usuarios (
    id serial primary key,
    modelo_id integer not null,
    campo text not null,
    acao text not null,
    permitido boolean default false
  );`);
  db.public.none(`CREATE TABLE clientes (
    id serial primary key,
    nome text,
    dono_cliente text,
    email text
  );`);
  db.public.none(`CREATE TABLE contatos_cliente (
    id serial primary key,
    nome text,
    responsavel text,
    responsavel_email text,
    email text
  );`);
  db.public.none(`CREATE TABLE prospeccoes (
    id serial primary key,
    responsavel text,
    email text
  );`);
  db.public.none(`CREATE TABLE orcamentos (
    id serial primary key,
    dono text,
    email_responsavel text
  );`);
  db.public.none(`CREATE TABLE pedidos (
    id serial primary key,
    dono text,
    email text
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
      query: (text, params) => pool.query(text, params),
      connect: () => pool.connect()
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
  const modelosPermissoesRepoPath = require.resolve('./modelosPermissoesRepository');
  const originalModelosPermissoesRepo = require.cache[modelosPermissoesRepoPath];
  delete require.cache[modelosPermissoesRepoPath];
  const permissionsCatalogRepoPath = require.resolve('./permissionsCatalogRepository');
  const originalPermissionsCatalogRepo = require.cache[permissionsCatalogRepoPath];
  delete require.cache[permissionsCatalogRepoPath];
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
    if (originalModelosPermissoesRepo) {
      require.cache[modelosPermissoesRepoPath] = originalModelosPermissoesRepo;
    } else {
      delete require.cache[modelosPermissoesRepoPath];
    }
    if (originalPermissionsCatalogRepo) {
      require.cache[permissionsCatalogRepoPath] = originalPermissionsCatalogRepo;
    } else {
      delete require.cache[permissionsCatalogRepoPath];
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

test('modelos de permissões requerem Sup Admin', async () => {
  const { listen, close } = setup();
  const port = await listen();

  try {
    const lista = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes');
    assert.strictEqual(lista.status, 403);

    const criacao = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nome: 'Operações', permissoes: {} })
    });
    assert.strictEqual(criacao.status, 403);
  } finally {
    await close();
  }
});

test('GET /api/usuarios/permissoes/estrutura exige Sup Admin e retorna estrutura completa', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();

  try {
    const negado = await authenticatedFetch(port, '/api/usuarios/permissoes/estrutura');
    assert.strictEqual(negado.status, 403);

    await pool.query(
      "INSERT INTO roles_modules_matrix (modelo_id, modulo, acao, permitido) VALUES (1, 'usuarios', 'listar', true)"
    );
    await pool.query(
      "INSERT INTO roles_modules_matrix (modelo_id, modulo, acao, permitido) VALUES (1, 'usuarios', 'editar', true)"
    );
    await pool.query(
      "INSERT INTO roles_modules_matrix (modelo_id, modulo, acao, permitido) VALUES (1, 'clientes', 'visualizar', true)"
    );
    await pool.query(
      "INSERT INTO perm_usuarios (modelo_id, campo, acao, permitido) VALUES (1, 'email', 'editar', true)"
    );

    const permitido = await authenticatedFetch(port, '/api/usuarios/permissoes/estrutura', { usuarioId: 2 });
    assert.strictEqual(permitido.status, 200);
    const corpo = await permitido.json();
    assert.ok(Array.isArray(corpo.estrutura));

    const moduloUsuarios = corpo.estrutura.find(item => item.chave === 'usuarios' || item.modulo === 'usuarios');
    assert.ok(moduloUsuarios, 'Estrutura deveria incluir módulo de usuários.');
    assert.ok(Array.isArray(moduloUsuarios.campos));

    const acaoEditar = moduloUsuarios.campos.find(campo => campo.chave === 'editar');
    assert.ok(acaoEditar, 'Deveria existir ação editar para usuários.');
    assert.strictEqual(acaoEditar.acao, 'editar');
    assert.strictEqual(acaoEditar.titulo, 'Editar');
    assert.ok(Array.isArray(acaoEditar.colunas));
    const colunaEmail = acaoEditar.colunas.find(coluna => coluna.campo === 'email');
    assert.ok(colunaEmail, 'Deveria existir coluna email na ação editar.');
    assert.strictEqual(colunaEmail.titulo, 'Email');

    const moduloClientes = corpo.estrutura.find(item => item.chave === 'clientes' || item.modulo === 'clientes');
    assert.ok(moduloClientes, 'Estrutura deveria incluir módulo de clientes.');
    const acaoVisualizar = moduloClientes.campos.find(campo => campo.chave === 'visualizar');
    assert.ok(acaoVisualizar, 'Deveria existir ação visualizar para clientes.');
  } finally {
    await close();
  }
});

test('GET /api/usuarios/lista inclui avatarUrl apontando para rota pública', async () => {
  const { pool, listen, close } = setup();
  const port = await listen();

  try {
    const fotoBuffer = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6360000002000181020DF66A0000000049454E44AE426082',
      'hex'
    );
    await pool.query('UPDATE usuarios SET foto_usuario = $1 WHERE email = $2', [
      fotoBuffer,
      'maria@example.com'
    ]);

    const response = await authenticatedFetch(port, '/api/usuarios/lista');
    assert.strictEqual(response.status, 200);

    const usuarios = await response.json();
    const maria = usuarios.find(usuario => usuario.email === 'maria@example.com');
    assert.ok(maria, 'Usuária Maria deveria estar presente na lista.');
    assert.ok(
      typeof maria.avatarUrl === 'string' && /\/users\/\d+\/avatar/.test(maria.avatarUrl),
      'avatarUrl deveria apontar para a rota pública de avatar'
    );
    assert.strictEqual(maria.avatar_url, maria.avatarUrl);
    assert.strictEqual(maria.foto, maria.avatarUrl);
    assert.strictEqual(maria.fotoUrl, maria.avatarUrl);
    assert.ok(
      typeof maria.avatarVersion === 'string' && maria.avatarVersion.length > 0,
      'avatarVersion deveria conter um token de cache da imagem'
    );
    assert.strictEqual(maria.avatarVersion, maria.avatar_version);
    assert.ok(!('fotoUsuario' in maria), 'fotoUsuario não deve ser retornado no payload');
  } finally {
    await close();
  }
});

test('Sup Admin gerencia modelos de permissões e aplica em usuário', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();

  try {
    const listaInicial = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes', { usuarioId: 2 });
    assert.strictEqual(listaInicial.status, 200);
    const corpoListaInicial = await listaInicial.json();
    assert.deepStrictEqual(corpoListaInicial.modelos, []);

    const permissoesModelo = {
      usuarios: {
        permissoes: { permitido: true },
        editar: { permitido: true, campos: { email: { editar: true } } }
      }
    };
    const criar = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      usuarioId: 2,
      body: JSON.stringify({ nome: 'Financeiro', permissoes: permissoesModelo })
    });
    assert.strictEqual(criar.status, 201);
    const modelo = await criar.json();
    assert.ok(modelo.id);
    assert.strictEqual(modelo.nome, 'Financeiro');
    assert.deepStrictEqual(modelo.permissoes, permissoesModelo);

    const matrizCriada = await pool.query(
      'SELECT modulo, acao, permitido FROM roles_modules_matrix WHERE modelo_id = $1 ORDER BY acao',
      [modelo.id]
    );
    assert.deepStrictEqual(matrizCriada.rows, [
      { modulo: 'usuarios', acao: 'editar', permitido: true },
      { modulo: 'usuarios', acao: 'permissoes', permitido: true }
    ]);

    const camposCriados = await pool.query(
      'SELECT campo, acao, permitido FROM perm_usuarios WHERE modelo_id = $1',
      [modelo.id]
    );
    assert.deepStrictEqual(camposCriados.rows, [{ campo: 'email', acao: 'editar', permitido: true }]);

    const duplicado = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      usuarioId: 2,
      body: JSON.stringify({ nome: 'Financeiro', permissoes: {} })
    });
    assert.strictEqual(duplicado.status, 409);

    const atualizar = await authenticatedFetch(port, `/api/usuarios/modelos-permissoes/${modelo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      usuarioId: 2,
      body: JSON.stringify({
        nome: 'Financeiro Corporativo',
        permissoes: { usuarios: { permissoes: { permitido: false }, editar: { permitido: false, campos: { email: { editar: false } } } } }
      })
    });
    assert.strictEqual(atualizar.status, 200);
    const atualizado = await atualizar.json();
    assert.strictEqual(atualizado.nome, 'Financeiro Corporativo');
    assert.strictEqual(atualizado.permissoes.usuarios.permissoes.permitido, false);
    assert.strictEqual(atualizado.permissoes.usuarios.editar.campos.email.editar, false);

    const matrizAtualizada = await pool.query(
      'SELECT modulo, acao, permitido FROM roles_modules_matrix WHERE modelo_id = $1 ORDER BY acao',
      [atualizado.id]
    );
    assert.deepStrictEqual(matrizAtualizada.rows, [
      { modulo: 'usuarios', acao: 'editar', permitido: false },
      { modulo: 'usuarios', acao: 'permissoes', permitido: false }
    ]);

    const camposAtualizados = await pool.query(
      'SELECT campo, acao, permitido FROM perm_usuarios WHERE modelo_id = $1 ORDER BY campo',
      [atualizado.id]
    );
    assert.deepStrictEqual(camposAtualizados.rows, [{ campo: 'email', acao: 'editar', permitido: false }]);

    const aplicar = await authenticatedFetch(port, '/api/usuarios/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      usuarioId: 2,
      body: JSON.stringify({ modeloPermissoesId: atualizado.id, aplicarPermissoesDoModelo: true })
    });
    assert.strictEqual(aplicar.status, 200);
    const usuarioAtualizado = await aplicar.json();
    assert.strictEqual(usuarioAtualizado.modeloPermissoesId, atualizado.id);
    assert.strictEqual(usuarioAtualizado.permissoes.usuarios.permissoes.permitido, false);

    const registro = await pool.query(
      'SELECT modelo_permissoes_id, permissoes FROM usuarios WHERE id = $1',
      [1]
    );
    assert.strictEqual(registro.rows[0].modelo_permissoes_id, atualizado.id);
    assert.strictEqual(registro.rows[0].permissoes.usuarios.permissoes.permitido, false);

    const remover = await authenticatedFetch(port, `/api/usuarios/modelos-permissoes/${atualizado.id}`, {
      method: 'DELETE',
      usuarioId: 2
    });
    assert.strictEqual(remover.status, 204);

    const matrizRemovida = await pool.query(
      'SELECT count(*)::int AS total FROM roles_modules_matrix WHERE modelo_id = $1',
      [atualizado.id]
    );
    assert.strictEqual(matrizRemovida.rows[0].total, 0);

    const camposRemovidos = await pool.query(
      'SELECT count(*)::int AS total FROM perm_usuarios WHERE modelo_id = $1',
      [atualizado.id]
    );
    assert.strictEqual(camposRemovidos.rows[0].total, 0);

    const listaFinal = await authenticatedFetch(port, '/api/usuarios/modelos-permissoes', { usuarioId: 2 });
    assert.strictEqual(listaFinal.status, 200);
    const { modelos: modelosFinais } = await listaFinal.json();
    assert.deepStrictEqual(modelosFinais, []);
  } finally {
    await close();
  }
});

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

test('PUT /api/usuarios/me atualiza dados textuais e foto via JSON', async () => {
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
    assert.ok(
      typeof corpo.avatarUrl === 'string' && corpo.avatarUrl.includes(`/users/${corpo.id}/avatar`),
      'avatarUrl deveria apontar para a rota pública de avatar'
    );
    assert.strictEqual(corpo.avatar_url, corpo.avatarUrl);
    assert.strictEqual(corpo.foto, corpo.avatarUrl);
    assert.strictEqual(corpo.fotoUrl, corpo.avatarUrl);
    assert.ok(typeof corpo.avatarVersion === 'string' && corpo.avatarVersion.length > 0);
    assert.strictEqual(corpo.avatarVersion, corpo.avatar_version);
    assert.ok(!('fotoUsuario' in corpo), 'fotoUsuario não deve ser retornado na resposta');

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

test('PUT /api/usuarios/me aceita upload multipart de foto e expõe avatar_url', async () => {
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
    assert.ok(
      typeof corpo.avatarUrl === 'string' && corpo.avatarUrl.includes(`/users/${corpo.id}/avatar`),
      'avatarUrl deveria apontar para a rota pública de avatar'
    );
    assert.strictEqual(corpo.avatar_url, corpo.avatarUrl);
    assert.ok(typeof corpo.avatarVersion === 'string' && corpo.avatarVersion.length > 0);
    assert.ok(!('fotoUsuario' in corpo), 'fotoUsuario não deve ser retornado na resposta');

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

test('DELETE /api/usuarios/:id remove usuário sem vínculos', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    const resposta = await authenticatedFetch(port, '/api/usuarios/1', {
      method: 'DELETE',
      usuarioId: 2
    });
    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.message, 'Exclusão concluída com sucesso.');
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios WHERE id = $1', [1]);
    assert.strictEqual(rows[0].total, 0);
  } finally {
    await close();
  }
});

test('DELETE /api/usuarios/:id retorna 409 quando existem associações', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    await pool.query("INSERT INTO clientes (nome, dono_cliente, email) VALUES ('Alpha', 'Maria', 'alpha@empresa.com')");
    await pool.query("INSERT INTO prospeccoes (responsavel, email) VALUES ('', 'maria@example.com')");

    const resposta = await authenticatedFetch(port, '/api/usuarios/1', {
      method: 'DELETE',
      usuarioId: 2
    });

    assert.strictEqual(resposta.status, 409);
    const corpo = await resposta.json();
    assert.ok(Array.isArray(corpo.associacoes));
    const labels = corpo.associacoes.map(item => item.label).sort();
    assert.ok(labels.includes('Clientes'));
    assert.ok(labels.includes('Prospecções'));
  } finally {
    await close();
  }
});

test('POST /api/usuarios/:id/transferencia transfere dados e exclui usuário', async () => {
  const { listen, close, pool } = setup();
  const port = await listen();
  try {
    await pool.query(
      "INSERT INTO clientes (nome, dono_cliente, email) VALUES ('Beta', 'Maria', 'maria@example.com')"
    );
    await pool.query(
      "INSERT INTO orcamentos (dono, email_responsavel) VALUES ('Maria', 'maria@example.com')"
    );

    const resposta = await authenticatedFetch(port, '/api/usuarios/1/transferencia', {
      method: 'POST',
      usuarioId: 2,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destinoId: 2 })
    });

    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.message, 'Exclusão e transferência concluídas com sucesso.');

    const clientes = await pool.query('SELECT dono_cliente, email FROM clientes');
    assert.deepStrictEqual(clientes.rows, [{ dono_cliente: 'Supervisor', email: 'sup@example.com' }]);

    const orcamentos = await pool.query('SELECT dono, email_responsavel FROM orcamentos');
    assert.deepStrictEqual(orcamentos.rows, [{ dono: 'Supervisor', email_responsavel: 'sup@example.com' }]);

    const usuariosRestantes = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios WHERE id = $1', [1]);
    assert.strictEqual(usuariosRestantes.rows[0].total, 0);
  } finally {
    await close();
  }
});
