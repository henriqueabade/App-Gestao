const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeAvatar } = require('../../../backend/usuariosController');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'usuarios.js'), 'utf8');
const foto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=';

async function carregar({ getApiBaseUrl = async () => 'http://127.0.0.1:3000' } = {}) {
  const contexto = vm.createContext({
    window: { apiConfig: { getApiBaseUrl }, addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {} },
    console, Headers,
    fetch: async () => ({ ok: true })
  });
  vm.runInContext(fonte, contexto);
  await new Promise(setImmediate);
  return contexto;
}

test('a lista prioriza foto normalizada sobre caminho antigo e não acrescenta versão ao dataURL', async () => {
  const pagina = await carregar();
  const usuario = normalizeAvatar({ foto_usuario: foto, foto_perfil: '/imagens/antiga.png', avatar_version: 123 });
  assert.equal(pagina.obterAvatarUrl(usuario), foto);
});

test('URLs relativas usam a base do backend e a versão do avatar para evitar foto em cache', async () => {
  const pagina = await carregar();
  assert.equal(pagina.obterAvatarUrl({ foto_perfil: '/imagens/7.webp', avatar_version: 123 }), 'http://127.0.0.1:3000/imagens/7.webp?v=123');
  assert.equal(pagina.obterAvatarUrl({ foto_perfil_url: 'https://exemplo.test/foto.jpg' }), 'https://exemplo.test/foto.jpg');
  assert.equal(pagina.obterAvatarUrl({ foto_usuario: 'javascript:alert(1)' }), null);
});

test('consulta da lista fixa a base das fotos mesmo se a inicialização assíncrona ainda não respondeu', async () => {
  let consultas = 0;
  const pagina = await carregar({ getApiBaseUrl: () => (++consultas === 1 ? new Promise(() => {}) : Promise.resolve('http://127.0.0.1:4100')) });
  vm.runInContext('usuarioLogado = { id: 7 };', pagina);
  await pagina.fetchApi('/api/usuarios/lista');
  assert.equal(pagina.obterAvatarUrl({ foto_perfil: 'imagens/7.webp' }), 'http://127.0.0.1:4100/imagens/7.webp');
});

test('JPEG base64 normalizado no backend chega ao renderer como imagem, nunca como GET /9j/', async () => {
  const pagina = await carregar();
  const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]).toString('base64');
  const url = pagina.obterAvatarUrl(normalizeAvatar({ foto_usuario: base64 }));
  assert.equal(url, `data:image/jpeg;base64,${base64}`);
});
