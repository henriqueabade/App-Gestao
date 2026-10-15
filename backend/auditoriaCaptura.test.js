const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const captura = require('./auditoriaCaptura');

function fixture() {
  const eventos = [];
  const leituras = [];
  const alteracoes = [];
  const linhas = { produtos: [{ id: 3, nome: 'Caixa', quantidade: 2, preco_venda: 100, token: 'privado' }],
    usuarios: [{ id: 7, nome: 'Pessoa', senha: 'hash-privado' }] };
  let falharAuditoria = false;
  let falharNegocio = false;
  const partes = p => p.replace(/^\/api\//, '/').split('/').filter(Boolean);
  const raw = {
    async get(path) {
      leituras.push(path);
      if (path === '/api/usuarios/me') return { id: 7 };
      const [tabela, id] = partes(path);
      return structuredClone((linhas[tabela] || []).find(r => String(r.id) === id) || null);
    },
    async put(path, body) {
      alteracoes.push({ path, body: structuredClone(body) });
      if (falharNegocio && partes(path)[0] !== 'usuarios') throw Object.assign(new Error('segredo não deve sair no log'), { code: 'NEGOCIO_FALHOU' });
      const [tabela, id] = partes(path);
      const linha = (linhas[tabela] || []).find(r => String(r.id) === id);
      if (linha) Object.assign(linha, body);
      return structuredClone(linha || { success: true });
    },
    async patch(...args) { return raw.put(...args); },
    async post(path, body) {
      if (partes(path)[0] === 'usuarios_auditoria') {
        if (falharAuditoria) throw Object.assign(new Error('relation "usuarios_auditoria" does not exist'), { code: '42P01' });
        const e = { ...body, id: eventos.length + 1, criado_em: '2026-10-15T15:01:02.000Z' };
        eventos.push(e);
        return e;
      }
      const [tabela] = partes(path);
      const linha = { id: 4, ...body };
      (linhas[tabela] ||= []).push(linha);
      return structuredClone(linha);
    },
    async delete(path) {
      const [tabela, id] = partes(path);
      const i = (linhas[tabela] || []).findIndex(r => String(r.id) === id);
      return i < 0 ? null : linhas[tabela].splice(i, 1)[0];
    }
  };
  const api = captura.comAuditoria(raw);
  const ultimas = [];
  const falhas = [];
  return { raw, api, eventos, leituras, linhas, alteracoes, ultimas, falhas,
    falharAuditoria: () => { falharAuditoria = true; }, falharNegocio: () => { falharNegocio = true; },
    executar: (fn, { origem = 'manual', payload = { id: 3, nome: 'Nova caixa' }, contexto = {}, canal = 'atualizar-produto', usuarioId = 7, metodo } = {}) =>
      captura.executarIpc({ usuarioId, canal, metodo, payload, contexto: { origem, acao_id: randomUUID(), tela: 'produtos', ...contexto } }, fn,
        { criarApi: () => api, onManualChange: acao => ultimas.push(acao), onAuditFailure: e => falhas.push(e) }) };
}
const mudancas = e => JSON.parse(e.mudancas);

test('manual grava raiz e cada efeito automático, mas a última alteração só descreve campos pedidos', async () => {
  const t = fixture();
  const resposta = { success: true, valor: 42 };
  const r = await t.executar(async () => {
    await t.api.put('/api/produtos/3', { nome: 'Nova caixa' });
    await t.api.put('/api/produtos/3', { preco_venda: 110 });
    return resposta;
  });
  assert.equal(r, resposta);
  assert.deepEqual(t.eventos.map(e => e.origem), ['manual', 'automatico', 'automatico']);
  assert.deepEqual(mudancas(t.eventos[0]).filter(m => m.campo !== 'id'), [{ campo: 'nome', antes: 'Caixa', depois: 'Nova caixa' }]);
  assert.equal(new Set(t.eventos.map(e => e.acao_id)).size, 1);
  assert.ok(t.eventos.every(e => e.usuario_id === 7));
  assert.equal(t.ultimas.length, 1);
  assert.equal(t.ultimas[0].timestamp, '2026-10-15T15:01:02.000Z');
  assert.equal(t.ultimas[0].modulo, 'produtos');
  assert.match(t.ultimas[0].descricao, /Nome: Caixa → Nova caixa/);
  assert.doesNotMatch(t.ultimas[0].descricao, /Preço de venda|110/);
  assert.equal(t.alteracoes.filter(a => a.path === '/api/usuarios/7').length, 1, 'metadata não cria recursão');
  assert.doesNotMatch(JSON.stringify(t.eventos), /privado|preco_venda.*manual/);
});

test('automático e não confirmado preservam histórico sem atualizar a última alteração manual', async () => {
  for (const origem of ['automatico', 'nao_confirmada']) {
    const t = fixture();
    await t.executar(() => t.api.put('/api/produtos/3', { nome: 'Nova caixa' }), { origem });
    assert.ok(t.eventos.every(e => e.origem === origem));
    assert.equal(t.ultimas.length, 0);
    assert.equal(t.alteracoes.filter(a => a.path === '/api/usuarios/7').length, 0);
  }
});

test('origem manual sem id de ação válido é classificada como não confirmada', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/api/produtos/3', { nome: 'Nova caixa' }), { contexto: { acao_id: 'inventado' } });
  assert.ok(t.eventos.every(e => e.origem === 'nao_confirmada'));
  assert.equal(t.ultimas.length, 0);
});

