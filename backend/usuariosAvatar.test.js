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
