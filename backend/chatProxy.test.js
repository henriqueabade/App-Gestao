/**
 * /api/chat no programa (backend/chatController.js, 12/10/2026): fora do
 * BANCO=DEV, tudo do chat vai para a API (/chat) com o token da sessão.
 *
 * O que trava:
 *   - o token e o corpo vão junto; a resposta (e o código de erro) volta igual;
 *   - o ao vivo (/eventos) passa EM FLUXO — cada evento chega quando sai da
 *     API, não tudo junto no fim (senão o chat não seria "ao vivo");
 *   - fechou a tela, fecha a conexão com a API (presença "Offline" depende disso);
 *   - as citações (/referencias/*) ficam aqui, com as permissões de quem pede.
 *
 * A "API" é um servidor de mentira em 127.0.0.1 (a trava de teste não deixa
 * sair para outro endereço).
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

function criarApiFalsa() {
  const recebidas = [];
  const fluxo = { fechou: false, resolverFechou: null };
  fluxo.esperarFechar = new Promise(r => { fluxo.resolverFechou = r; });
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, caminho: req.url, auth: req.headers.authorization, rota: req.headers['x-rota'], corpo: corpo ? JSON.parse(corpo) : null });
      if (req.url === '/chat/eventos') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('retry: 5000\n\n');
        res.write('event: pronto\ndata: {"usuario_id":5}\n\n');
        const segundo = setTimeout(() => res.write('event: mensagem\ndata: {"conversa_id":1}\n\n'), 400);
        // O "close" da RESPOSTA: o do pedido dispara logo depois de lido o corpo.
        res.on('close', () => {
          clearTimeout(segundo);
          fluxo.fechou = true;
          fluxo.resolverFechou();
        });
        return;
      }
      const json = (status, dados) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(dados));
      };
      if (req.url === '/chat/resumo') return json(200, { eu: { id: 5 }, conversas: [], usuarios: [] });
      if (req.url === '/chat/conversas/1/mensagens' && req.method === 'POST') return json(201, { mensagem: { id: 77, texto: JSON.parse(corpo).texto } });
      if (req.url === '/chat/conversas/2/mensagens') return json(403, { error: 'Você não está nesta conversa.' });
      return json(404, { error: 'Rota não encontrada' });
    });
  });
  return { servidor, recebidas, fluxo };
}

async function montar() {
  const api = criarApiFalsa();
  await new Promise(r => api.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${api.servidor.address().port}`;
  for (const m of ['./chatController', './dataConfig']) delete require.cache[require.resolve(m)];
  const app = express();
  app.use(express.json());
  app.use(require('./contextoDaRota').middleware);
  app.use('/api/chat', require('./chatController'));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  return {
    base: `http://127.0.0.1:${servidor.address().port}`,
    api,
    async encerrar() {
      servidor.closeAllConnections?.();
      api.servidor.closeAllConnections?.();
      await new Promise(r => servidor.close(r));
      await new Promise(r => api.servidor.close(r));
      delete process.env.API_BASE_URL;
      delete require.cache[require.resolve('./chatController')];
    }
  };
}

test('repassa com o token; corpo e código de erro voltam iguais', async () => {
  const ctx = await montar();
  try {
    const resumo = await fetch(`${ctx.base}/api/chat/resumo`, { headers: { Authorization: 'Bearer abc.def.ghi' } });
    assert.strictEqual(resumo.status, 200);
    assert.deepStrictEqual(await resumo.json(), { eu: { id: 5 }, conversas: [], usuarios: [] });
    assert.strictEqual(ctx.api.recebidas[0].auth, 'Bearer abc.def.ghi');
    assert.ok(ctx.api.recebidas[0].rota, 'a rota de origem vai junto (registro de permissões da API)');

    const enviada = await fetch(`${ctx.base}/api/chat/conversas/1/mensagens`, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc.def.ghi', 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: 'Oi [[@7]]', resposta_de: null })
    });
    assert.strictEqual(enviada.status, 201);
    assert.deepStrictEqual(await enviada.json(), { mensagem: { id: 77, texto: 'Oi [[@7]]' } });
    assert.deepStrictEqual(ctx.api.recebidas[1].corpo, { texto: 'Oi [[@7]]', resposta_de: null });

    const negada = await fetch(`${ctx.base}/api/chat/conversas/2/mensagens`, { headers: { Authorization: 'Bearer x' } });
    assert.strictEqual(negada.status, 403);
    assert.strictEqual((await negada.json()).error, 'Você não está nesta conversa.');
  } finally {
    await ctx.encerrar();
  }
});

test('o ao vivo passa em fluxo e fechar a tela fecha a conexão com a API', async () => {
  const ctx = await montar();
  const controle = new AbortController();
  try {
    const inicio = Date.now();
    const resposta = await fetch(`${ctx.base}/api/chat/eventos`, { headers: { Authorization: 'Bearer abc' }, signal: controle.signal });
    assert.strictEqual(resposta.status, 200);
    assert.match(resposta.headers.get('content-type'), /text\/event-stream/);
    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let texto = '';
    let quandoPronto = null;
    while (!texto.includes('event: mensagem')) {
      const { value, done } = await leitor.read();
      if (done) break;
      texto += decodificador.decode(value, { stream: true });
      if (quandoPronto === null && texto.includes('event: pronto')) quandoPronto = Date.now() - inicio;
    }
    assert.ok(quandoPronto !== null && quandoPronto < 350, `o primeiro evento chegou antes do segundo sair da API (${quandoPronto} ms)`);
    assert.ok(texto.includes('data: {"conversa_id":1}'), 'o segundo evento chegou');
    controle.abort();
    await Promise.race([ctx.api.fluxo.esperarFechar, new Promise((_, n) => setTimeout(() => n(new Error('a conexão com a API ficou aberta')), 2000))]);
    assert.strictEqual(ctx.api.fluxo.fechou, true);
  } finally {
    controle.abort();
    await ctx.encerrar();
  }
});

test('as citações ficam no programa (não vão para a API do chat)', async () => {
  const ctx = await montar();
  try {
    const r = await fetch(`${ctx.base}/api/chat/referencias/buscar?q=loja`, { headers: { Authorization: 'Bearer abc' } });
    assert.ok([200, 401, 403].includes(r.status), `status ${r.status}`);
    assert.ok(!ctx.api.recebidas.some(x => x.caminho.startsWith('/chat/referencias')), 'nada de /chat/referencias na API');
  } finally {
    await ctx.encerrar();
  }
});
