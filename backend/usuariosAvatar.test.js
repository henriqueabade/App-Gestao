const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// PNG 1×1 completo: o contrato entrega os bytes da imagem, não o texto de um
// dataURL/base64 reencodado como se já fosse um arquivo JPEG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
const PNG_URL = `data:image/png;base64,${PNG.toString('base64')}`;

const {
  avatarToRenderableSource,
  normalizeAvatar
} = require('./usuariosController');

test('converte BYTEA PNG serializado em uma fonte renderizável', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal(
    avatarToRenderableSource({ type: 'Buffer', data: [...png] }),
    `data:image/png;base64,${png.toString('base64')}`
  );
});

test('reconhece WebP em base64 e replica o avatar normalizado', () => {
  const webp = Buffer.from('RIFF1234WEBP', 'ascii');
  const normalized = normalizeAvatar({ foto_usuario: webp.toString('base64') });

  assert.match(normalized.avatarUrl, /^data:image\/webp;base64,/);
  assert.equal(normalized.foto_usuario, normalized.avatarUrl);
  assert.equal(normalized.avatar, normalized.avatarUrl);
});

test('preserva URL de foto já pronta para exibição', () => {
  const url = '/api/perfil/imagem/42';
  assert.equal(avatarToRenderableSource(url), url);
});

test('converte BYTEA no formato hexadecimal retornado pelo PostgreSQL', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal(
    avatarToRenderableSource(`\\x${png.toString('hex')}`),
    `data:image/png;base64,${png.toString('base64')}`
  );
});

test('aceita foto serializada como objeto com array de bytes', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  assert.equal(
    avatarToRenderableSource({ data: [...jpeg] }),
    `data:image/jpeg;base64,${jpeg.toString('base64')}`
  );
});

test('normaliza foto_perfil_url usada por versões anteriores da API', () => {
  const normalized = normalizeAvatar({ foto_perfil_url: '/users/7/avatar' });
  assert.equal(normalized.avatarUrl, '/users/7/avatar');
  assert.equal(normalized.foto_usuario, '/users/7/avatar');
});

test('JPEG em base64 começado por /9j/ vira imagem em vez de caminho HTTP', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
  const base64 = jpeg.toString('base64');
  assert.ok(base64.startsWith('/9j/'));
  assert.equal(avatarToRenderableSource(base64), `data:image/jpeg;base64,${base64}`);
  assert.equal(avatarToRenderableSource('/api/usuarios/7/avatar'), '/api/usuarios/7/avatar');
});

test('foto PNG real tem a mesma fonte em BYTEA binário, hexadecimal, base64 e dataURL', () => {
  for (const entrada of [PNG, { type: 'Buffer', data: [...PNG] }, `\\x${PNG.toString('hex')}`, PNG.toString('base64'), PNG_URL]) {
    assert.equal(avatarToRenderableSource(entrada), PNG_URL);
  }
});

test('BYTEA antigo contendo texto dataURL/base64 é decodificado sem corromper a imagem', () => {
  assert.equal(avatarToRenderableSource(Buffer.from(PNG_URL)), PNG_URL);
  assert.equal(avatarToRenderableSource({ type: 'Buffer', data: [...Buffer.from(PNG.toString('base64'))] }), PNG_URL);
});

test('foto vazia ou inválida não esconde um alias válido; protocolos fora de imagem são recusados', () => {
  assert.equal(normalizeAvatar({ foto_usuario: '', foto_perfil_url: PNG_URL }).foto_usuario, PNG_URL);
  assert.equal(normalizeAvatar({ foto_usuario: { data: [] }, avatar_url: 'https://exemplo.test/foto.png' }).avatarUrl, 'https://exemplo.test/foto.png');
  assert.equal(avatarToRenderableSource('javascript:alert(1)'), null);
  assert.equal(avatarToRenderableSource('data:text/html,<script>'), null);
  assert.equal(avatarToRenderableSource('imagens/perfis/7.webp'), 'imagens/perfis/7.webp');
});

