const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');

// Contrato da API usada em PROD: filtros por igualdade, sem PostgREST e
// sem rota genérica /usuarios/me. Não substituir módulos por mocks.
test('auditoria funciona com módulos reais e o contrato REST simples da API', async t => {
  const chamadas = [];
  const registros = [];
  let falhaIdentidade = false;
  let falhaHistorico = false;
  const usuario = { id: 7, nome: 'Pessoa', perfil: 'Sup Admin', ultima_alteracao: null };
  const produto = { id: 3, nome: 'Nome anterior', quantidade: 2 };
  const upstream = express();
  upstream.use(express.json());
  upstream.use((req, res, next) => { chamadas.push({ metodo: req.method, caminho: req.path, query: { ...req.query } }); next(); });
  upstream.get('/api/usuarios/:id', (req, res) => {
    if (req.params.id === '8') return res.json({ id: 8, perfil: 'Vendedor Inicial' });
    if (falhaIdentidade) return res.status(500).json({ error: 'Erro no SELECT', detalhe: 'senha=privada token=privado' });
    if (req.params.id !== '7') return res.status(500).json({ error: 'Erro no SELECT', detalhe: 'invalid input syntax for type bigint' });
    res.json(usuario);
  });
  upstream.put('/api/usuarios/7', (req, res) => { Object.assign(usuario, req.body); res.json(usuario); });
  upstream.get('/api/produtos/3', (_req, res) => res.json(produto));
  upstream.put('/api/produtos/3', (req, res) => { Object.assign(produto, req.body); res.json(produto); });
  upstream.post('/api/usuarios_auditoria', (req, res) => {
    const row = { ...req.body, id: registros.length + 1, criado_em: '2026-10-15T19:30:00Z' };
    registros.push(row);
    res.json(row);
  });
  upstream.get('/api/usuarios_auditoria', (req, res) => {
    if (falhaHistorico) return res.status(500).json({ error: 'Erro no SELECT', detalhe: 'senha=privada token=privado' });
    if (Object.keys(req.query).some(k => ['order', 'limit', 'offset', 'id'].includes(k))) {
      return res.status(500).json({ error: 'Erro no SELECT', detalhe: 'filtro incompatível com a API REST simples' });
    }
    res.json(registros.filter(r => Object.entries(req.query).every(([k, v]) => String(r[k]) === String(v))));
  });
  const apiServer = await new Promise(resolve => { const s = upstream.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => apiServer.close(resolve)));
  const token = `teste.${Buffer.from(JSON.stringify({ id: 7 })).toString('base64url')}.teste`;
  process.env.API_BASE_URL = `http://127.0.0.1:${apiServer.address().port}`;
  process.env.BANCO = 'PROD';
  process.env.API_BEARER_TOKEN = token;
  // Ordem real do app: backend/db antes de API e da primeira escrita auditada.
  require('./backend');
  const db = require('./db');
  const { createApiClient } = require('./apiHttpClient');
  const captura = require('./auditoriaCaptura');
  const servidorReal = require('./server');
  const localServer = await new Promise(resolve => { const s = servidorReal.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => localServer.close(resolve)));
  const localBase = `http://127.0.0.1:${localServer.address().port}`;

  await t.test('GET real de auditoria lê histórico vazio sem operadores não suportados', async () => {
    const res = await fetch(`${localBase}/api/auditoria-usuarios?usuario_id=7&pagina=1&limite=25`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal((await res.json()).total, 0);
    const tokenComum = `teste.${Buffer.from(JSON.stringify({ id: 8 })).toString('base64url')}.teste`;
    const negado = await fetch(`${localBase}/api/auditoria-usuarios?usuario_id=7`, { headers: { Authorization: `Bearer ${tokenComum}` } });
    assert.equal(negado.status, 403);
    assert.equal((await negado.json()).code, 'FORBIDDEN_SUP_ADMIN');
  });

  await t.test('HTTP manual confirma o ator por ID e persiste antes/depois e última alteração', async () => {
    const app = express();
    app.use(express.json(), captura.middleware);
    app.put('/api/produtos/3', async (req, res) => res.status(202).json(await createApiClient(req).put('/api/produtos/3', { nome: req.body.nome })));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/produtos/3`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'X-Auditoria-Origem': 'manual', 'X-Auditoria-Acao': randomUUID() },
      body: JSON.stringify({ nome: 'Novo nome', usuario_id: 999 })
    });
    assert.equal(res.status, 202);
    assert.equal(res.headers.get('X-Auditoria-Status'), 'ok');
    assert.equal(registros.length, 2);
    assert.ok(registros.every(r => r.usuario_id === 7));
    assert.deepEqual(JSON.parse(registros[0].mudancas), [{ campo: 'nome', antes: 'Nome anterior', depois: 'Novo nome' }]);
    assert.match(usuario.especificacao_ultima_alteracao, /Nome anterior.*Novo nome/);
    assert.ok(!chamadas.some(c => c.caminho.endsWith('/usuarios/me')));
  });

  await t.test('IPC real e escrita de sistema pelo db não recursam nem se confundem com mudança manual', async () => {
    const ultimas = [];
    await captura.executarIpc({ usuarioId: 7, canal: 'atualizar-produto', payload: { id: 3, dados: { quantidade: 4 } },
      contexto: { origem: 'manual', acao_id: randomUUID() } },
    () => createApiClient({ headers: { authorization: `Bearer ${token}` } }).put('/api/produtos/3', { quantidade: 4 }),
    { criarApi: () => createApiClient({ headers: { authorization: `Bearer ${token}` } }), onManualChange: acao => ultimas.push(acao) });
    assert.equal(ultimas.length, 1);
    assert.match(ultimas[0].descricao, /Quantidade: 2 → 4/);
    const antes = usuario.especificacao_ultima_alteracao;
    await db.runWithToken(token, () => db.put('/produtos/3', { quantidade: 5 }));
    assert.equal(registros.at(-1).origem, 'sistema');
    assert.equal(registros.at(-1).usuario_id, null);
    assert.equal(usuario.especificacao_ultima_alteracao, antes);
    const res = await fetch(`${localBase}/api/auditoria-usuarios?usuario_id=7&pagina=1&limite=25`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const saida = await res.json();
    assert.equal(saida.total, 4);
    assert.equal(saida.completo, true);
    assert.ok(saida.registros.some(r => r.origem === 'manual' && r.mudancas.some(m => m.campo === 'quantidade' && m.antes === 2 && m.depois === 4)));
  });

  await t.test('diagnóstico de falhas reais expõe só fase/status/código e preserva negócio', async () => {
    const avisos = [];
    const warn = console.warn;
    console.warn = (...args) => avisos.push(args.join(' '));
    try {
      falhaHistorico = true;
      const res = await fetch(`${localBase}/api/auditoria-usuarios?usuario_id=7`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 500);
      const erro = await res.json();
      assert.deepEqual(erro.diagnostico, { fase: 'consultar-historico', code: 'SEM_CODIGO', status_http: 500 });
      assert.doesNotMatch(JSON.stringify(erro), /senha=|token=/);
      falhaHistorico = false;
      falhaIdentidade = true;
      const pendentes = [];
      const req = { method: 'PUT', headers: { authorization: `Bearer ${token}` } };
      const resultado = await captura.executarIpc({ canal: 'atualizar-produto', payload: { id: 3, nome: 'Negócio preservado' }, req,
        contexto: { origem: 'manual', acao_id: randomUUID() } },
      () => createApiClient(req).put('/api/produtos/3', { nome: 'Negócio preservado' }),
      { criarApi: () => createApiClient(req), onAuditFailure: r => pendentes.push(r) });
      assert.equal(resultado.nome, 'Negócio preservado');
      assert.deepEqual(pendentes[0].diagnosticos, [{ fase: 'identificar-usuario', code: 'SEM_CODIGO', status_http: 500 }]);
      assert.doesNotMatch(avisos.join(' '), /senha=|token=|Bearer|teste\./);
    } finally { falhaHistorico = false; falhaIdentidade = false; console.warn = warn; }
  });
});