test('contexto IPC legado null não quebra operação nem inventa origem manual', async () => {
  const t = fixture();
  const r = await captura.executarIpc({ usuarioId: 7, canal: 'atualizarProduto', payload: { id: 3, dados: { nome: 'Novo' } }, contexto: null },
    () => t.api.put('/produtos/3', { nome: 'Novo' }), { criarApi: () => t.raw });
  assert.equal(r.nome, 'Novo');
  assert.ok(t.eventos.length && t.eventos.every(e => e.origem === 'nao_confirmada'));
});

test('alvo DOM e página menu não substituem entidade real nem módulo do canal IPC', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/produtos/3', { nome: 'Novo' }), { canal: 'atualizarProduto',
    payload: { id: 3, dados: { nome: 'Novo' } }, contexto: { tela: '/src/html/menu.html', alvo_id: 'salvarProduto' } });
  assert.equal(t.eventos[0].entidade_id, '3');
  assert.equal(t.eventos[0].modulo, 'produtos');
  assert.equal(t.ultimas.length, 1);
  assert.equal(JSON.parse(t.eventos[0].contexto).alvo_id, 'salvarProduto');
});

test('exclusão manual sem corpo registra alteração efetiva', async () => {
  const t = fixture();
  await t.executar(() => t.api.delete('/produtos/3'), { canal: 'excluirProduto', payload: 3 });
  assert.equal(t.linhas.produtos.length, 0);
  assert.equal(t.ultimas.length, 1);
  assert.equal(t.eventos[0].acao, 'excluir');
});

test('consulta manual pode constar no histórico sem alterar metadata; leituras de abertura não viram eventos', async () => {
  const t = fixture();
  await t.executar(() => t.api.get('/api/produtos/3'), { canal: 'listar-produtos', payload: {}, metodo: 'GET' });
  assert.equal(t.eventos.length, 1);
  assert.equal(t.eventos[0].acao, 'consultar');
  assert.equal(t.ultimas.length, 0);
  const outro = fixture();
  await outro.executar(() => outro.api.get('/api/produtos/3'), { origem: 'automatico', canal: 'listar-produtos', payload: {}, metodo: 'GET' });
  assert.equal(outro.eventos.length, 0);
});

test('API isolada sem contexto não inicia auditoria; db timer explícito é sistema sem ator', async () => {
  const t = fixture();
  await t.api.put('/api/produtos/3', { quantidade: 3 });
  assert.equal(t.eventos.length, 0);
  assert.equal(t.leituras.length, 0);
  const db = captura.comAuditoria(t.raw, { sistema: true });
  await db.put('/produtos/3', { quantidade: 4 });
  assert.equal(t.eventos.length, 1);
  assert.equal(t.eventos[0].origem, 'sistema');
  assert.equal(t.eventos[0].usuario_id, null);
});

test('contextos IPC concorrentes não trocam usuários, origens ou ações', async () => {
  const t = fixture();
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const um = t.executar(async () => { await espera; return t.api.put('/produtos/3', { nome: 'Pessoa 7' }); }, { usuarioId: 7, payload: { nome: 'Pessoa 7' } });
  const dois = t.executar(() => t.api.put('/produtos/3', { quantidade: 8 }), { usuarioId: 8, origem: 'automatico', payload: { quantidade: 8 } });
  await dois;
  liberar();
  await um;
  const de8 = t.eventos.filter(e => e.usuario_id === 8);
  const de7 = t.eventos.filter(e => e.usuario_id === 7);
  assert.ok(de8.length && de8.every(e => e.origem === 'automatico'));
  assert.ok(de7.some(e => e.origem === 'manual'));
  assert.notEqual(de7[0].acao_id, de8[0].acao_id);
});

