/**
 * As chamadas à API dizem de que rota daqui vieram (X-Rota) e o que ela exigiu
 * (X-Permissoes-Rota) — só para o registro de permissões da API (Segurança,
 * 09/10/2026). Vale para o apiHttpClient e para o `db` (remoteDatabase), sem
 * ninguém passar o `req` adiante.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

test('rótulo: o molde da rota (sem ids) e só ASCII', () => {
  const { rotulo, cabecalhos } = require('./contextoDaRota');
  assert.equal(rotulo({ method: 'PUT', baseUrl: '/api/pedidos', route: { path: '/:id/status' } }), 'PUT /api/pedidos/:id/status');
  assert.equal(rotulo({ method: 'GET', originalUrl: '/api/pedidos/42/itens/7?x=1' }), 'GET /api/pedidos/:id/itens/:id');
  assert.equal(rotulo({ method: 'GET', originalUrl: '/api/situação' }), 'GET /api/situa??o');
  assert.deepEqual(cabecalhos(), { 'X-Rota': 'segundo-plano' }, 'fora de requisição');
});

test('apiHttpClient e db mandam a rota e as chaves exigidas, de dentro de qualquer rota', async () => {
  const recebidos = [];
  const upstream = http.createServer((req, res) => {
    recebidos.push({ url: req.url, rota: req.headers['x-rota'], chaves: req.headers['x-permissoes-rota'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  const caminhos = ['./apiHttpClient', './remoteDatabase', './contextoDaRota'].map(p => require.resolve(p));
  caminhos.forEach(p => delete require.cache[p]);
  const { createApiClient } = require('./apiHttpClient');
  const db = require('./remoteDatabase');
  const contexto = require('./contextoDaRota');

  const app = express();
  app.use(contexto.middleware);
  const pedidos = express.Router();
  pedidos.put('/:id/status', (req, _res, next) => { req.permissoesExigidas = ['ped.status.ship', 'ped.status.deliver']; next(); }, async (req, res) => {
    await createApiClient(req).get('/api/pedidos/5');
    // O `db` não recebe o req: acha a rota pelo contexto (depois de um await).
    await new Promise(r => setTimeout(r, 5));
    await db.get('/pedidos_itens', { token: 'abc' });
    res.json({ ok: true });
  });
  app.use('/api/pedidos', pedidos);
  const servidor = app.listen(0);
  await new Promise(r => servidor.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/pedidos/5/status`, { method: 'PUT', headers: { authorization: 'Bearer abc' } });
    assert.equal(r.status, 200);
    assert.deepEqual(recebidos.map(x => [x.rota, x.chaves]), [
      ['PUT /api/pedidos/:id/status', 'ped.status.ship,ped.status.deliver'],
      ['PUT /api/pedidos/:id/status', 'ped.status.ship,ped.status.deliver']
    ]);
    // Fora de requisição (tarefa em segundo plano):
    await db.get('/boletos_eventos', { token: 'abc' });
    assert.equal(recebidos.at(-1).rota, 'segundo-plano');
    assert.equal(recebidos.at(-1).chaves, undefined);
  } finally {
    await new Promise(r => servidor.close(r));
    await new Promise(r => upstream.close(r));
    delete process.env.API_BASE_URL;
    caminhos.forEach(p => delete require.cache[p]);
  }
});

test('as guardas de rota anotam o que exigem (exigirPermissao, exigirAlgumaPermissao, exigirSupAdmin)', () => {
  const fonte = require('node:fs').readFileSync(require.resolve('./permissionsController'), 'utf8');
  assert.ok(fonte.includes('req.permissoesExigidas = chaves;'));
  assert.ok(fonte.includes('req.permissoesExigidas = lista;'));
  assert.ok(fonte.includes("req.permissoesExigidas = ['supadmin'];"));
  const servidor = require('node:fs').readFileSync(require.resolve('./server'), 'utf8');
  assert.ok(servidor.indexOf("app.use(require('./contextoDaRota').middleware);") < servidor.indexOf("app.use('/api/clientes', clientesRouter);"), 'antes dos routers');
});
