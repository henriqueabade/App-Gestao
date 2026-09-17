/**
 * Desenhistas (backend/desenhistasController.js): quem vê, quem inclui e quem
 * exclui; nome repetido (sem acento/maiúscula) não entra; o "−" recusa se
 * alguma peça usa o nome; sem o SQL, a tela recebe o aviso do arquivo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const TOKEN = 'x.eyJpZCI6MX0.assinatura';

function criarUpstream(tabelas) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const responder = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const [, tabela, id] = url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/) || [];
    const lista = tabela && tabelas[tabela];
    if (!lista) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const dados = corpo ? JSON.parse(corpo) : {};
      if (req.method === 'GET') {
        const filtros = [...url.searchParams.entries()].filter(([k]) => k !== 'select');
        return responder(200, lista.filter(l => filtros.every(([k, v]) => String(l[k]) === String(v))));
      }
      if (req.method === 'POST') {
        const linha = { id: lista.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1, ...dados };
        lista.push(linha);
        return responder(201, linha);
      }
      if (req.method === 'DELETE' && id) {
        const i = lista.findIndex(l => String(l.id) === id);
        if (i >= 0) lista.splice(i, 1);
        return responder(200, {});
      }
      return responder(404, { error: 'não há' });
    });
    return undefined;
  });
}

async function montar(tabelas) {
  const upstream = criarUpstream(tabelas);
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  for (const chave of Object.keys(require.cache)) {
    if (/[\\/]backend[\\/](cobranca|fiscal)[\\/]/.test(chave) || /(apiHttpClient|permissionsController|cobrancaController|desenhistasController)\.js$/.test(chave)) delete require.cache[chave];
  }
  const estado = { chaves: new Set() };
  const caminhoPerm = require.resolve('./permissionsController');
  require.cache[caminhoPerm] = {
    id: caminhoPerm, filename: caminhoPerm, loaded: true,
    exports: {
      exigirPermissao: chave => (req, res, next) => ([].concat(chave).every(k => estado.chaves.has(k)) ? next() : res.status(403).json({ error: 'Permissão negada' })),
      exigirAlgumaPermissao: chaves => (req, res, next) => ([].concat(chaves).some(k => estado.chaves.has(k)) ? next() : res.status(403).json({ error: 'Permissão negada' })),
      exigirSupAdmin: (req, res) => res.status(403).json({ error: 'Somente Sup Admin' }),
      ehSupAdmin: async () => false
    }
  };
  const { criarRouter } = require('./desenhistasController');
  const app = express();
  app.use(express.json());
  app.use('/api/desenhistas', criarRouter());
  const servidor = http.createServer(app);
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { status: r.status, corpo: await r.json() };
  };
  const permitir = (...chaves) => chaves.forEach(c => estado.chaves.add(c));
  const fechar = () => Promise.all([new Promise(r => servidor.close(r)), new Promise(r => upstream.close(r))]);
  return { chamar, permitir, tabelas, fechar };
}

test('desenhistas: ver com a permissão das peças; incluir e excluir com as próprias; repetido e em uso são recusados', async () => {
  const tabelas = {
    desenhistas: [{ id: 1, nome: 'Barral & Lamounier' }],
    produtos: [{ id: 10, desenhado_por: 'barral & lamounier' }, { id: 11, desenhado_por: null }]
  };
  const t = await montar(tabelas);
  try {
    assert.equal((await t.chamar('GET', '/api/desenhistas')).status, 403);
    t.permitir('prod.view');
    assert.deepEqual((await t.chamar('GET', '/api/desenhistas')).corpo, { desenhistas: [{ id: 1, nome: 'Barral & Lamounier' }] });

    assert.equal((await t.chamar('POST', '/api/desenhistas', { nome: 'Estúdio Ninho' })).status, 403, 'ver não é incluir');
    t.permitir('prod.designer.create');
    assert.equal((await t.chamar('POST', '/api/desenhistas', { nome: ' x ' })).status, 400);
    const repetido = await t.chamar('POST', '/api/desenhistas', { nome: '  BARRAL   &  lamounier ' });
    assert.equal(repetido.status, 409);
    assert.equal(repetido.corpo.desenhista.id, 1, 'a tela seleciona o que já existe');
    const novo = await t.chamar('POST', '/api/desenhistas', { nome: '  Estúdio   Ninho ' });
    assert.equal(novo.status, 200);
    assert.deepEqual(novo.corpo.desenhista, { id: 2, nome: 'Estúdio Ninho' });
    assert.deepEqual(novo.corpo.desenhistas.map(d => d.nome), ['Barral & Lamounier', 'Estúdio Ninho']);
    assert.equal(tabelas.desenhistas[1].criado_por, 1);

    assert.equal((await t.chamar('DELETE', '/api/desenhistas/2')).status, 403, 'incluir não é excluir');
    t.permitir('prod.designer.delete');
    const emUso = await t.chamar('DELETE', '/api/desenhistas/1');
    assert.equal(emUso.status, 409);
    assert.equal(emUso.corpo.dependente, true);
    assert.match(emUso.corpo.error, /desenhista de 1 peça: troque/);
    assert.equal((await t.chamar('DELETE', '/api/desenhistas/99')).status, 404);
    const removido = await t.chamar('DELETE', '/api/desenhistas/2');
    assert.equal(removido.status, 200);
    assert.deepEqual(removido.corpo.desenhistas.map(d => d.id), [1]);
  } finally {
    await t.fechar();
  }
});

test('desenhistas sem o SQL: 409 com sql_pendente e o nome do arquivo', async () => {
  const t = await montar({ produtos: [] });
  try {
    t.permitir('prod.edit', 'prod.designer.create');
    const r = await t.chamar('GET', '/api/desenhistas');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.sql_pendente, true);
    assert.match(r.corpo.error, /desenhistas_producao_parcela\.sql/);
    assert.equal((await t.chamar('POST', '/api/desenhistas', { nome: 'Alguém' })).status, 409);
  } finally {
    await t.fechar();
  }
});

test('server.js monta /api/desenhistas antes do proxy genérico /api/:table', () => {
  const fonte = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  const rota = fonte.indexOf("app.use('/api/desenhistas'");
  const generico = fonte.indexOf("app.get('/api/:table'");
  assert.ok(rota > 0 && generico > rota);
});