test('timer concorrente fora do contexto não herda usuário nem gesto do IPC pendente', async () => {
  const t = fixture();
  let liberar;
  const espera = new Promise(resolve => { liberar = resolve; });
  const manual = t.executar(async () => { await espera; return t.api.put('/produtos/3', { nome: 'Manual' }); }, { payload: { nome: 'Manual' } });
  await captura.comAuditoria(t.raw, { sistema: true }).put('/produtos/3', { quantidade: 9 });
  liberar();
  await manual;
  assert.equal(t.eventos[0].origem, 'sistema');
  assert.equal(t.eventos[0].usuario_id, null);
  assert.ok(t.eventos.slice(1).every(e => e.usuario_id === 7));
  assert.notEqual(t.eventos[0].acao_id, t.eventos[1].acao_id);
});

test('edição sem mudança real e recálculo de outro campo não atualizam última alteração', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/produtos/3', { nome: 'Caixa' }), { payload: { nome: 'Caixa' } });
  assert.equal(t.ultimas.length, 0);
  const calculo = fixture();
  await calculo.executar(() => calculo.api.put('/produtos/3', { preco_venda: 120 }), { payload: { quantidade: 2 } });
  assert.equal(calculo.ultimas.length, 0);
});

test('mudança compara somente campos enviados e nunca valores gerados no retorno', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/produtos/3', { quantidade: 3 }), { payload: { quantidade: 3 } });
  const efeito = t.eventos.find(e => e.origem === 'automatico');
  assert.deepEqual(mudancas(efeito), [{ campo: 'quantidade', antes: 2, depois: 3 }]);
  assert.doesNotMatch(JSON.stringify(t.eventos), /privado/);
});

test('campos só de atividade e endpoints sensíveis não são pré-lidos nem geram eventos', async () => {
  const t = fixture();
  await t.executar(async () => {
    await t.api.put('/usuarios/7', { ultima_atividade: '2026-10-15T10:00:00Z' });
    await t.api.put('/fiscal/certificado', { certificado: 'base64-privado', senha: 'segredo' });
  }, { origem: 'automatico', payload: {} });
  assert.equal(t.eventos.length, 0);
  assert.equal(t.leituras.length, 0);
});

test('senha alterada fica registrada sem hashes, tokens ou valor anterior/novo', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/usuarios/7', { senha: 'novo-hash-privado' }), {
    canal: 'alterar-senha-usuario', payload: { senha: 'novo-hash-privado' }, contexto: { tela: 'usuarios', alvo_id: 7 } });
  assert.equal(t.eventos.length, 1);
  assert.equal(t.eventos[0].acao, 'alterar-senha');
  assert.deepEqual(mudancas(t.eventos[0]), []);
  assert.doesNotMatch(JSON.stringify(t.eventos), /hash-privado|novo-hash|token/);
});

test('fetch autenticado de avatar confirmado pelo backend gera evento sem conteúdo da imagem', async () => {
  const t = fixture();
  await t.executar(() => {
    // O chamador real confirma isto somente após o fetch autenticado retornar sucesso.
    assert.equal(captura.confirmarMudancaProtegida('alterar-avatar'), true);
    return { success: true };
  }, { canal: 'perfil:enviar-imagem', payload: { imagem: 'data:image/png;base64,SEGREDO' },
    contexto: { tela: '/src/html/menu.html', alvo_id: 'botaoFoto' } });
  assert.equal(t.eventos.length, 1);
  assert.equal(t.eventos[0].acao, 'alterar-avatar');
  assert.equal(t.ultimas.length, 1);
  assert.deepEqual(mudancas(t.eventos[0]), []);
  assert.doesNotMatch(JSON.stringify(t.eventos), /SEGREDO|data:image/);
  assert.equal(captura.confirmarMudancaProtegida(), false, 'fora do escopo não se inventa autoria');
});

test('falha de negócio preserva erro original e resultado falha, sem metadata manual', async () => {
  const t = fixture();
  t.falharNegocio();
  await assert.rejects(t.executar(() => t.api.put('/produtos/3', { nome: 'Nova caixa' })), e => e.code === 'NEGOCIO_FALHOU');
  assert.ok(t.eventos.length && t.eventos.every(e => e.resultado === 'falha'));
  assert.equal(t.ultimas.length, 0);
});

