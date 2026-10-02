/**
 * Usuários › Computadores (01/10/2026, decisão do dono): só o Sup Admin vê os
 * computadores que recebem os avisos do Windows de um usuário e cancela o de
 * um deles (o token daquele computador para de valer — a API confere em
 * avisos_dispositivos). Sem a tabela (SQL não rodado), a tela diz o que fazer.
 */
process.env.NODE_ENV = 'test';
process.env.BANCO = 'DEV';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

/** Troca um módulo no cache do require e devolve como desfazer. */
function trocar(caminho, exportsFalsos) {
  const id = require.resolve(caminho);
  const antes = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsFalsos };
  return () => { if (antes) require.cache[id] = antes; else delete require.cache[id]; };
}

/** Um /api genérico de mentira com avisos_dispositivos e usuarios. */
function apiFalsa({ semTabela = false } = {}) {
  const linhas = [
    { id: 1, usuario_id: 7, computador: 'ESCRITORIO-01', usuario_windows: 'ana', criado_em: '2026-09-01T10:00:00Z', ultimo_uso_em: '2026-09-30T08:00:00Z', cancelado_em: null, cancelado_por: null },
    { id: 2, usuario_id: 7, computador: 'NOTE-ANA', usuario_windows: 'ana', criado_em: '2026-09-10T10:00:00Z', ultimo_uso_em: '2026-10-01T09:00:00Z', cancelado_em: null, cancelado_por: null },
    { id: 3, usuario_id: 7, computador: 'VELHO', usuario_windows: null, criado_em: '2026-08-01T10:00:00Z', ultimo_uso_em: '2026-08-02T10:00:00Z', cancelado_em: '2026-08-05T10:00:00Z', cancelado_por: 2 },
    { id: 4, usuario_id: 8, computador: 'DE-OUTRO', usuario_windows: 'bia', criado_em: '2026-09-01T10:00:00Z', ultimo_uso_em: null, cancelado_em: null, cancelado_por: null }
  ];
  const puts = [];
  const faltaTabela = () => Object.assign(new Error('relation "avisos_dispositivos" does not exist'), { code: '42P01' });
  return {
    linhas, puts,
    async get(caminho, { query } = {}) {
      if (caminho === '/api/usuarios') return [{ id: 2, nome: 'Henrique' }, { id: 7, nome: 'Ana' }];
      if (semTabela) throw faltaTabela();
      if (caminho === '/api/avisos_dispositivos') return linhas.filter(l => !query?.usuario_id || l.usuario_id === query.usuario_id);
      const m = caminho.match(/^\/api\/avisos_dispositivos\/(\d+)$/);
      if (m) {
        const l = linhas.find(x => x.id === Number(m[1]));
        if (!l) throw Object.assign(new Error('não encontrado'), { status: 404 });
        return { ...l };
      }
      throw new Error(`GET inesperado: ${caminho}`);
    },
    async put(caminho, corpo) {
      if (semTabela) throw faltaTabela();
      puts.push([caminho, corpo]);
      const l = linhas.find(x => `/api/avisos_dispositivos/${x.id}` === caminho);
      Object.assign(l, corpo);
      return l;
    }
  };
}

