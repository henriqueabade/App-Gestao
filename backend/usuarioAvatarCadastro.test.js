const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function obterHandler() {
  const inicio = fonte.indexOf("ipcMain.handle('usuarios:enviar-imagem'");
  const fim = fonte.indexOf("ipcMain.handle('registrar-usuario'", inicio);
  assert.notStrictEqual(inicio, -1, 'handler de envio da foto não encontrado');
  assert.notStrictEqual(fim, -1, 'fim do handler de envio da foto não encontrado');
  return fonte.slice(inicio, fim);
}

test('foto do cadastro usa a rota de avatar do usuário criado', () => {
  const handler = obterHandler();

  assert.match(handler, /`\/api\/usuarios\/\$\{idSeguro\}\/avatar`/);
  assert.match(handler, /method:\s*'PUT'/);
  assert.match(handler, /foto_usuario:\s*avatar/);
  assert.doesNotMatch(
    handler,
    /const path\s*=\s*`\/api\/perfil\/imagem/,
    'a rota de perfil atribui a foto ao usuário autenticado, não ao recém-criado'
  );
});

test('id do usuário criado é validado antes do upload', () => {
  const handler = obterHandler();

  assert.match(handler, /Number\.isInteger\(usuarioId\)/);
  assert.match(handler, /encodeURIComponent\(String\(usuarioId\)\)/);
});

test('upload autenticado só confirma auditoria após sucesso e mantém o alvo do cadastro', async () => {
  const vm = require('node:vm');
  const confirmacoes = [];
  let responderOk = true;
  let handler;
  vm.runInNewContext(obterHandler(), {
    ipcMain: { handle(_canal, fn) { handler = fn; } },
    verificarPermissaoIpc: async () => true,
    PROFILE_IMAGE_TYPES: new Set(['image/png']), PROFILE_IMAGE_MAX_BYTES: 5000,
    getToken: () => 'token-teste', useLocalDatabase: false,
    Buffer, Uint8Array, Date,
    unwrapProfileUser: valor => valor,
    capturaAuditoria: { confirmarMudancaProtegida: (...args) => confirmacoes.push(args) },
    fetch: async () => ({ ok: responderOk, status: responderOk ? 200 : 403, json: async () => responderOk ? { id: 42 } : { erro: 'Negado' } })
  });
  assert.equal((await handler(null, { usuarioId: 42, type: 'image/png', bytes: new Uint8Array([1, 2]) })).id, 42);
  assert.deepEqual(confirmacoes, [['alterar-avatar', 42]]);
  responderOk = false;
  await assert.rejects(handler(null, { usuarioId: 42, type: 'image/png', bytes: new Uint8Array([1, 2]) }), /Negado/);
  assert.equal(confirmacoes.length, 1);
});

test('foto do próprio perfil confirma somente POST/DELETE autenticado bem-sucedido', async () => {
  const vm = require('node:vm');
  const inicio = fonte.indexOf('async function requestAuthenticatedProfile(');
  const fim = fonte.indexOf('\nfunction mapApiErrorToReason', inicio);
  const confirmacoes = [];
  let ok = true;
  const contexto = vm.createContext({
    getToken: () => 'token-teste', useLocalDatabase: false,
    currentUserSession: { id: 7 }, setCurrentUserSession() {},
    unwrapProfileUser: payload => payload,
    capturaAuditoria: { confirmarMudancaProtegida: (...args) => confirmacoes.push(args) },
    fetch: async () => ({ ok, status: ok ? 200 : 403, json: async () => ok ? { id: 7 } : { erro: 'Negado' } })
  });
  vm.runInContext(fonte.slice(inicio, fim), contexto);
  await contexto.requestAuthenticatedProfile('/api/perfil');
  assert.equal(confirmacoes.length, 0);
  await contexto.requestAuthenticatedProfile('/api/perfil/imagem', { method: 'POST' });
  await contexto.requestAuthenticatedProfile('/api/perfil/imagem', { method: 'DELETE' });
  assert.deepEqual(confirmacoes, [['alterar-avatar'], ['alterar-avatar']]);
  ok = false;
  await assert.rejects(contexto.requestAuthenticatedProfile('/api/perfil/imagem', { method: 'DELETE' }), /Negado/);
  assert.equal(confirmacoes.length, 2);
});