test('a foto atualizada pelo perfil prevalece sobre foto_usuario legado', () => {
  const atual = '/imagens/perfis/7-nova.webp';
  assert.equal(normalizeAvatar({ foto_usuario: PNG_URL, foto_perfil: atual }).foto_usuario, atual);
  assert.equal(normalizeAvatar({ foto_usuario: PNG_URL, foto_perfil_url: 'https://exemplo.test/nova.webp' }).avatarUrl, 'https://exemplo.test/nova.webp');
});

async function comLista({ podeVer }, verificar) {
  const usuario = { id: 7, nome: 'Maria Teste', email: 'maria@example.test', perfil: 'Comercial', status: 'ativo', foto_perfil: PNG_URL, ultimo_login: '2026-10-15T12:00:00Z' };
  const selects = [];
  const api = {
    getAvailableColumns: async () => Object.keys(usuario),
    get: async (caminho, { query } = {}) => {
      if (caminho === '/api/usuarios') {
        selects.push(query.select);
        const campos = new Set(query.select.split(','));
        return [usuario, { ...usuario, id: 8, email: 'outra@example.test' }].map(u => ({
          ...Object.fromEntries(Object.entries(u).filter(([campo]) => campos.has(campo))),
          senha: 'hash-nao-deve-sair', confirmacao_token: 'token-nao-deve-sair'
        }));
      }
      if (caminho === '/api/usuarios/7') return { ...usuario, senha: 'hash-nao-deve-sair' };
      if (caminho === '/api/tabelas') return { tabelas: [] };
      throw new Error(`GET inesperado ${caminho}`);
    }
  };
  const substituidos = ['./apiHttpClient', './permissionsController', './usuariosController'].map(caminho => {
    const id = require.resolve(caminho);
    return { id, antes: require.cache[id] };
  });
  const [http, permissoes, controller] = substituidos;
  require.cache[http.id] = { id: http.id, filename: http.id, loaded: true, exports: { createApiClient: () => api } };
  require.cache[permissoes.id] = {
    id: permissoes.id, filename: permissoes.id, loaded: true,
    exports: { obterPermissoesEfetivas: async () => ({ usuarios: { ativo: podeVer, acoes: { 'usuarios.view': podeVer } } }) }
  };
  delete require.cache[controller.id];
  const app = express();
  app.use('/api/usuarios', require('./usuariosController'));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  const jwt = `x.${Buffer.from(JSON.stringify({ id: 7 })).toString('base64url')}.y`;
  const pedir = async caminho => {
    const resposta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/usuarios${caminho}`, { headers: { authorization: `Bearer ${jwt}` } });
    assert.equal(resposta.status, 200);
    return resposta.json();
  };
  try { await verificar({ pedir, selects }); }
  finally {
    await new Promise(r => servidor.close(r));
    for (const { id, antes } of substituidos) { if (antes) require.cache[id] = antes; else delete require.cache[id]; }
  }
}

test('lista projeta alias de foto existente e entrega o mesmo avatar de /me sem senha nem tokens', async () => {
  await comLista({ podeVer: true }, async ({ pedir, selects }) => {
    const lista = await pedir('/lista');
    const eu = await pedir('/me');
    assert.equal(eu.foto_usuario, PNG_URL);
    assert.ok(lista.every(u => u.foto_usuario === eu.foto_usuario && u.avatarUrl === PNG_URL));
    assert.ok(selects[0].split(',').includes('foto_perfil'));
    assert.ok(!selects[0].includes('*'));
    assert.ok(lista.every(u => !('senha' in u) && !('confirmacao_token' in u)));
  });
});

test('sem módulo Usuários o seletor conserva foto e esconde e-mail/atividade dos colegas', async () => {
  await comLista({ podeVer: false }, async ({ pedir }) => {
    const lista = await pedir('/lista');
    assert.ok(lista.every(u => u.foto_usuario === PNG_URL && !('ultimo_login' in u) && !('senha' in u)));
    assert.equal(lista.find(u => u.id === 7).email, 'maria@example.test');
    assert.ok(!('email' in lista.find(u => u.id === 8)));
  });
});

test('PROD: cliente HTTP real projeta foto_perfil do esquema remoto e entrega a imagem da topbar', async () => {
  const chamadas = [];
  const usuario = {
    id: 7, nome: 'Maria Teste', email: 'maria@example.test', perfil: 'Sup Admin', status: 'ativo',
    permissoes: {}, foto_usuario: null, avatar_version: null,
    foto_perfil: '/imagens/perfis/7.png', ultimo_login: '2026-10-15T12:00:00Z',
    senha: 'hash-nao-deve-sair', confirmacao_token: 'token-nao-deve-sair'
  };
  const remoto = express();
  remoto.use((req, res, next) => {
    if (req.path.startsWith('/api/')) assert.equal(req.headers.authorization, 'Bearer avatar-fixture');
    chamadas.push({ caminho: req.path, select: req.query.select });
    next();
  });
  remoto.get('/api/tabelas', (_req, res) => res.json({ tabelas: [{ tabela: 'usuarios', colunas: Object.keys(usuario) }] }));
  remoto.get('/api/usuarios', (req, res) => {
    const campos = String(req.query.select || '').split(',').filter(Boolean);
    const desconhecido = campos.find(c => !(c in usuario));
    if (desconhecido) return res.status(400).json({ error: `Coluna inexistente: ${desconhecido}` });
    res.json([Object.fromEntries(campos.map(c => [c, usuario[c]]))]);
  });
  remoto.get('/api/usuarios/7', (_req, res) => res.json(usuario));
  remoto.get('/api/perfil', (req, res) => res.json({ usuario: {
    ...usuario, foto_perfil_url: `http://${req.headers.host}${usuario.foto_perfil}`
  } }));
  remoto.get('/imagens/perfis/7.png', (_req, res) => res.type('png').send(PNG));
  const apiServer = remoto.listen(0, '127.0.0.1');
  await new Promise(resolve => apiServer.once('listening', resolve));
  const base = `http://127.0.0.1:${apiServer.address().port}`;
  const nomes = ['./apiHttpClient', './tokenStore', './dataConfig', './permissionsController', './usuariosController'];
  const modulos = nomes.map(nome => ({ id: require.resolve(nome), antes: require.cache[require.resolve(nome)] }));
  const envAnterior = process.env.API_BASE_URL;
  let servidor;
  try {
    process.env.API_BASE_URL = base;
    for (const { id } of modulos) delete require.cache[id];
    const [http, token, config, permissoes] = modulos;
    require.cache[token.id] = { id: token.id, filename: token.id, loaded: true, exports: { getToken: () => 'avatar-fixture' } };
    require.cache[config.id] = { id: config.id, filename: config.id, loaded: true, exports: { isDev: false } };
    require.cache[permissoes.id] = { id: permissoes.id, filename: permissoes.id, loaded: true, exports: {
      obterPermissoesEfetivas: async () => ({ usuarios: { ativo: true, acoes: { 'usuarios.view': true } } })
    } };
    const cliente = require('./apiHttpClient').createApiClient();
    assert.equal(typeof cliente.getAvailableColumns, 'undefined', 'o teste percorre o cliente PROD, não o DEV');
    const app = express();
    app.use('/api/usuarios', require('./usuariosController'));
    servidor = app.listen(0, '127.0.0.1');
    await new Promise(resolve => servidor.once('listening', resolve));
    const resposta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/usuarios/lista`);
    assert.equal(resposta.status, 200);
    const lista = await resposta.json();
    const perfil = (await cliente.get('/api/perfil')).usuario;
    const urlDaLista = new URL(lista[0].foto_usuario, base).href;
    assert.equal(urlDaLista, perfil.foto_perfil_url);
    assert.ok(chamadas.find(c => c.caminho === '/api/usuarios').select.split(',').includes('foto_perfil'));
    assert.ok(!('senha' in lista[0]) && !('confirmacao_token' in lista[0]));
    const imagem = await fetch(urlDaLista);
    assert.equal(imagem.status, 200);
    assert.equal(imagem.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imagem.arrayBuffer()), PNG);
  } finally {
    if (servidor) await new Promise(resolve => servidor.close(resolve));
    await new Promise(resolve => apiServer.close(resolve));
    if (envAnterior === undefined) delete process.env.API_BASE_URL; else process.env.API_BASE_URL = envAnterior;
    for (const { id, antes } of modulos) { if (antes) require.cache[id] = antes; else delete require.cache[id]; }
  }
});
