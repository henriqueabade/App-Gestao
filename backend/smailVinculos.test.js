/**
 * Vincular ao Santíssimo Mail pelo programa (backend/smailVinculosController.js,
 * 14/10/2026). A "API central" é um servidor de mentira em 127.0.0.1.
 *
 * O que trava:
 *   - só as três rotas do próprio usuário passam (código, meus vínculos,
 *     encerrar); o serviço do Mail e a administração respondem 404 aqui;
 *   - o token da sessão vai junto; escopo desconhecido nem sai do programa;
 *   - o código chega à tela como veio, com Cache-Control: no-store, e nunca
 *     aparece em log;
 *   - limite (429 + Retry-After), integração desligada (503), encerrar (204)
 *     e vínculo inexistente (404 nao_encontrado) passam como vieram;
 *   - API sem as rotas (antes da integração) vira "sem_rota", não "vínculo
 *     não encontrado"; sem rede, 502 indisponivel.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const CODIGO = 'ABCDE23456';

function criarApiFalsa() {
  const recebidas = [];
  const modo = { codigos: 'ok', semRota: false };
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, caminho: req.url, auth: req.headers.authorization, corpo: corpo ? JSON.parse(corpo) : null });
      const json = (status, dados, extra = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(JSON.stringify(dados));
      };
      if (modo.semRota) {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<h1>Cannot POST</h1>');
      }
      const base = '/api/integracoes/smail/v1';
      if (req.method === 'POST' && req.url === `${base}/vinculos/codigos`) {
        if (modo.codigos === 'limite') return json(429, { error: 'limite', message: 'Muitas requisições. Aguarde um instante.' }, { 'retry-after': '420' });
        if (modo.codigos === 'desligada') return json(503, { error: 'indisponivel', message: 'Integração indisponível no momento.' });
        const pedidos = JSON.parse(corpo || '{}').escopos;
        return json(201, { codigo: CODIGO, expira_em: '2026-10-14T12:10:00.000Z', validade_segundos: 600, escopos: pedidos || ['crm', 'tarefas', 'calendario', 'chat', 'perfil'] });
      }
      if (req.method === 'GET' && req.url === `${base}/meus-vinculos`) {
        return json(200, { itens: [{ id: '0b7c3a8e-1111-4c2a-9a1d-2f6a4b5c6d7e', status: 'ativo', caixa: 'ana@santissimodecor.com.br', escopos: ['crm', 'chat'], criadoEm: '2026-10-13T10:00:00.000Z', expiraEm: '2027-10-13T10:00:00.000Z', revogadoEm: null, ultimoUsoEm: null }] });
      }
      if (req.method === 'DELETE' && req.url === `${base}/meus-vinculos/0b7c3a8e-1111-4c2a-9a1d-2f6a4b5c6d7e`) {
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'DELETE') return json(404, { error: 'nao_encontrado', message: 'Registro não encontrado.' });
      return json(404, { error: 'Rota não encontrada' });
    });
  });
  return { servidor, recebidas, modo };
}

async function montar() {
  const api = criarApiFalsa();
  await new Promise(r => api.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${api.servidor.address().port}`;
  delete require.cache[require.resolve('./smailVinculosController')];
  const app = express();
  app.use(express.json());
  app.use('/api/integracoes/smail/v1', require('./smailVinculosController'));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}/api/integracoes/smail/v1`;
  const chamar = (metodo, caminho, corpo) => fetch(base + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer sessao.do.usuario', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return {
    api, chamar,
    async encerrar() {
      await new Promise(r => servidor.close(r));
      await new Promise(r => api.servidor.close(r));
      delete process.env.API_BASE_URL;
      delete require.cache[require.resolve('./smailVinculosController')];
    }
  };
}

/** Tudo o que sair no console durante `fn` (para conferir que o código não vaza). */
async function console_(fn) {
  const saidas = [];
  const originais = {};
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug']) {
    originais[nivel] = console[nivel];
    console[nivel] = (...a) => saidas.push(a.map(String).join(' '));
  }
  try {
    await fn();
  } finally {
    Object.assign(console, originais);
  }
  return saidas.join('\n');
}

