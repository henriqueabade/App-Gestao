const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const acessoLocal = require('./acessoLocal');

// Servidor no molde do server.js: a contenção primeiro, depois o body-parser.
async function subir() {
  const app = express();
  const vistos = { corpos: 0 };
  app.use(acessoLocal.exigirPrograma);
  app.use(acessoLocal.recusarCorpoComprimido);
  app.use(acessoLocal.corsLocal);
  app.use(express.json());
  app.post('/api/eco', (req, res) => { vistos.corpos += 1; res.json(req.body); });
  app.get('/api/usuarios/confirmar-email', (_req, res) => res.json({ ok: 'link' }));
  app.post('/api/usuarios/confirmar-email', (_req, res) => res.json({ ok: 'post' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  const servidor = await new Promise(pronto => { const s = app.listen(0, '127.0.0.1', () => pronto(s)); });
  return { servidor, porta: servidor.address().port, vistos };
}

// http.request cru: dá para mandar Host e Origin falsos (o fetch não deixa).
function pedir(porta, { metodo = 'GET', caminho = '/healthz', cabecalhos = {}, corpo } = {}) {
  return new Promise((pronto, falhou) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos }, res => {
      let texto = '';
      res.on('data', d => { texto += d; });
      res.on('end', () => pronto({ status: res.statusCode, cabecalhos: res.headers, texto }));
    });
    req.on('error', falhou);
    req.end(corpo);
  });
}

test.afterEach(() => acessoLocal._desativar());

test('sem ativar (testes, node backend/server.js): tudo passa como antes, menos corpo comprimido', async () => {
  const { servidor, porta, vistos } = await subir();
  try {
    assert.equal((await pedir(porta)).status, 200);
    assert.equal((await pedir(porta, { cabecalhos: { origin: 'https://site-qualquer.example' } })).cabecalhos['access-control-allow-origin'], '*');
    const comprimido = await pedir(porta, { metodo: 'POST', caminho: '/api/eco', cabecalhos: { 'content-type': 'application/json', 'content-encoding': 'br' }, corpo: Buffer.from([1, 2, 3]) });
    assert.equal(comprimido.status, 415);
    assert.equal(vistos.corpos, 0);
  } finally {
    servidor.close();
  }
});

test('ativo: sem o segredo do programa nada passa', async () => {
  const { servidor, porta } = await subir();
  acessoLocal.ativar(porta);
  try {
    assert.equal((await pedir(porta)).status, 401);
    assert.equal((await pedir(porta, { cabecalhos: { [acessoLocal.CABECALHO]: 'chute' } })).status, 401);
    assert.equal((await pedir(porta, { cabecalhos: acessoLocal.cabecalhos() })).status, 200);
    // tela do programa (file:// manda Origin "null")
    const tela = await pedir(porta, { cabecalhos: { ...acessoLocal.cabecalhos(), origin: 'null' } });
    assert.equal(tela.status, 200);
    assert.equal(tela.cabecalhos['access-control-allow-origin'], 'null');
  } finally {
    servidor.close();
  }
});

test('ativo: site externo e DNS rebinding são barrados mesmo que tenham o segredo', async () => {
  const { servidor, porta } = await subir();
  acessoLocal.ativar(porta);
  try {
    const comSegredo = acessoLocal.cabecalhos();
    assert.equal((await pedir(porta, { cabecalhos: { ...comSegredo, origin: 'https://site-qualquer.example' } })).status, 403);
    assert.equal((await pedir(porta, { cabecalhos: { ...comSegredo, host: `site-qualquer.example:${porta}` } })).status, 403);
    assert.equal((await pedir(porta, { cabecalhos: { ...comSegredo, host: `127.0.0.1:${porta + 1}` } })).status, 403);
    assert.equal((await pedir(porta, { cabecalhos: { ...comSegredo, host: `localhost:${porta}` } })).status, 200);
    // pré-verificação do CORS: só para as origens do programa, e sem dado nenhum
    const preDeFora = await pedir(porta, { metodo: 'OPTIONS', caminho: '/api/eco', cabecalhos: { origin: 'https://site-qualquer.example', 'access-control-request-method': 'POST' } });
    assert.equal(preDeFora.status, 403);
    const preDoPrograma = await pedir(porta, { metodo: 'OPTIONS', caminho: '/api/eco', cabecalhos: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(preDoPrograma.status, 204);
    assert.equal(preDoPrograma.cabecalhos['access-control-allow-origin'], 'null');
  } finally {
    servidor.close();
  }
});

test('ativo: os links de e-mail (GET com token próprio) seguem abertos; o resto da rota não', async () => {
  const { servidor, porta } = await subir();
  acessoLocal.ativar(porta);
  try {
    assert.equal((await pedir(porta, { caminho: '/api/usuarios/confirmar-email?token=x' })).status, 200);
    assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/usuarios/confirmar-email' })).status, 401);
  } finally {
    servidor.close();
  }
});

test('ativo: corpo JSON normal passa; comprimido (br, gzip, deflate) nunca chega ao body-parser', async () => {
  const { servidor, porta, vistos } = await subir();
  acessoLocal.ativar(porta);
  try {
    const base = { ...acessoLocal.cabecalhos(), 'content-type': 'application/json' };
    const normal = await pedir(porta, { metodo: 'POST', caminho: '/api/eco', cabecalhos: base, corpo: JSON.stringify({ a: 1 }) });
    assert.equal(normal.status, 200);
    assert.deepEqual(JSON.parse(normal.texto), { a: 1 });
    for (const codificacao of ['br', 'gzip', 'deflate', 'BR', 'gzip, br']) {
      const r = await pedir(porta, { metodo: 'POST', caminho: '/api/eco', cabecalhos: { ...base, 'content-encoding': codificacao }, corpo: Buffer.from([0x1b, 0, 0]) });
      assert.equal(r.status, 415, codificacao);
    }
    assert.equal((await pedir(porta, { metodo: 'POST', caminho: '/api/eco', cabecalhos: { ...base, 'content-encoding': 'identity' }, corpo: '{"b":2}' })).status, 200);
    assert.equal(vistos.corpos, 2);
  } finally {
    servidor.close();
  }
});

test('fetch do processo principal leva o segredo só para o backend local', async () => {
  const recebidos = [];
  const espiao = await new Promise(pronto => {
    const s = http.createServer((req, res) => { recebidos.push(req.headers[acessoLocal.CABECALHO] || null); res.end('ok'); });
    s.listen(0, '127.0.0.1', () => pronto(s));
  });
  const outro = await new Promise(pronto => {
    const s = http.createServer((req, res) => { recebidos.push(req.headers[acessoLocal.CABECALHO] || null); res.end('ok'); });
    s.listen(0, '127.0.0.1', () => pronto(s));
  });
  const fetchAntes = globalThis.fetch;
  try {
    acessoLocal.ativar(espiao.address().port);
    acessoLocal.instalarNoFetch();
    await (await fetch(`http://127.0.0.1:${espiao.address().port}/x`)).text();
    await (await fetch(`http://127.0.0.1:${outro.address().port}/x`)).text();
    assert.equal(recebidos[0], acessoLocal.cabecalhos()[acessoLocal.CABECALHO]);
    assert.equal(recebidos[1], null);
    assert.deepEqual(acessoLocal.cabecalhosPara(`https://api.santissimodecor.com.br/api/x`), {});
    assert.deepEqual(acessoLocal.cabecalhosPara(`http://localhost:${espiao.address().port}/healthz`), acessoLocal.cabecalhos());
  } finally {
    globalThis.fetch = fetchAntes;
    espiao.close();
    outro.close();
  }
});