test('erro de efeito engolido pelo controller deixa raiz falha, preservando resposta negócio', async () => {
  const t = fixture();
  t.falharNegocio();
  const r = await t.executar(async () => { try { await t.api.put('/produtos/3', { nome: 'Nova caixa' }); } catch (_) {} return { success: true, avisos: ['conferir'] }; });
  assert.equal(r.success, true);
  assert.equal(t.eventos[0].resultado, 'falha');
  assert.equal(t.ultimas.length, 0);
});

test('falha auditoria não desfaz negócio nem altera retorno, mas é comunicada por código', async () => {
  const t = fixture();
  t.falharAuditoria();
  const resposta = { success: true };
  assert.equal(await t.executar(async () => { await t.api.put('/produtos/3', { nome: 'Nova caixa' }); return resposta; }), resposta);
  assert.equal(t.linhas.produtos[0].nome, 'Nova caixa');
  assert.equal(t.falhas[0].status, 'pendente');
  assert.equal(t.falhas[0].code, 'AUDITORIA_USUARIOS_SQL');
  assert.equal(t.ultimas.length, 0);
});

test('wrap e supressão são idempotentes e evitam reauditar auditoria/metadata', async () => {
  const t = fixture();
  assert.equal(captura.comAuditoria(t.api), t.api);
  await t.executar(() => captura.semAuditoria(() => t.api.put('/produtos/3', { nome: 'Sem captura' })), { payload: {}, origem: 'automatico' });
  assert.equal(t.eventos.length, 0);
});

test('limite de efeitos por ação informa persistência incompleta sem coalescer silenciosamente', async () => {
  const t = fixture();
  await t.executar(async () => {
    for (let i = 0; i <= captura.MAX_EVENTOS; i += 1) await t.api.put('/produtos/3', { quantidade: i + 10 });
  }, { origem: 'automatico', payload: {} });
  assert.equal(t.eventos.filter(e => e.entidade === 'produtos').length, captura.MAX_EVENTOS + 1, 'raiz e primeiros efeitos têm linhas próprias');
  assert.equal(t.falhas.length, 1);
  assert.equal(t.falhas[0].code, 'AUDITORIA_LIMITE_EVENTOS');
  assert.equal(t.linhas.produtos[0].quantidade, captura.MAX_EVENTOS + 10, 'a operação de negócio termina normalmente');
});

test('middleware HTTP identifica ator da sessão, ignora body.usuario_id e preserva status da resposta', async t => {
  const f = fixture();
  const moduloApi = require('./apiHttpClient');
  const original = moduloApi.createApiClientSemAuditoria;
  moduloApi.createApiClientSemAuditoria = () => f.raw;
  t.after(() => { moduloApi.createApiClientSemAuditoria = original; });
  const app = express();
  app.use(express.json(), captura.middleware);
  app.put('/api/produtos/3', async (req, res) => { await f.api.put('/produtos/3', { nome: req.body.nome }); res.status(202).json({ success: true }); });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const contexto = { origem: 'manual', acao_id: randomUUID(), tela: '/src/html/menu.html', evento: 'salvar', alvo_id: 'salvarProduto' };
  const token = `teste.${Buffer.from(JSON.stringify({ id: 7 })).toString('base64url')}.teste`;
  const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/produtos/3`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Auditoria-Origem': 'manual', 'X-Auditoria-Acao': contexto.acao_id,
      'X-Auditoria-Contexto': encodeURIComponent(JSON.stringify(contexto)) }, body: JSON.stringify({ nome: 'Nome HTTP', usuario_id: 999 }) });
  assert.equal(resposta.status, 202);
  assert.equal(resposta.headers.get('X-Auditoria-Status'), 'ok');
  assert.ok(f.eventos.every(e => e.usuario_id === 7));
  assert.equal(f.leituras.filter(p => p === '/api/usuarios/7').length, 1);
  assert.equal(f.eventos[0].origem, 'manual');
  assert.equal(f.eventos[0].modulo, 'produtos');
  assert.equal(f.eventos[0].entidade_id, '3');
  assert.equal(f.alteracoes.filter(a => a.path === '/api/usuarios/7').length, 1);
  assert.ok(f.eventos.some(e => e.origem === 'automatico'));
  f.falharAuditoria();
  const pendente = await fetch(`http://127.0.0.1:${server.address().port}/api/produtos/3`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Auditoria-Origem': 'manual', 'X-Auditoria-Acao': randomUUID() },
    body: JSON.stringify({ nome: 'Gravado com auditoria pendente' }) });
  assert.equal(pendente.status, 202);
  assert.equal(pendente.headers.get('X-Auditoria-Status'), 'pendente');
  assert.equal(f.linhas.produtos[0].nome, 'Gravado com auditoria pendente');
});

