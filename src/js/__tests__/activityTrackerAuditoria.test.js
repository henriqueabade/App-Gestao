const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const fonte = fs.readFileSync(path.join(__dirname, '../../utils/activityTracker.js'), 'utf8');

function montar({ rejeitar = false } = {}) {
  const chamadas = [];
  const registros = [];
  const ipcs = [];
  let provider;
  class Evento {
    constructor(type = 'click', isTrusted = true, id = 'salvarPedido') {
      this.type = type;
      this.isTrusted = isTrusted;
      this.target = { id, dataset: { perm: 'ped.edit' } };
    }
  }
  const window = {
    Event: Evento, Request, crypto: webcrypto,
    location: { href: 'https://app.test/menu.html', pathname: '/menu.html' },
    electronAPI: {
      registrarContextoAuditoria: fn => { provider = fn; },
      recordActivity: payload => registros.push(payload),
      comAuditoria: contexto => ({ atualizarProduto: (...args) => { ipcs.push({ contexto, args }); return Promise.resolve('ok'); } })
    },
    fetch: (input, init) => {
      chamadas.push({ input, init });
      return rejeitar ? Promise.reject(new Error('falhou')) : Promise.resolve({ ok: true });
    }
  };
  vm.runInNewContext(fonte, { window, document: { getElementById: () => ({ dataset: { page: 'pedidos' } }) },
    URL, Headers, Uint8Array });
  return { window, Evento, chamadas, registros, ipcs, provider: () => provider() };
}

test('fetch transmite apenas cabeçalhos de contexto; o backend registra a mudança uma vez', async () => {
  const m = montar();
  const body = JSON.stringify({ senha: 'segredo-nao-registrar', nome: 'teste' });
  await m.window.fetch('/api/usuarios/1', { method: 'PUT', body, headers: { authorization: 'Bearer segredo' } });
  assert.equal(m.chamadas[0].init.body, body, 'o corpo necessário à operação continua intacto');
  const h = m.chamadas[0].init.headers;
  assert.equal(h.get('authorization'), 'Bearer segredo');
  assert.equal(h.get('X-Auditoria-Origem'), 'nao_confirmada');
  assert.ok(h.get('X-Auditoria-Acao'));
  assert.doesNotMatch(h.get('X-Auditoria-Contexto'), /segredo|senha|Bearer/);
  assert.equal(m.registros.length, 0, 'fetch não dispara recordActivity duplicado');
});

test('somente eventos DOM confiáveis geram tokens; não há janela temporal de último clique', async () => {
  const m = montar();
  const a = m.window.AuditoriaAcao;
  assert.equal(a.capturar(new m.Evento('click', false)), null);
  assert.equal(a.capturar({ type: 'click', isTrusted: true }), null);
  assert.equal(a.capturar(new m.Evento('mousemove')), null);
  const evento = new m.Evento();
  m.window.event = evento;
  await m.window.fetch('/api/pedidos/1', { method: 'PUT' });
  const id = m.chamadas[0].init.headers.get('X-Auditoria-Acao');
  assert.equal(id, a.capturar(evento).acao_id, 'o mesmo gesto reutiliza o identificador');
  assert.equal(m.provider().origem, 'manual');
  m.window.event = undefined;
  await m.window.fetch('/api/avisos/1', { method: 'PUT' });
  assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
});

test('token explícito preserva a ação após await e isola operações concorrentes', async () => {
  const m = montar();
  const a = m.window.AuditoriaAcao;
  const primeira = a.vincular(new m.Evento('click', true, 'salvar1'));
  const segunda = a.vincular(new m.Evento('submit', true, 'salvar2'));
  await Promise.resolve();
  await Promise.all([
    primeira.fetch('/api/pedidos/1', { method: 'PUT' }),
    segunda.fetch('/api/pedidos/2', { method: 'PUT' }),
    a.automatico(() => m.window.fetch('/api/avisos/1', { method: 'PUT' })),
    m.window.fetch('/api/avisos/2', { method: 'PUT' })
  ]);
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Acao'), primeira.contexto.acao_id);
  assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Acao'), segunda.contexto.acao_id);
  assert.notEqual(primeira.contexto.acao_id, segunda.contexto.acao_id);
  assert.equal(m.chamadas[2].init.headers.get('X-Auditoria-Origem'), 'automatico');
  assert.equal(m.chamadas[3].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
});

test('executar não mantém escopo global enquanto a promise aguarda', async () => {
  const m = montar();
  const a = m.window.AuditoriaAcao;
  await a.executar(new m.Evento(), async () => {
    await Promise.resolve();
    await m.window.fetch('/api/avisos', { method: 'POST' });
  });
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
});

test('vincular sem argumento herda o escopo explícito manual ou automático após await', async () => {
  const m = montar();
  const a = m.window.AuditoriaAcao;
  const evento = new m.Evento();
  const manual = a.executar(evento, () => a.vincular());
  const automatica = a.automatico(() => a.vincular());
  await Promise.resolve();
  await manual.fetch('/api/pedidos/1', { method: 'PUT' });
  await automatica.fetch('/api/avisos/1', { method: 'PUT' });
  await automatica.ipc('atualizarProduto', 9, { quantidade: 1 });
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Acao'), a.capturar(evento).acao_id);
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'manual');
  assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Origem'), 'automatico');
  assert.equal(m.chamadas[1].init.headers.get('X-Auditoria-Acao'), automatica.contexto.acao_id);
  assert.equal(m.ipcs[0].contexto.origem, 'automatico');
  assert.equal(m.ipcs[0].contexto.acao_id, automatica.contexto.acao_id);
});

test('contexto automático só pode ser vinculado se o tracker criou o token', async () => {
  const m = montar();
  const a = m.window.AuditoriaAcao;
  const falso = a.vincular({ origem: 'automatico', acao_id: 'forjado' });
  await falso.fetch('/api/avisos/1', { method: 'PUT' });
  assert.equal(m.chamadas[0].init.headers.get('X-Auditoria-Origem'), 'nao_confirmada');
  assert.notEqual(m.chamadas[0].init.headers.get('X-Auditoria-Acao'), 'forjado');
});

test('Request preserva cabeçalhos e um erro de rede não vira atividade persistida', async () => {
  const m = montar({ rejeitar: true });
  const request = new Request('https://app.test/api/pedidos/1', { method: 'DELETE', headers: { 'X-Teste': 'sim' } });
  await assert.rejects(m.window.fetch(request), /falhou/);
  assert.equal(m.chamadas[0].input, request);
  assert.equal(m.chamadas[0].init.headers.get('X-Teste'), 'sim');
  assert.equal(m.registros.length, 0);
});

test('IPC bound mantém token e oferece somente métodos autorizados', async () => {
  const m = montar();
  const acao = m.window.AuditoriaAcao.vincular(new m.Evento());
  await Promise.resolve();
  await acao.ipc('atualizarProduto', 3, { nome: 'Caixa' });
  assert.equal(m.ipcs[0].contexto.acao_id, acao.contexto.acao_id);
  assert.equal(m.ipcs[0].contexto.origem, 'manual');
  assert.throws(() => acao.ipc('invoke', 'canal-arbitrario'), /não disponível/);
});

test('arquivos e destinos fora de /api não recebem o contexto da aplicação', async () => {
  const m = montar();
  const init = { method: 'GET' };
  await m.window.fetch('../html/modals/teste.html', init);
  assert.equal(m.chamadas[0].init, init);
});
