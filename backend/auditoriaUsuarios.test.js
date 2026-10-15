const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const auditoria = require('./auditoriaUsuarios');

const evento = (id, extra = {}) => ({
  id, usuario_id: 7, criado_em: '2026-10-15T15:00:00.000Z', modulo: 'pedidos', acao: 'alterar',
  entidade: 'pedidos', entidade_id: '55', origem: 'manual', resultado: 'sucesso',
  descricao: 'Uma legenda antiga', mudancas: JSON.stringify([{ campo: 'quantidade', antes: 1, depois: 2 }]), ...extra
});
function apiFalsa(linhas = []) {
  const leituras = [];
  const escritos = [];
  return {
    linhas, leituras, escritos,
    async get(caminho, { query = {} } = {}) {
      leituras.push({ caminho, query });
      assert.equal(caminho, '/api/usuarios_auditoria');
      assert.deepEqual(Object.keys(query).filter(k => ['id', 'order', 'limit', 'offset'].includes(k)), [], 'API REST simples não recebe controles PostgREST');
      return linhas.filter(r => String(r.usuario_id) === String(query.usuario_id)
        && ['modulo', 'acao', 'origem', 'resultado'].every(c => !query[c] || r[c] === query[c]))
        .sort((a, b) => Number(a.id) - Number(b.id));
    },
    async post(caminho, corpo) {
      assert.equal(caminho, '/api/usuarios_auditoria');
      escritos.push(corpo);
      const linha = { ...corpo, id: linhas.length + 1, criado_em: '2026-10-15T15:00:00.000Z' };
      linhas.push(linha);
      return linha;
    }
  };
}

test('registro mantém ator autenticado, recebe hora do banco e nunca usa horário enviado', async () => {
  const api = apiFalsa();
  const r = await auditoria.registrar(api, { usuarioId: 7, usuario_id: 999, modulo: 'Pedidos', acao: 'Alterar',
    entidade: 'pedidos', entidadeId: 55, timestamp: '1990-01-01', criado_em: '1990-01-01',
    descricao: 'senha=nao-deve-ser-gravada', antes: { quantidade: 1 }, depois: { quantidade: 2 } });
  assert.equal(r.ok, true);
  assert.equal(r.criado_em, '2026-10-15T15:00:00.000Z');
  assert.equal(api.escritos[0].usuario_id, 7);
  assert.equal('criado_em' in api.escritos[0], false);
  assert.deepEqual(JSON.parse(api.escritos[0].mudancas), [{ campo: 'quantidade', antes: 1, depois: 2 }]);
  assert.doesNotMatch(JSON.stringify(api.escritos), /nao-deve-ser-gravada|1990/);
});

test('origens manual e não confirmada exigem ator; sistema pode registrar sem usuário', async () => {
  assert.throws(() => auditoria.normalizarEvento({ usuario_id: 99, modulo: 'pedidos', acao: 'alterar' }), e => e.status === 401);
  assert.throws(() => auditoria.normalizarEvento({ modulo: 'pedidos', acao: 'alterar', origem: 'nao_confirmada' }), e => e.status === 401);
  const api = apiFalsa();
  await auditoria.registrar(api, { usuarioId: null, modulo: 'cobranca', acao: 'sincronizar', origem: 'sistema' });
  assert.equal(api.escritos[0].usuario_id, null);
  assert.equal(api.escritos[0].origem, 'sistema');
  assert.equal(auditoria.normalizarEvento({ usuarioId: 7, modulo: 'pedidos', acao: 'alterar', origem: 'nao_confirmada' }).origem, 'nao_confirmada');
  assert.equal(auditoria.normalizarEvento({ usuarioId: 7, modulo: 'pedidos', acao: 'alterar' }).origem, 'nao_confirmada');
});

test('correlação preserva identificadores seguros sem consulta URL, texto livre ou segredos', async () => {
  const api = apiFalsa();
  const acaoId = '12345678-1234-1234-1234-123456789abc';
  await auditoria.registrar(api, { usuarioId: 7, modulo: 'usuarios', acao: 'alterar-senha', entidadeId: 8, acao_id: acaoId,
    contexto: { evento: 'usuarios:salvar', tela: 'usuarios.html', alvo_id: 8, canal: 'ipc',
      rota: '/api/usuarios/8?token=secreto', token: 'secreto', descricao: 'texto privado' } });
  assert.equal(api.escritos[0].acao_id, acaoId);
  assert.deepEqual(JSON.parse(api.escritos[0].contexto), { evento: 'usuarios:salvar', tela: 'usuarios.html', alvo_id: '8', canal: 'ipc' });
  assert.equal(api.escritos[0].descricao, 'Alterou a senha de usuarios #8.');
  assert.doesNotMatch(JSON.stringify(api.escritos), /secreto|texto privado/);
  const r = await auditoria.listar(api, { usuario_id: 7 });
  assert.equal(r.registros[0].acao_id, acaoId);
  assert.equal(r.registros[0].contexto.canal, 'ipc');
});

