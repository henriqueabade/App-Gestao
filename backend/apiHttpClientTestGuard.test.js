/**
 * Garante que a suíte de testes nunca consiga falar com a API real.
 *
 * Este teste existe por causa de um incidente concreto: rodar `npm test`
 * executava rotas de proxy contra https://api.santissimodecor.com.br usando o
 * JWT real salvo em data/authToken.json, e o teste
 * "DELETE /api/usuarios/:id remove usuário sem vínculos" apagava um usuário
 * de verdade no banco de produção.
 */
const test = require('node:test');
const assert = require('node:assert');

const clientPath = require.resolve('./apiHttpClient');

function carregarClient(baseUrl) {
  const anterior = process.env.API_BASE_URL;
  if (baseUrl === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = baseUrl;

  delete require.cache[clientPath];
  const mod = require('./apiHttpClient');

  if (anterior === undefined) delete process.env.API_BASE_URL;
  else process.env.API_BASE_URL = anterior;

  return mod;
}

test('bloqueia qualquer chamada à API real durante os testes', async () => {
  const { createApiClient } = carregarClient(undefined); // cai no default: produção
  const api = createApiClient({ headers: { authorization: 'Bearer token-real-falso' } });

  for (const [metodo, executar] of [
    ['GET', () => api.get('/api/usuarios')],
    ['POST', () => api.post('/api/usuarios', { nome: 'x' })],
    ['PUT', () => api.put('/api/usuarios/1', { nome: 'x' })],
    ['DELETE', () => api.delete('/api/usuarios/1')]
  ]) {
    await assert.rejects(
      executar,
      err => {
        assert.strictEqual(err.status, 599, `${metodo} deveria ser bloqueado`);
        assert.match(err.message, /BLOQUEADO/);
        assert.match(err.message, /santissimodecor/);
        return true;
      },
      `${metodo} para a API real precisa ser bloqueado`
    );
  }
});

test('permite mock em host local', async () => {
  const http = require('node:http');
  const servidor = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, metodo: req.method }));
  });
  await new Promise(resolve => servidor.listen(0, '127.0.0.1', resolve));
  const { port } = servidor.address();

  try {
    const { createApiClient } = carregarClient(`http://127.0.0.1:${port}`);
    const api = createApiClient({ headers: { authorization: 'Bearer teste' } });

    const resposta = await api.get('/api/usuarios');
    assert.deepStrictEqual(resposta, { ok: true, metodo: 'GET' });

    // DELETE contra o mock continua permitido — o alvo é local.
    const apagado = await api.delete('/api/usuarios/1');
    assert.strictEqual(apagado.metodo, 'DELETE');
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    delete require.cache[clientPath];
  }
});
