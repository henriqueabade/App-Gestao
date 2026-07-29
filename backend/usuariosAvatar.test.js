const test = require('node:test');
const assert = require('node:assert/strict');

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
