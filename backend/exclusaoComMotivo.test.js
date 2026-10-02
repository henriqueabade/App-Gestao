/**
 * Excluir cliente e pedido pede o motivo (decisão do dono, 02/10/2026): sem
 * ele, a rota recusa ANTES de apagar qualquer coisa; com ele, o motivo vai no
 * aviso de quem tinha a ficha. (Prospecção e orçamento: nas baterias deles.)
 */
process.env.NODE_ENV = 'test';
process.env.BANCO = 'DEV';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

function trocar(caminho, exportsFalsos) {
  const id = require.resolve(caminho);
  const antes = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsFalsos };
  return () => { if (antes) require.cache[id] = antes; else delete require.cache[id]; };
}

/** Uma API genérica de mentira que anota o que foi apagado e os avisos. */
function apiFalsa() {
  const apagados = [];
  const avisos = [];
  const fichas = {
    '/api/clientes/3': { id: 3, nome_fantasia: 'ACME', dono_cliente: 'Ana Paula', criado_por: 1 },
    '/api/pedidos/9': { id: 9, numero: 'PED-9', dono: 'Ana Paula', cliente_id: 3 }
  };
  return {
    apagados, avisos,
    async get(caminho) {
      if (caminho === '/api/usuarios') return [{ id: 1, nome: 'Henrique' }, { id: 2, nome: 'Ana Paula' }];
      return fichas[caminho] ? { ...fichas[caminho] } : [];
    },
    async post(caminho, corpo) { if (caminho === '/api/notificacoes') avisos.push(corpo); return { id: avisos.length }; },
    async put() { return {}; },
    async delete(caminho) { apagados.push(caminho); return {}; }
  };
}

async function servidor() {
  const api = apiFalsa();
  const cascata = [];
  const passa = (_req, _res, next) => next();
  const desfazer = [
    trocar('./apiHttpClient', { ...require('./apiHttpClient'), createApiClient: () => api }),
    trocar('./permissionsController', {
      exigirPermissao: () => passa, exigirSupAdmin: passa, ehSupAdmin: async () => true, limparCachePermissoes: () => {}
    }),
    trocar('./exclusaoEmCascata', {
      ...require('./exclusaoEmCascata'),
      excluirPedidoEmCascata: async (_api, id) => { cascata.push(Number(id)); return { removidos: ['pedidos'], avisos: [] }; }
    })
  ];
  for (const c of ['./clientesController', './pedidosController']) delete require.cache[require.resolve(c)];
  const app = express();
  app.use(express.json());
  app.use('/api/clientes', require('./clientesController'));
  app.use('/api/pedidos', require('./pedidosController'));
  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // O token do Henrique (id 1): quem exclui não recebe o próprio aviso.
  const token = `x.${Buffer.from(JSON.stringify({ id: 1 })).toString('base64')}.y`;
  const excluir = async (caminho, corpo) => {
    const r = await fetch(`${base}${caminho}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    return { status: r.status, corpo: await r.json() };
  };
  return {
    api, cascata, excluir,
    fechar: async () => {
      await new Promise(r => srv.close(r));
      desfazer.forEach(d => d());
      for (const c of ['./clientesController', './pedidosController']) delete require.cache[require.resolve(c)];
    }
  };
}

test('cliente: sem motivo é recusado e nada é apagado; com motivo, o dono recebe o aviso com ele', async () => {
  const s = await servidor();
  try {
    for (const corpo of [undefined, {}, { motivo: '   ' }]) {
      const r = await s.excluir('/api/clientes/3', corpo);
      assert.strictEqual(r.status, 400);
      assert.deepStrictEqual(r.corpo, { error: 'Escreva o motivo da exclusão.', motivo_obrigatorio: true });
    }
    assert.deepStrictEqual(s.api.apagados, [], 'nada apagado sem o motivo');

    const ok = await s.excluir('/api/clientes/3', { motivo: '  Cadastro   em dobro  ' });
    assert.strictEqual(ok.status, 200);
    assert.ok(s.api.apagados.includes('/api/clientes/3'));
    assert.strictEqual(s.api.avisos.length, 1, 'só a Ana (o Henrique excluiu)');
    assert.strictEqual(s.api.avisos[0].usuario_id, 2);
    assert.match(s.api.avisos[0].mensagem, /\n» Motivo: Cadastro em dobro$/);
  } finally {
    await s.fechar();
  }
});

test('pedido: sem motivo é recusado antes da cascata; com motivo, o dono recebe o aviso com ele', async () => {
  const s = await servidor();
  try {
    const r = await s.excluir('/api/pedidos/9', { motivo: '' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.corpo.error, 'Escreva o motivo da exclusão.');
    assert.deepStrictEqual(s.cascata, [], 'a cascata nem começou');

    const ok = await s.excluir('/api/pedidos/9', { motivo: 'Pedido lançado no cliente errado' });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(s.cascata, [9]);
    const daAna = s.api.avisos.filter(a => a.usuario_id === 2);
    assert.strictEqual(daAna.length, 1);
    assert.match(daAna[0].mensagem, /» Motivo: Pedido lançado no cliente errado/);
  } finally {
    await s.fechar();
  }
});

test('motivoDaExclusao: espaços somem, até 600 letras, vazio = null', () => {
  const { motivoDaExclusao } = require('./avisosEnvolvidos');
  assert.strictEqual(motivoDaExclusao({ motivo: '  a \n b ' }), 'a b');
  assert.strictEqual(motivoDaExclusao({ motivo: 'x'.repeat(900) }).length, 600);
  for (const corpo of [undefined, null, {}, { motivo: '' }, { motivo: '  ' }]) assert.strictEqual(motivoDaExclusao(corpo), null);
});
