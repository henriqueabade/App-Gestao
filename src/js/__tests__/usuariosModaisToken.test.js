/**
 * "Token inválido" ao abrir as permissões e os modelos (dono, 22/10/2026).
 *
 * Os modais de Modelos de Permissão e de Transferir usuário mandavam
 * `authorization: Bearer <id do usuário>` ("Bearer 13"). O servidor do
 * programa respeita o cabeçalho que a tela manda (e recusa token forjado —
 * localDataClient.test.js), então a API de produção recebia "13" e respondia
 * 401 "Token inválido": o Sup Admin não era reconhecido. Sem cabeçalho, o
 * servidor do programa põe o token da sessão.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ler = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

test('nenhuma tela manda "Bearer <id do usuário>" como token', () => {
  for (const modal of ['js/modals/usuario-permissoes.js', 'js/modals/usuario-transferir.js']) {
    const js = ler(modal);
    assert.ok(!js.includes('`Bearer ${usuarioId}`'), `${modal}: sem Bearer <id>`);
    assert.ok(!/headers\.set\('authorization'/.test(js), `${modal}: o token vem do servidor do programa`);
    assert.ok(js.includes("headers.set('x-usuario-id', String(usuarioId));"), `${modal}: o id segue no cabeçalho próprio`);
  }
  const servidor = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'backend', 'server.js'), 'utf8');
  assert.match(servidor, /if \(!req\.headers\.authorization\) \{\s+const stored = getToken\(\);/, 'sem cabeçalho, o token da sessão');
});