test('última alteração não regride quando uma ação antiga termina depois da nova', async () => {
  const t = fixture();
  let liberarAntiga;
  const espera = new Promise(resolve => { liberarAntiga = resolve; });
  let raizAntiga;
  const chegouAntiga = new Promise(resolve => { raizAntiga = resolve; });
  const post = t.raw.post;
  t.raw.post = async (path, body) => {
    const r = await post(path, body);
    if (body.origem === 'manual') r.criado_em = body.acao_id === idAntigo ? '2099-01-01T15:00:00Z' : '2099-01-01T15:01:00Z';
    if (body.acao_id === idAntigo && body.origem === 'automatico') { raizAntiga(); await espera; }
    return r;
  };
  const idAntigo = randomUUID();
  const antiga = t.executar(() => t.api.put('/produtos/3', { nome: 'Nome antigo' }), {
    usuarioId: 98765, payload: { id: 3, nome: 'Nome antigo' }, contexto: { acao_id: idAntigo }
  });
  await chegouAntiga;
  await t.executar(() => t.api.put('/produtos/3', { nome: 'Nome novo' }), {
    usuarioId: 98765, payload: { id: 3, nome: 'Nome novo' }
  });
  liberarAntiga();
  await antiga;
  assert.equal(t.ultimas.length, 1);
  assert.equal(t.ultimas[0].timestamp, '2099-01-01T15:01:00Z');
  assert.match(t.ultimas[0].descricao, /Nome novo/);
});

test('conteúdo omitido registra a operação sem copiar valores nem inventar mudança manual', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/produtos/3', { observacoes: 'texto privado' }), { payload: {} });
  assert.ok(t.eventos.some(e => e.entidade === 'produtos' && e.resultado === 'sucesso'));
  assert.doesNotMatch(JSON.stringify(t.eventos), /texto privado/);
  assert.equal(t.ultimas.length, 0);
});

test('parâmetros iguais e id de referência não são apresentados como mudanças', async () => {
  const t = fixture();
  await t.executar(() => t.api.put('/produtos/3', { nome: 'Caixa', quantidade: 2 }), {
    payload: { id: 3, nome: 'Caixa', quantidade: 2 }
  });
  assert.deepEqual(mudancas(t.eventos[0]), []);
  assert.equal(t.ultimas.length, 0);
});

test('canais anteriores à sessão não tentam auditoria com ator ou token ausentes', async () => {
  for (const canal of ['login-usuario', 'auto-login', 'registrar-usuario', 'perfil:obter']) {
    const t = fixture();
    let clientes = 0;
    const r = await captura.executarIpc({ usuarioId: null, canal, payload: { email: 'pessoa@example.test' } },
      () => t.api.put('/usuarios/7', { nome: 'Nome confirmado pelo login' }),
      { criarApi: () => { clientes++; throw new Error('Não criar cliente anterior ao login'); }, onAuditFailure: e => t.falhas.push(e) });
    assert.equal(r.nome, 'Nome confirmado pelo login');
    assert.equal(clientes, 0);
    assert.equal(t.eventos.length, 0);
    assert.equal(t.falhas.length, 0);
  }
});

test('falha ou falta de confirmação em metadata não confirma última alteração manual', async () => {
  for (const retorno of [false, null, undefined, [], { success: false }, { ok: false }, { error: 'Conteúdo privado nunca deve sair' }]) {
    const t = fixture();
    const api = { ...t.api, updateUserActivity: async () => retorno };
    const falhas = [];
    const ultimas = [];
    await captura.executarIpc({ usuarioId: 12345, canal: 'atualizar-produto', payload: { id: 3, nome: 'Nova caixa' },
      contexto: { origem: 'manual', acao_id: randomUUID() } }, () => api.put('/produtos/3', { nome: 'Nova caixa' }),
    { criarApi: () => api, onManualChange: r => ultimas.push(r), onAuditFailure: r => falhas.push(r) });
    assert.equal(t.linhas.produtos[0].nome, 'Nova caixa');
    assert.equal(ultimas.length, 0);
    assert.equal(falhas[0].code, 'AUDITORIA_ULTIMA_ALTERACAO_FALHOU');
    assert.deepEqual(falhas[0].diagnosticos, [{ fase: 'atualizar-ultima-alteracao', code: 'AUDITORIA_ATIVIDADE_SEM_CONFIRMACAO' }]);
    assert.doesNotMatch(JSON.stringify(falhas), /Conteúdo privado/);
  }
});