test('allowlist remove credenciais, fotos, anexos e textos livres em todos os níveis', () => {
  const segredos = { senha: 'supersecreta', token: 'tokprivado', certificado: 'PFX', foto_usuario: 'base64foto',
    anexo: 'base64anexo', observacoes: 'texto privado', descricao: 'segredo textual' };
  const mudancas = auditoria.sanitizarMudancas({ antes: { quantidade: 1 }, depois: {
    ...segredos, quantidade: 2, nome: 'data:image/png;base64,SECRETO',
    itens: [{ id: 2, quantidade: 3, ...segredos }]
  }, mudancas: [{ campo: 'itens[0].senha', antes: 'a', depois: 'b' }, { campo: 'quantidade', antes: 1, depois: 2 }] });
  assert.deepEqual(mudancas, [
    { campo: 'quantidade', antes: 1, depois: 2 },
    { campo: 'nome', antes: null, depois: '[conteúdo omitido]' },
    { campo: 'itens', antes: null, depois: [{ id: 2, quantidade: 3 }] }
  ]);
  assert.doesNotMatch(JSON.stringify(mudancas), /supersecreta|tokprivado|PFX|base64foto|base64anexo|texto privado|SECRETO/);
});

test('mudanças iguais e desconhecidas não poluem o histórico; JSON também é sanitizado na leitura', async () => {
  assert.deepEqual(auditoria.sanitizarMudancas({ antes: { quantidade: 1 }, depois: { quantidade: 1, desconhecido: 2 } }), []);
  const api = apiFalsa([evento(1, { mudancas: JSON.stringify([{ campo: 'senha', antes: 'a', depois: 'b' }, { campo: 'valor_total', antes: 10, depois: 12 }]) })]);
  const r = await auditoria.listar(api, { usuario_id: 7 });
  assert.deepEqual(r.registros[0].mudancas, [{ campo: 'valor_total', antes: 10, depois: 12 }]);
});

test('recursos de pré-leitura são limitados a tabelas de negócio, sem endpoints de segredos', () => {
  assert.equal(auditoria.recursoPermitido('/api/pedidos/55'), true);
  assert.equal(auditoria.recursoPermitido('materia_prima'), true);
  for (const caminho of ['/api/cobranca/configuracao', '/api/usuarios_login_cache', '/api/fiscal/certificado', '/api/pedidos/55/anexos', '/api/usuarios/7/avatar']) {
    assert.equal(auditoria.recursoPermitido(caminho), false, caminho);
  }
});

test('paginação ocorre localmente sobre a coleção completa da API REST simples', async () => {
  const api = apiFalsa(Array.from({ length: 7 }, (_, i) => evento(i + 1)));
  const r = await auditoria.listar(api, { usuario_id: 7, pagina: 1, limite: 3 });
  assert.equal(r.total, 7);
  assert.equal(r.snapshot, 7);
  assert.equal(r.completo, true);
  assert.deepEqual(r.registros.map(e => e.id), [7, 6, 5]);
  assert.equal(r.proxima_pagina, 2);
  assert.equal(api.leituras.length, 1);
  assert.deepEqual(api.leituras[0].query, { usuario_id: 7 });
  const pagina2 = await auditoria.listar(api, { usuario_id: 7, pagina: 2, limite: 3, snapshot: r.snapshot });
  assert.deepEqual(pagina2.registros.map(e => e.id), [4, 3, 2]);
});

test('snapshot impede novo evento de deslocar as páginas durante uma exportação', async () => {
  const api = apiFalsa([evento(1), evento(2), evento(3)]);
  const primeira = await auditoria.listar(api, { usuario_id: 7, limite: 2 });
  api.linhas.push(evento(4, { criado_em: '2026-10-15T16:00:00.000Z' }));
  const segunda = await auditoria.listar(api, { usuario_id: 7, pagina: 2, limite: 2, snapshot: primeira.snapshot });
  assert.equal(segunda.total, 3);
  assert.deepEqual([...primeira.registros, ...segunda.registros].map(r => r.id), [3, 2, 1]);
});

