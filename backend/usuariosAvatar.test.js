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