async function servidor({ supAdmin = true, semTabela = false } = {}) {
  const api = apiFalsa({ semTabela });
  const desfazer = [
    trocar('./apiHttpClient', { ...require('./apiHttpClient'), createApiClient: () => api }),
    trocar('./permissionsController', {
      exigirSupAdmin: (_req, res, next) => (supAdmin ? next() : res.status(403).json({ error: 'Ação restrita ao Sup Admin', code: 'FORBIDDEN_SUP_ADMIN' })),
      limparCachePermissoes: () => {}
    })
  ];
  delete require.cache[require.resolve('./usuariosController')];
  const router = require('./usuariosController');
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', router);
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/api/usuarios`;
  const pedir = async (metodo, caminho) => {
    const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { Authorization: 'Bearer 2', 'Content-Type': 'application/json' } });
    return { status: r.status, corpo: await r.json() };
  };
  return {
    api, pedir,
    fechar: async () => {
      await new Promise(r => srv.close(r));
      desfazer.forEach(d => d());
      delete require.cache[require.resolve('./usuariosController')];
    }
  };
}

test('montarComputadores: ativos primeiro, o mais recente em cima; quem cancelou pelo nome; sem nome vira "Computador sem nome"', () => {
  const { montarComputadores } = require('./usuariosController');
  const lista = montarComputadores([
    { id: 1, computador: 'A', ultimo_uso_em: '2026-09-30T08:00:00Z' },
    { id: 3, computador: 'C', cancelado_em: '2026-08-05T10:00:00Z', cancelado_por: 2, ultimo_uso_em: '2026-10-01T00:00:00Z' },
    { id: 2, computador: '', criado_em: '2026-10-01T09:00:00Z' },
    { id: 4, computador: 'D', cancelado_em: '2026-08-06T10:00:00Z', cancelado_por: 99 }
  ], new Map([[2, 'Henrique']]));
  assert.deepStrictEqual(lista.map(c => c.id), [2, 1, 3, 4]);
  assert.strictEqual(lista[0].computador, 'Computador sem nome');
  assert.strictEqual(lista[2].cancelado, true);
  assert.strictEqual(lista[2].cancelado_por, 'Henrique');
  assert.strictEqual(lista[3].cancelado_por, '#99', 'quem não está mais na lista aparece pelo número');
  assert.deepStrictEqual(montarComputadores(null), []);
});

test('presença (02/10/2026): o sinal mais novo dos computadores não cancelados; rodando = sinal de até 3 min', () => {
  const { comSinalDoPrograma, SINAL_VALE_MS } = require('./usuariosController');
  const agora = Date.parse('2026-10-02T15:00:00Z');
  const computadores = [
    { usuario_id: 7, ultimo_uso_em: '2026-10-02T14:59:10Z', cancelado_em: null },
    { usuario_id: 7, ultimo_uso_em: '2026-10-02T10:00:00Z', cancelado_em: null },
    { usuario_id: 8, ultimo_uso_em: '2026-10-02T14:50:00Z', cancelado_em: null },
    { usuario_id: 9, ultimo_uso_em: '2026-10-02T14:59:50Z', cancelado_em: '2026-10-02T14:59:55Z' }
  ];
  const r = comSinalDoPrograma([{ id: 7, nome: 'Ana' }, { id: 8 }, { id: 9 }, { id: 10 }], computadores, agora);
  assert.deepStrictEqual(r.map(u => [u.id, u.programa_rodando]), [[7, true], [8, false], [9, false], [10, false]]);
  assert.strictEqual(r[0].ultimo_sinal_em, '2026-10-02T14:59:10.000Z');
  assert.strictEqual(r[0].nome, 'Ana', 'o resto do usuário fica igual');
  assert.strictEqual(r[2].ultimo_sinal_em, null, 'computador cancelado não conta');
  assert.strictEqual(SINAL_VALE_MS, 3 * 60 * 1000);
  assert.deepStrictEqual(comSinalDoPrograma([{ id: 1 }], null, agora)[0].programa_rodando, false, 'sem a tabela: ninguém rodando');
  const rota = require('node:fs').readFileSync(require('node:path').join(__dirname, 'usuariosController.js'), 'utf8');
  assert.ok(rota.includes("const { presenca, ...semPresenca } = req.query || {};"), 'presenca não vira filtro da API');
  assert.ok(rota.includes("res.status(200).json(comSinalDoPrograma(payload, computadores));"));
});

test('GET /:id/computadores: só os do usuário, na ordem da tela; não Sup Admin = 403; sem a tabela = aviso do SQL', async () => {
  const s = await servidor();
  try {
    const r = await s.pedir('GET', '/7/computadores');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo.computadores.map(c => c.computador), ['NOTE-ANA', 'ESCRITORIO-01', 'VELHO']);
    assert.strictEqual(r.corpo.computadores[2].cancelado_por, 'Henrique');
  } finally { await s.fechar(); }

  const outro = await servidor({ supAdmin: false });
  try {
    const r = await outro.pedir('GET', '/7/computadores');
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.corpo.code, 'FORBIDDEN_SUP_ADMIN');
  } finally { await outro.fechar(); }

  const semSql = await servidor({ semTabela: true });
  try {
    const r = await semSql.pedir('GET', '/7/computadores');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo, { computadores: [], sql_pendente: true, mensagem: 'Rode sql/avisos_dispositivos.sql e reinicie a API para ver os computadores.' });
  } finally { await semSql.fechar(); }
});

test('POST cancelar: grava quando e quem; de outro usuário = 404; já cancelado não regrava; não Sup Admin não cancela', async () => {
  const s = await servidor();
  try {
    const r = await s.pedir('POST', '/7/computadores/2/cancelar');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.corpo, { success: true });
    assert.strictEqual(s.api.puts.length, 1);
    const [caminho, corpo] = s.api.puts[0];
    assert.strictEqual(caminho, '/api/avisos_dispositivos/2');
    assert.strictEqual(corpo.cancelado_por, 2, 'quem cancelou: o Sup Admin da sessão');
    assert.ok(!Number.isNaN(Date.parse(corpo.cancelado_em)));

    const outroDono = await s.pedir('POST', '/7/computadores/4/cancelar');
    assert.strictEqual(outroDono.status, 404, 'o computador 4 é de outro usuário');
    const inexistente = await s.pedir('POST', '/7/computadores/99/cancelar');
    assert.strictEqual(inexistente.status, 404);
    const deNovo = await s.pedir('POST', '/7/computadores/3/cancelar');
    assert.deepStrictEqual(deNovo.corpo, { success: true, ja_cancelado: true });
    assert.strictEqual(s.api.puts.length, 1, 'nada regravado');
  } finally { await s.fechar(); }

  const outro = await servidor({ supAdmin: false });
  try {
    const r = await outro.pedir('POST', '/7/computadores/2/cancelar');
    assert.strictEqual(r.status, 403);
    assert.strictEqual(outro.api.puts.length, 0);
  } finally { await outro.fechar(); }

  const semSql = await servidor({ semTabela: true });
  try {
    const r = await semSql.pedir('POST', '/7/computadores/2/cancelar');
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.corpo.sql_pendente, true);
  } finally { await semSql.fechar(); }
});