test('intervalo usa dias inclusivos de São Paulo, não o dia UTC', async () => {
  const api = apiFalsa([
    evento(1, { criado_em: '2026-10-15T02:59:59.999Z' }),
    evento(2, { criado_em: '2026-10-15T03:00:00.000Z' }),
    evento(3, { criado_em: '2026-10-16T02:59:59.999Z' }),
    evento(4, { criado_em: '2026-10-16T03:00:00.000Z' }),
    evento(5, { usuario_id: 8 })
  ]);
  const r = await auditoria.listar(api, { usuario_id: 7, inicio: '2026-10-15', fim: '2026-10-15' });
  assert.deepEqual(r.registros.map(e => e.id), [3, 2]);
  assert.equal(r.fuso, 'America/Sao_Paulo');
});

test('filtros selecionam módulo, ação, origem e resultado sem misturar usuário', async () => {
  const api = apiFalsa([
    evento(1), evento(2, { origem: 'automatico' }), evento(3, { resultado: 'falha' }),
    evento(4, { modulo: 'produtos' }), evento(5, { acao: 'criar' }), evento(6, { usuario_id: 8 })
  ]);
  const r = await auditoria.listar(api, { usuario_id: 7, modulo: 'pedidos', acao: 'alterar', origem: 'manual', resultado: 'sucesso' });
  assert.deepEqual(r.registros.map(e => e.id), [1]);
});

test('datas, ids e paginação inválidos falham antes de consultar o banco', async () => {
  const api = apiFalsa();
  for (const query of [
    {}, { usuario_id: -1 }, { usuario_id: 7, inicio: '2026-02-30' }, { usuario_id: 7, inicio: '2026-10-16', fim: '2026-10-15' },
    { usuario_id: 7, pagina: 0 }, { usuario_id: 7, limite: 501 }, { usuario_id: 7, snapshot: 'in.(1,2)' }, { usuario_id: 7, origem: 'qualquer' }
  ]) await assert.rejects(auditoria.listar(api, query), e => e.status === 400);
  assert.equal(api.leituras.length, 0);
});

test('SQL ausente é explícito na gravação e consulta; outras falhas não fingem lista vazia', async () => {
  const ausente = { get: async () => { throw Object.assign(new Error('relation "usuarios_auditoria" does not exist'), { code: '42P01' }); },
    post: async () => { throw Object.assign(new Error('relation "usuarios_auditoria" does not exist'), { code: '42P01' }); } };
  const escrita = await auditoria.registrar(ausente, { usuarioId: 7, modulo: 'pedidos', acao: 'alterar' });
  assert.equal(escrita.sql_pendente, true);
  await assert.rejects(auditoria.listar(ausente, { usuario_id: 7 }), e => e.status === 409 && e.sql_pendente && e.arquivo.endsWith('ddl_usuarios_auditoria.sql'));
  await assert.rejects(auditoria.listar({ get: async () => { throw new Error('sem conexão'); } }, { usuario_id: 7 }), /sem conexão/);
});

test('IDs inválidos ou repetidos falham explicitamente sem relatório parcial', async () => {
  for (const linhas of [[evento(1), evento(1)], [evento('invalido')]]) {
    await assert.rejects(auditoria.listar({ get: async () => linhas }, { usuario_id: 7 }), e => e.code === 'AUDITORIA_PAGINACAO_INVALIDA' && e.export_incompleta);
  }
});

test('limite de exportação é explícito e conta só eventos no intervalo solicitado', async () => {
  const linhas = Array.from({ length: auditoria.MAX_REGISTROS + 1 }, (_, i) => evento(i + 1, { criado_em: '2026-10-14T15:00:00.000Z' }));
  const api = apiFalsa(linhas, { teto: 500 });
  await assert.rejects(auditoria.listar(api, { usuario_id: 7 }), e => e.status === 413 && e.export_incompleta);
  linhas.push(evento(linhas.length + 1));
  const r = await auditoria.listar(api, { usuario_id: 7, inicio: '2026-10-15', fim: '2026-10-15' });
  assert.equal(r.total, 1);
});

test('rota exige guarda de gestão e não expõe escrita, alteração nem exclusão', async t => {
  const api = apiFalsa([evento(1)]);
  let autorizado = false;
  const app = express();
  app.use('/api/auditoria-usuarios', auditoria.criarRouter({ criarApi: () => api,
    guarda: (_req, res, next) => autorizado ? next() : res.status(403).json({ code: 'FORBIDDEN_SUP_ADMIN' }) }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/auditoria-usuarios?usuario_id=7`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal(api.leituras.length, 0);
  autorizado = true;
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).total, 1);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(url, { method })).status, 404);
  assert.equal(auditoria.stack[0].route.stack[0].handle, require('./permissionsController').exigirSupAdmin);
});