test('gerar código: o token vai junto; o código volta como veio, sem cache e sem log', async () => {
  const ctx = await montar();
  try {
    let r;
    let dados;
    const logs = await console_(async () => {
      r = await ctx.chamar('POST', '/vinculos/codigos', { escopos: ['chat', 'crm', 'chat'] });
      dados = await r.json();
    });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(dados.codigo, CODIGO);
    assert.strictEqual(r.headers.get('cache-control'), 'no-store');
    assert.strictEqual(ctx.api.recebidas[0].auth, 'Bearer sessao.do.usuario');
    assert.deepStrictEqual(ctx.api.recebidas[0].corpo, { escopos: ['crm', 'chat'] }, 'na ordem do contrato, sem repetir');
    assert.ok(!logs.includes(CODIGO), 'o código não aparece em log');

    r = await ctx.chamar('POST', '/vinculos/codigos', {});
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual(ctx.api.recebidas[1].corpo, {}, 'sem escolher: o padrão da API (todos)');

    const antes = ctx.api.recebidas.length;
    for (const escopos of [['email'], [], 'crm']) {
      r = await ctx.chamar('POST', '/vinculos/codigos', { escopos });
      assert.strictEqual(r.status, 400);
      assert.strictEqual((await r.json()).error, 'invalido');
    }
    assert.strictEqual(ctx.api.recebidas.length, antes, 'escopo errado nem sai do programa');
  } finally {
    await ctx.encerrar();
  }
});

test('limite (429 + Retry-After) e integração desligada (503) passam como vieram', async () => {
  const ctx = await montar();
  try {
    ctx.api.modo.codigos = 'limite';
    let r = await ctx.chamar('POST', '/vinculos/codigos', {});
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.headers.get('retry-after'), '420');
    assert.strictEqual((await r.json()).error, 'limite');
    ctx.api.modo.codigos = 'desligada';
    r = await ctx.chamar('POST', '/vinculos/codigos', {});
    assert.strictEqual(r.status, 503);
    assert.strictEqual((await r.json()).error, 'indisponivel');
  } finally {
    await ctx.encerrar();
  }
});

test('meus vínculos e encerrar; vínculo inexistente é nao_encontrado; id torto nem sai', async () => {
  const ctx = await montar();
  try {
    let r = await ctx.chamar('GET', '/meus-vinculos');
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).itens[0].caixa, 'ana@santissimodecor.com.br');
    r = await ctx.chamar('DELETE', '/meus-vinculos/0b7c3a8e-1111-4c2a-9a1d-2f6a4b5c6d7e');
    assert.strictEqual(r.status, 204);
    r = await ctx.chamar('DELETE', '/meus-vinculos/0b7c3a8e-0000-0000-0000-000000000000');
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).error, 'nao_encontrado');
    const antes = ctx.api.recebidas.length;
    r = await ctx.chamar('DELETE', '/meus-vinculos/..%2F..%2Fusuarios');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(ctx.api.recebidas.length, antes, 'id fora do formato nem chega à API');
  } finally {
    await ctx.encerrar();
  }
});

test('só as rotas do próprio usuário: serviço do Mail e administração respondem 404 aqui', async () => {
  const ctx = await montar();
  try {
    for (const [metodo, caminho] of [
      ['POST', '/vinculos'], ['POST', '/vinculos/x/token'], ['GET', '/me'], ['GET', '/clientes'],
      ['GET', '/admin/preautorizacoes'], ['POST', '/admin/preautorizacoes'], ['POST', '/vinculos/automatico']
    ]) {
      const r = await ctx.chamar(metodo, caminho, metodo === 'POST' ? {} : undefined);
      assert.strictEqual(r.status, 404, `${metodo} ${caminho}`);
    }
    assert.strictEqual(ctx.api.recebidas.length, 0, 'nada disso chegou à API');
  } finally {
    await ctx.encerrar();
  }
});

test('API sem a integração (404 de rota) vira "sem_rota"; sem rede, 502 indisponivel', async () => {
  const ctx = await montar();
  try {
    ctx.api.modo.semRota = true;
    let r = await ctx.chamar('GET', '/meus-vinculos');
    assert.strictEqual(r.status, 404);
    assert.strictEqual((await r.json()).error, 'sem_rota');
    ctx.api.modo.semRota = false;
    r = await ctx.chamar('POST', '/meus-vinculos/abc', {});
    assert.strictEqual(r.status, 404, 'POST em meus-vinculos não existe');
    await new Promise(res => ctx.api.servidor.close(res));
    await console_(async () => {
      r = await ctx.chamar('GET', '/meus-vinculos');
    });
    assert.strictEqual(r.status, 502);
    assert.strictEqual((await r.json()).error, 'indisponivel');
    ctx.api.servidor.listen(0, '127.0.0.1');
  } finally {
    await ctx.encerrar().catch(() => {});
  }
});

test('montado no servidor do programa antes do proxy genérico', () => {
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  const pos = server.indexOf("app.use('/api/integracoes/smail/v1', require('./smailVinculosController'));");
  assert.ok(pos > 0);
  const generico = server.search(/app\.use\('\/api', [a-zA-Z]*[Pp]roxy|app\.use\('\/api\/:/);
  if (generico > 0) assert.ok(pos < generico, 'antes do proxy genérico');
});
