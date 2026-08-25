/**
 * O proxy genérico não pode servir as tabelas do módulo de IA.
 *
 * `backend/server.js` expõe `GET/POST /api/:table`, que repassa qualquer tabela
 * para a API remota SEM checar permissão nenhuma. As tabelas de leitura ficam
 * fora dessa porta: todo acesso passa por `iaController`, que aplica
 * `exigirPermissao()` rota a rota.
 *
 * Este arquivo sobe o `server.js` de VERDADE, e não um Express montado à mão
 * como os outros testes do módulo. É proposital: a lista de bloqueio é uma
 * expressão regular no server.js, e um teste que só monta o controller nunca
 * chegaria perto dela. Foi assim que `ia_extracoes` passou batido — o prefixo
 * bloqueado era `ia_extraca`, que casa com `ia_extracao_arquivos` e
 * `ia_extracao_itens`, mas NÃO com `ia_extracoes` (com "o"). A tabela que lista
 * todas as leituras de todos os usuários era a única aberta.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

/**
 * API remota mínima: responde qualquer tabela, para o bloqueio ser o único
 * filtro em jogo.
 *
 * `usuarios/<id>` é o caso à parte: é por ele que o backend descobre QUEM está
 * chamando. Devolver a mesma lista genérica ali deixaria todo mundo sem perfil
 * — e o 403 viria da falta de permissão, não do bloqueio que se quer testar.
 */
function criarUpstream() {
  const servidas = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      servidas.push(`${req.method} ${tabela}`);
      res.writeHead(200, { 'content-type': 'application/json' });

      if (tabela === 'usuarios' && id) {
        return res.end(JSON.stringify({ id: Number(id), nome: 'Henrique', perfil: 'Sup Admin' }));
      }
      // Uma linha qualquer: se o proxy deixar passar, ela chega ao renderer.
      res.end(JSON.stringify([{ id: 1, titulo: 'leitura de outra pessoa' }]));
    });
  });
  return { servidor, servidas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './permissionsRepository',
  './iaProvedores', './iaLeitura', './iaController', './server'
];

async function montar() {
  const upstream = criarUpstream();
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];

  const app = require('./server');
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));

  return {
    porta: servidor.address().port,
    servidas: upstream.servidas,
    encerrar: async () => {
      await new Promise(r => servidor.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

const pedir = (porta, caminho, opcoes = {}) =>
  fetch(`http://127.0.0.1:${porta}${caminho}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${tokenDe(1)}`, 'content-type': 'application/json', ...(opcoes.headers || {}) }
  });

const TABELAS_DO_MODULO = ['ia_extracoes', 'ia_extracao_arquivos', 'ia_extracao_itens'];

test('nenhuma tabela do módulo de IA é legível pelo proxy genérico', async () => {
  const ctx = await montar();
  try {
    for (const tabela of TABELAS_DO_MODULO) {
      const resp = await pedir(ctx.porta, `/api/${tabela}`);
      assert.strictEqual(resp.status, 403, `${tabela} ficou legível pelo proxy`);

      const corpo = await resp.json();
      assert.strictEqual(corpo.code, 'FORBIDDEN');
      // E o pedido nem chegou à API remota: bloqueio antes de sair, não
      // filtragem do que voltou.
      assert.strictEqual(
        ctx.servidas.some(c => c.endsWith(tabela)), false,
        `${tabela} chegou a ser buscada na API remota`);
    }
  } finally {
    await ctx.encerrar();
  }
});

test('nenhuma tabela do módulo de IA é gravável pelo proxy genérico', async () => {
  const ctx = await montar();
  try {
    for (const tabela of TABELAS_DO_MODULO) {
      const resp = await pedir(ctx.porta, `/api/${tabela}`, {
        method: 'POST',
        body: JSON.stringify({ titulo: 'inserido por fora', destino: 'materia_prima' })
      });
      assert.strictEqual(resp.status, 403, `${tabela} ficou gravável pelo proxy`);
    }
  } finally {
    await ctx.encerrar();
  }
});

test('o bloqueio não pega tabela de outro módulo pelo prefixo', async () => {
  // Um prefixo curto demais levaria junto tabelas que não são do módulo — e o
  // bloqueio silencioso é pior de diagnosticar do que a falta dele.
  //
  // Só tabelas que o proxy genérico REALMENTE serve entram aqui. `clientes` e
  // `orcamentos` têm router próprio montado antes dele e nunca chegam ao
  // proxy: um 403 lá seria da permissão do módulo, não deste bloqueio.
  const ctx = await montar();
  try {
    for (const tabela of ['materia_prima', 'produtos', 'contratos']) {
      const resp = await pedir(ctx.porta, `/api/${tabela}`);
      assert.strictEqual(resp.status, 200, `${tabela} foi bloqueada sem motivo`);
    }
  } finally {
    await ctx.encerrar();
  }
});

test('as rotas do módulo continuam atendendo por /api/ia', async () => {
  // A prova de que o bloqueio não fechou a porta certa junto com a errada.
  const ctx = await montar();
  try {
    const resp = await pedir(ctx.porta, '/api/ia/lista');
    assert.strictEqual(resp.status, 200);
    assert.ok(Array.isArray((await resp.json()).destinos));
  } finally {
    await ctx.encerrar();
  }
});

test('ia_configuracao não é alcançável pelo proxy genérico', async () => {
  // Sem isto, a trava de Sup Admin do PUT /api/ia/config não valeria nada:
  // qualquer usuário logado gravaria a linha direto pela rota genérica e
  // trocaria o modelo de todo mundo.
  const ctx = await montar();
  try {
    // O proxy genérico só expõe GET e POST. PUT e DELETE não existem nele —
    // e por isso a conferência aqui é sobre os dois que existem.
    for (const metodo of ['GET', 'POST']) {
      const resp = await pedir(ctx.porta, '/api/ia_configuracao', {
        method: metodo,
        headers: { 'content-type': 'application/json' },
        ...(metodo === 'GET' ? {} : { body: JSON.stringify({ chave: 'groq_modelo', valor: 'x' }) })
      });
      assert.strictEqual(resp.status, 403, `${metodo} passou`);
    }

    // E as que não existem continuam não existindo: um PUT genérico que
    // aparecesse depois entraria sem passar por bloqueio nenhum.
    for (const metodo of ['PUT', 'DELETE']) {
      const resp = await pedir(ctx.porta, '/api/ia_configuracao/1', { method: metodo });
      assert.strictEqual(resp.status, 404, `${metodo} genérico passou a existir sem bloqueio`);
    }
    assert.strictEqual(ctx.servidas.some(c => c.includes('ia_configuracao')), false);
  } finally {
    await ctx.encerrar();
  }
});
