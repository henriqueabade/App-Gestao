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

// Bytes que não são texto (um PNG de verdade começa assim): passam intactos?
const BYTES_DA_FOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80, 0x7f, 0x00, 0x10]);

function criarApiFalsa() {
  const recebidas = [];
  const fluxo = { fechou: false, resolverFechou: null };
  fluxo.esperarFechar = new Promise(r => { fluxo.resolverFechou = r; });
  const servidor = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', p => { pedacos.push(p); });
    req.on('end', () => {
      const corpoBruto = Buffer.concat(pedacos);
      const corpo = /json/.test(req.headers['content-type'] || '') ? corpoBruto.toString('utf8') : '';
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
      // Fase 2: o arquivo sobe em bytes e desce em bytes.
      if (req.url === '/chat/conversas/1/anexos' && req.method === 'POST') {
        return json(201, { anexo: { id: 9, recebidos: Buffer.from(corpoBruto).toString('base64'), tipo: req.headers['content-type'], nome: req.headers['x-nome-arquivo'], tipoDito: req.headers['x-tipo-arquivo'] } });
      }
      if (req.url === '/chat/anexos/9') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-disposition': "inline; filename=\"foto.png\"; filename*=UTF-8''foto.png", 'x-content-type-options': 'nosniff' });
        return res.end(BYTES_DA_FOTO);
      }
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

test('arquivos (fase 2): sobem em bytes com o nome e o tipo; descem em bytes com o tipo e o nome da API', async () => {
  const ctx = await montar();
  try {
    const enviado = await fetch(`${ctx.base}/api/chat/conversas/1/anexos`, {
      method: 'POST',
      headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/octet-stream', 'X-Nome-Arquivo': encodeURIComponent('relatório.png'), 'X-Tipo-Arquivo': 'image%2Fpng' },
      body: BYTES_DA_FOTO
    });
    assert.strictEqual(enviado.status, 201);
    const { anexo } = await enviado.json();
    assert.ok(Buffer.from(anexo.recebidos, 'base64').equals(BYTES_DA_FOTO), 'a API recebeu os mesmos bytes');
    assert.strictEqual(anexo.tipo, 'application/octet-stream');
    assert.strictEqual(decodeURIComponent(anexo.nome), 'relatório.png');
    assert.strictEqual(anexo.tipoDito, 'image%2Fpng');

    const baixado = await fetch(`${ctx.base}/api/chat/anexos/9`, { headers: { Authorization: 'Bearer abc' } });
    assert.strictEqual(baixado.status, 200);
    assert.strictEqual(baixado.headers.get('content-type'), 'image/png');
    assert.match(baixado.headers.get('content-disposition'), /^inline; filename="foto\.png"/);
    assert.strictEqual(baixado.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await baixado.arrayBuffer()).equals(BYTES_DA_FOTO), 'o programa recebe os mesmos bytes');

    const grande = await fetch(`${ctx.base}/api/chat/conversas/1/anexos`, {
      method: 'POST', headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(21 * 1024 * 1024)
    });
    assert.strictEqual(grande.status, 413, 'mais de 20 MB nem sai do programa');
    const subidas = ctx.api.recebidas.filter(r => r.metodo === 'POST' && r.caminho === '/chat/conversas/1/anexos');
    assert.strictEqual(subidas.length, 1, 'o grande não chegou à API');
  } finally {
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
