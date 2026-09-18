/**
 * Histórico "de rede social" de Prospecções e Clientes + o sino.
 *
 * As regras que o dono pediu, uma a uma:
 *   - comentar, responder (sem limite de níveis), curtir, publicar observação;
 *   - o aviso vai para OS DOIS: quem criou a ficha e quem fez a ação comentada
 *     (e o autor do comentário respondido) — nunca para quem agiu;
 *   - o autor edita o próprio comentário, e o Sup Admin vê o que era antes;
 *   - só o Sup Admin exclui, e por marca (nada sai do banco);
 *   - anexo de qualquer tipo, até 20 MB, guardado em partes de 512 KB.
 *
 * O duplo da API remota imita a real: filtro só por igualdade em coluna que
 * existe, 404 "Tabela não encontrada" para tabela que não existe.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const social = require('./historicoSocial');
const { montarAvisos } = require('./notificacoesController');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

test('destinatarios: sem repetir, sem quem agiu, sem vazio', () => {
  assert.deepStrictEqual(social.destinatarios([3, '2', null, 3, undefined, '', 5], 5), [3, 2]);
  assert.deepStrictEqual(social.destinatarios([7], 7), []);
});

test('semTabela reconhece o SQL que não rodou (API e banco DEV)', () => {
  assert.ok(social.semTabela({ status: 404, message: "Tabela 'historico_curtidas' não encontrada." }));
  assert.ok(social.semTabela({ status: 400, body: { error: 'Nenhuma coluna válida.' } }));
  assert.ok(social.semTabela({ code: '42P01' }));
  assert.ok(social.semTabela({ code: '42703' }));
  assert.ok(!social.semTabela({ status: 404, message: 'Registro não encontrado' }));
  assert.ok(!social.semTabela({ status: 500, message: 'Tabela' }));
});

test('textoValido: obrigatório e até 5000 caracteres', () => {
  assert.strictEqual(social.textoValido('  oi  '), 'oi');
  assert.throws(() => social.textoValido('   '), e => e.status === 400);
  assert.throws(() => social.textoValido('x'.repeat(5001)), e => e.status === 400);
});

test('partesDoArquivo: pedaços de 512 KB que remontam o arquivo', () => {
  const arquivo = Buffer.alloc(1300 * 1024, 7);
  const partes = social.partesDoArquivo(arquivo);
  assert.strictEqual(partes.length, 3);
  const remontado = Buffer.concat(partes.map(p => Buffer.from(p, 'base64')));
  assert.ok(remontado.equals(arquivo));
});

test('nomeDeArquivo tira caminho e caracteres de controle', () => {
  assert.strictEqual(social.nomeDeArquivo('C:\\Users\\x\\proposta final.pdf'), 'proposta final.pdf');
  assert.strictEqual(social.nomeDeArquivo('a\u0001b.txt'), 'ab.txt');
  assert.strictEqual(social.nomeDeArquivo(''), 'arquivo');
});

test('montarLinhaDoTempo: quem não é Sup Admin não vê o excluído; o Sup Admin vê tudo e as versões', () => {
  const nomes = new Map([[1, 'Henrique'], [2, 'Ana'], [3, 'João']]);
  const base = {
    origem: 'prospeccao', registroId: 9, nomes, criadorId: 3,
    itens: [
      { id: 1, tipo: 'observacao', acao: 'publicou', usuario_id: 2, criado_em: '2026-09-01T10:00:00Z' },
      { id: 2, tipo: 'funil', acao: 'moveu', usuario_id: 3, criado_em: '2026-09-02T10:00:00Z', excluido_em: '2026-09-03T10:00:00Z', excluido_por: 1 }
    ],
    comentarios: [
      { id: 10, item_id: 1, usuario_id: 3, texto: 'Boa!', criado_em: '2026-09-01T11:00:00Z', editado_em: '2026-09-01T12:00:00Z' },
      { id: 11, item_id: 1, resposta_de: 10, usuario_id: 2, texto: 'Valeu', criado_em: '2026-09-01T11:30:00Z', excluido_em: '2026-09-02T00:00:00Z', excluido_por: 1 },
      { id: 12, item_id: 2, usuario_id: 2, texto: 'no excluído', criado_em: '2026-09-02T11:00:00Z' }
    ],
    curtidas: [{ id: 1, item_id: 1, usuario_id: 3 }, { id: 2, comentario_id: 10, usuario_id: 2 }],
    anexos: [
      { id: 5, item_id: 1, nome_arquivo: 'a.pdf', tamanho_bytes: 10, completo: true },
      { id: 6, item_id: 1, nome_arquivo: 'pela-metade.pdf', tamanho_bytes: 10, completo: false }
    ],
    versoes: [{ comentario_id: 10, texto: 'Bom', editado_em: '2026-09-01T12:00:00Z', editado_por: 3 }]
  };

  const comum = social.montarLinhaDoTempo({ ...base, usuarioId: 2, supAdmin: false });
  assert.deepStrictEqual(comum.itens.map(i => i.id), [1], 'evento excluído some');
  assert.strictEqual(comum.itens[0].curtidas, 1);
  assert.deepStrictEqual(comum.itens[0].quem_curtiu, ['João']);
  assert.deepStrictEqual(comum.itens[0].anexos.map(a => a.nome), ['a.pdf'], 'anexo incompleto não aparece');
  assert.strictEqual(comum.itens[0].comentarios, 1, 'o removido não conta');
  const removido = comum.comentarios.find(c => c.id === 11);
  assert.strictEqual(removido.texto, null);
  assert.strictEqual(removido.usuario, null);
  assert.strictEqual(removido.excluido, true);
  assert.ok(!('versoes' in comum.comentarios.find(c => c.id === 10)), 'sem versões para quem não é Sup Admin');
  assert.strictEqual(comum.comentarios.find(c => c.id === 10).curti, true);
  assert.ok(!comum.comentarios.some(c => c.id === 12), 'comentário do evento excluído some junto');
  assert.strictEqual(comum.criador_id, 3);

  const sup = social.montarLinhaDoTempo({ ...base, usuarioId: 1, supAdmin: true });
  assert.deepStrictEqual(sup.itens.map(i => i.id), [2, 1], 'mais novo primeiro, excluído incluso');
  assert.strictEqual(sup.itens[0].excluido_por_nome, 'Henrique');
  assert.strictEqual(sup.comentarios.find(c => c.id === 11).texto, 'Valeu');
  assert.deepStrictEqual(sup.comentarios.find(c => c.id === 10).versoes, [{ texto: 'Bom', editado_em: '2026-09-01T12:00:00Z', editado_por: 'João' }]);
});

test('montarAvisos: mais novo primeiro, não lidos contados, nome do autor', () => {
  const r = montarAvisos([
    { id: 1, tipo: 'curtida', titulo: 'Curtida', criado_em: '2026-09-01T10:00:00Z', lida_em: '2026-09-01T11:00:00Z', autor_id: 2 },
    { id: 2, tipo: 'comentario', titulo: 'Novo comentário', criado_em: '2026-09-02T10:00:00Z', autor_id: 3, origem: 'cliente', registro_id: 4 }
  ], new Map([[2, 'Ana'], [3, 'João']]));
  assert.strictEqual(r.nao_lidas, 1);
  assert.deepStrictEqual(r.itens.map(i => i.id), [2, 1]);
  assert.strictEqual(r.itens[0].autor, 'João');
  assert.strictEqual(r.itens[0].lida, false);
  assert.strictEqual(r.itens[1].lida, true);
});

// ---------------------------------------------------------------------------
// Rotas, com o duplo da API
// ---------------------------------------------------------------------------

const COLUNAS = {
  usuarios: ['id', 'nome', 'perfil', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome'],
  perm_pros: ['id', 'modelo_id', 'modulo_ativo', 'acao_view', 'acao_details_view'],
  perm_cli: ['id', 'modelo_id', 'modulo_ativo', 'acao_view', 'acao_details_view'],
  prospeccoes: ['id', 'nome_fantasia', 'criado_por'],
  clientes: ['id', 'nome_fantasia', 'dono_cliente', 'criado_por'],
  prospeccao_historico: ['id', 'prospeccao_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  cliente_historico: ['id', 'cliente_id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  historico_comentarios: ['id', 'origem', 'registro_id', 'item_id', 'resposta_de', 'usuario_id', 'texto', 'criado_em', 'editado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'],
  historico_comentario_versoes: ['id', 'comentario_id', 'origem', 'registro_id', 'texto', 'editado_por', 'editado_em'],
  historico_curtidas: ['id', 'origem', 'registro_id', 'item_id', 'comentario_id', 'usuario_id', 'criado_em'],
  historico_anexos: ['id', 'origem', 'registro_id', 'item_id', 'comentario_id', 'nome_arquivo', 'tipo_mime', 'tamanho_bytes', 'partes', 'completo', 'usuario_id', 'criado_em', 'excluido_em', 'excluido_por'],
  historico_anexo_partes: ['id', 'anexo_id', 'ordem', 'dados'],
  notificacoes: ['id', 'usuario_id', 'tipo', 'titulo', 'mensagem', 'origem', 'registro_id', 'item_id', 'comentario_id', 'autor_id', 'lida_em', 'criado_em']
};
const SOCIAIS = ['historico_comentarios', 'historico_comentario_versoes', 'historico_curtidas', 'historico_anexos', 'historico_anexo_partes', 'notificacoes'];

function criarUpstream(dados) {
  const tabelas = JSON.parse(JSON.stringify(dados));
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', p => { corpo += p; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const [, tabela, id] = url.pathname.split('/').filter(Boolean);
      const body = corpo ? JSON.parse(corpo) : null;
      const responder = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      // A API real limita o corpo a 1 MB: uma parte de anexo precisa caber.
      if (corpo.length > 1024 * 1024) return responder(413, { error: 'request entity too large' });
      if (!tabelas[tabela]) return responder(404, { error: `Tabela '${tabela}' não encontrada.` });
      const colunas = COLUNAS[tabela] || [];
      if (req.method === 'GET' && id) {
        const achado = tabelas[tabela].find(r => String(r.id) === String(id));
        return achado ? responder(200, achado) : responder(404, { error: 'Registro não encontrado' });
      }
      if (req.method === 'GET') {
        let linhas = tabelas[tabela];
        for (const [chave, valor] of url.searchParams.entries()) {
          if (!colunas.includes(chave)) continue;
          linhas = linhas.filter(r => String(r[chave]) === String(valor));
        }
        return responder(200, linhas);
      }
      if (req.method === 'POST') {
        const linha = { id: Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1 };
        for (const c of colunas) if (body?.[c] !== undefined && c !== 'id') linha[c] = body[c];
        if (colunas.includes('criado_em') && !linha.criado_em) linha.criado_em = new Date(Date.now() + tabelas[tabela].length).toISOString();
        tabelas[tabela].push(linha);
        return responder(201, linha);
      }
      if (req.method === 'PUT') {
        const alvo = tabelas[tabela].find(r => String(r.id) === String(id));
        if (!alvo) return responder(404, { error: 'Registro não encontrado' });
        for (const c of colunas) if (body?.[c] !== undefined && c !== 'id') alvo[c] = body[c];
        return responder(200, alvo);
      }
      if (req.method === 'DELETE') {
        const idx = tabelas[tabela].findIndex(r => String(r.id) === String(id));
        if (idx === -1) return responder(404, { error: 'Registro não encontrado' });
        tabelas[tabela].splice(idx, 1);
        if (tabela === 'historico_anexos' && tabelas.historico_anexo_partes) {
          tabelas.historico_anexo_partes = tabelas.historico_anexo_partes.filter(p => String(p.anexo_id) !== String(id));
        }
        return responder(200, { sucesso: true });
      }
      responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = ['./apiHttpClient', './permissionsController', './permissionsRepository', './historicoSocialController', './notificacoesController'];

async function montar(dados) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/historico-social', require('./historicoSocialController'));
  app.use('/api/notificacoes', require('./notificacoesController'));
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  return {
    porta: server.address().port,
    tabelas: upstream.tabelas,
    encerrar: async () => {
      await new Promise(r => server.close(r));
      await new Promise(r => upstream.servidor.close(r));
      delete process.env.API_BASE_URL;
      for (const m of MODULOS) delete require.cache[require.resolve(m)];
    }
  };
}

async function chamar(porta, caminho, { usuario = 1, corpo, method } = {}) {
  const resp = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: method || (corpo ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${tokenDe(usuario)}`, 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

/**
 * 1 Sup Admin; 2 Ana e 3 João vendedores com "ver detalhes" nos dois
 * módulos; 4 Beto sem permissão nenhuma. A prospecção 7 foi criada pelo
 * João; o evento 1 (moveu de etapa) é da Ana.
 */
function baseDados({ semSocial = false } = {}) {
  const dados = {
    usuarios: [
      { id: 1, nome: 'Henrique', perfil: 'Sup Admin', modelo_permissoes_id: null },
      { id: 2, nome: 'Ana', perfil: 'Vendedor', modelo_permissoes_id: 9 },
      { id: 3, nome: 'João', perfil: 'Vendedor', modelo_permissoes_id: 9 },
      { id: 4, nome: 'Beto', perfil: 'Vendedor', modelo_permissoes_id: 8 }
    ],
    modelos_permissoes: [{ id: 8, nome: 'Nada' }, { id: 9, nome: 'Vendedor' }],
    perm_pros: [{ id: 1, modelo_id: 9, modulo_ativo: true, acao_view: true, acao_details_view: true }],
    perm_cli: [{ id: 1, modelo_id: 9, modulo_ativo: true, acao_view: true, acao_details_view: true }],
    prospeccoes: [{ id: 7, nome_fantasia: 'ACME', criado_por: 3 }],
    clientes: [{ id: 4, nome_fantasia: 'Loja Boa', dono_cliente: 'Ana' }],
    prospeccao_historico: [
      { id: 1, prospeccao_id: 7, tipo: 'funil', acao: 'moveu', entidade: 'Etapa do funil', valor_anterior: 'Novo', valor_novo: 'Proposta', usuario_id: 2, criado_em: '2026-09-01T10:00:00Z' }
    ],
    cliente_historico: [
      { id: 1, cliente_id: 4, tipo: 'criacao', acao: 'criou', entidade: 'Cliente', usuario_id: null, criado_em: '2026-08-01T10:00:00Z' }
    ]
  };
  if (!semSocial) for (const t of SOCIAIS) dados[t] = [];
  return dados;
}

const avisosDe = (ctx, usuarioId) => ctx.tabelas.notificacoes.filter(n => n.usuario_id === usuarioId);

test('comentário avisa quem criou a ficha e quem fez a ação — não quem comentou', async () => {
  const ctx = await montar(baseDados());
  try {
    const r = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 1, corpo: { texto: 'Boa, Ana!' } });
    assert.strictEqual(r.status, 201);
    assert.ok(r.json.id);
    const c = ctx.tabelas.historico_comentarios[0];
    assert.strictEqual(c.origem, 'prospeccao');
    assert.strictEqual(c.registro_id, 7);
    assert.strictEqual(c.usuario_id, 1);
    assert.strictEqual(avisosDe(ctx, 2).length, 1, 'Ana (fez o evento)');
    assert.strictEqual(avisosDe(ctx, 3).length, 1, 'João (criou a prospecção)');
    assert.strictEqual(avisosDe(ctx, 1).length, 0, 'quem comentou não se avisa');
    const aviso = avisosDe(ctx, 3)[0];
    assert.strictEqual(aviso.tipo, 'comentario');
    assert.match(aviso.mensagem, /Henrique comentou em ACME/);
    assert.strictEqual(aviso.comentario_id, c.id);
    assert.strictEqual(aviso.item_id, 1);

    // João (o criador) comenta: só a Ana recebe.
    await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 3, corpo: { texto: 'Vou ligar' } });
    assert.strictEqual(avisosDe(ctx, 2).length, 2);
    assert.strictEqual(avisosDe(ctx, 3).length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('resposta: o autor respondido recebe "resposta"; respostas encadeiam sem limite', async () => {
  const ctx = await montar(baseDados());
  try {
    const a = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'nível 1' } });
    const b = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 1, corpo: { texto: 'nível 2', resposta_de: a.json.id } });
    const c = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 3, corpo: { texto: 'nível 3', resposta_de: b.json.id } });
    const d = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'nível 4', resposta_de: c.json.id } });
    assert.strictEqual(d.status, 201);
    const porId = new Map(ctx.tabelas.historico_comentarios.map(x => [x.id, x]));
    assert.strictEqual(porId.get(d.json.id).resposta_de, c.json.id);

    const paraAna = avisosDe(ctx, 2).find(n => n.comentario_id === b.json.id);
    assert.strictEqual(paraAna.tipo, 'resposta', 'Ana foi respondida pelo Henrique');
    assert.match(paraAna.mensagem, /respondeu/);
    // A Ana, autora do evento E do comentário respondido, recebe um aviso só.
    assert.strictEqual(avisosDe(ctx, 2).filter(n => n.comentario_id === b.json.id).length, 1);

    // Resposta em outro evento não vale.
    ctx.tabelas.prospeccao_historico.push({ id: 2, prospeccao_id: 7, tipo: 'nota', acao: 'criou', usuario_id: 3, criado_em: '2026-09-02T10:00:00Z' });
    const errada = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/2/comentarios', { usuario: 2, corpo: { texto: 'x', resposta_de: a.json.id } });
    assert.strictEqual(errada.status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('edição: só o autor edita; o texto de antes fica para o Sup Admin', async () => {
  const ctx = await montar(baseDados());
  try {
    const criado = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'Primeira versão' } });
    const id = criado.json.id;

    const outro = await chamar(ctx.porta, `/api/historico-social/prospeccao/7/comentarios/${id}`, { usuario: 3, method: 'PUT', corpo: { texto: 'mexi' } });
    assert.strictEqual(outro.status, 403);

    const ok = await chamar(ctx.porta, `/api/historico-social/prospeccao/7/comentarios/${id}`, { usuario: 2, method: 'PUT', corpo: { texto: 'Segunda versão' } });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ctx.tabelas.historico_comentarios[0].texto, 'Segunda versão');
    assert.ok(ctx.tabelas.historico_comentarios[0].editado_em);
    assert.strictEqual(ctx.tabelas.historico_comentario_versoes.length, 1);
    assert.strictEqual(ctx.tabelas.historico_comentario_versoes[0].texto, 'Primeira versão');

    const vendedor = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 3 });
    const doVendedor = vendedor.json.comentarios.find(c => c.id === id);
    assert.strictEqual(doVendedor.editado, true);
    assert.ok(!('versoes' in doVendedor), 'o vendedor vê "editado", não o texto antigo');

    const sup = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 1 });
    assert.deepStrictEqual(sup.json.comentarios.find(c => c.id === id).versoes.map(v => v.texto), ['Primeira versão']);
    assert.strictEqual(sup.json.eu.sup_admin, true);
  } finally {
    await ctx.encerrar();
  }
});

test('curtir alterna e avisa o autor; curtir de novo desfaz', async () => {
  const ctx = await montar(baseDados());
  try {
    const um = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/curtida', { usuario: 3, corpo: {} });
    assert.deepStrictEqual(um.json, { curti: true });
    assert.strictEqual(ctx.tabelas.historico_curtidas.length, 1);
    assert.strictEqual(avisosDe(ctx, 2).filter(n => n.tipo === 'curtida').length, 1, 'Ana, autora do evento');

    const linha = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 3 });
    assert.strictEqual(linha.json.itens[0].curtidas, 1);
    assert.strictEqual(linha.json.itens[0].curti, true);

    const dois = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/curtida', { usuario: 3, corpo: {} });
    assert.deepStrictEqual(dois.json, { curti: false });
    assert.strictEqual(ctx.tabelas.historico_curtidas.length, 0);

    // Curtir o próprio evento não gera aviso.
    await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/curtida', { usuario: 2, corpo: {} });
    assert.strictEqual(avisosDe(ctx, 2).filter(n => n.tipo === 'curtida').length, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir é do Sup Admin e é por marca: o vendedor deixa de ver, o banco guarda', async () => {
  const ctx = await montar(baseDados());
  try {
    const com = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'algo' } });

    assert.strictEqual((await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/excluir', { usuario: 2, corpo: {} })).status, 403);
    assert.strictEqual((await chamar(ctx.porta, `/api/historico-social/prospeccao/7/comentarios/${com.json.id}/excluir`, { usuario: 2, corpo: {} })).status, 403);

    const r = await chamar(ctx.porta, `/api/historico-social/prospeccao/7/comentarios/${com.json.id}/excluir`, { usuario: 1, corpo: { motivo: 'teste' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(ctx.tabelas.historico_comentarios.length, 1, 'nada sai do banco');
    assert.ok(ctx.tabelas.historico_comentarios[0].excluido_em);
    assert.strictEqual(ctx.tabelas.historico_comentarios[0].motivo_exclusao, 'teste');

    await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/excluir', { usuario: 1, corpo: {} });
    assert.ok(ctx.tabelas.prospeccao_historico[0].excluido_em);
    assert.strictEqual(ctx.tabelas.prospeccao_historico[0].excluido_por, 1);

    const vendedor = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 2 });
    assert.strictEqual(vendedor.json.itens.length, 0);
    const sup = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 1 });
    assert.strictEqual(sup.json.itens[0].excluido, true);

    // Evento excluído não recebe comentário nem curtida.
    assert.strictEqual((await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'x' } })).status, 409);
  } finally {
    await ctx.encerrar();
  }
});

test('observação publicada avisa quem criou; anexo grande vai em partes e volta inteiro', async () => {
  const ctx = await montar(baseDados());
  try {
    const obs = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/observacoes', { usuario: 2, corpo: { texto: 'Cliente pediu amostra' } });
    assert.strictEqual(obs.status, 201);
    const evento = ctx.tabelas.prospeccao_historico.find(e => e.id === obs.json.id);
    assert.strictEqual(evento.tipo, 'observacao');
    assert.strictEqual(evento.acao, 'publicou');
    assert.strictEqual(avisosDe(ctx, 3)[0].tipo, 'observacao');

    const arquivo = Buffer.alloc(1200 * 1024);
    for (let i = 0; i < arquivo.length; i++) arquivo[i] = i % 251;
    const base64 = arquivo.toString('base64');

    const alheio = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/anexos', { usuario: 3, corpo: { item_id: obs.json.id, nome: 'x.bin', base64 } });
    assert.strictEqual(alheio.status, 403, 'só o autor anexa');

    const up = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/anexos', { usuario: 2, corpo: { item_id: obs.json.id, nome: 'C:\\fotos\\amostra.bin', tipo: 'application/octet-stream', base64 } });
    assert.strictEqual(up.status, 201);
    const anexo = ctx.tabelas.historico_anexos[0];
    assert.strictEqual(anexo.nome_arquivo, 'amostra.bin');
    assert.strictEqual(anexo.partes, 3);
    assert.strictEqual(anexo.completo, true);
    assert.strictEqual(ctx.tabelas.historico_anexo_partes.length, 3);

    const baixado = await chamar(ctx.porta, `/api/historico-social/prospeccao/7/anexos/${anexo.id}`, { usuario: 3 });
    assert.strictEqual(baixado.status, 200);
    assert.strictEqual(baixado.json.base64, base64);
    assert.strictEqual(baixado.json.tamanho, arquivo.length);

    // Anexo de outra ficha não é servido por esta rota.
    assert.strictEqual((await chamar(ctx.porta, `/api/historico-social/cliente/4/anexos/${anexo.id}`, { usuario: 3 })).status, 404);

    const linha = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 3 });
    assert.deepStrictEqual(linha.json.itens.find(i => i.id === obs.json.id).anexos.map(a => a.nome), ['amostra.bin']);
  } finally {
    await ctx.encerrar();
  }
});

test('cliente sem criado_por: o aviso vai para o dono que é usuário', async () => {
  const ctx = await montar(baseDados());
  try {
    const r = await chamar(ctx.porta, '/api/historico-social/cliente/4/observacoes', { usuario: 3, corpo: { texto: 'Visitei a loja' } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(ctx.tabelas.cliente_historico.find(e => e.id === r.json.id).cliente_id, 4);
    assert.strictEqual(avisosDe(ctx, 2).length, 1, 'Ana, dona do cliente');
    assert.strictEqual(avisosDe(ctx, 2)[0].origem, 'cliente');
  } finally {
    await ctx.encerrar();
  }
});

test('sem permissão de ver detalhes: 403; origem inválida: 400', async () => {
  const ctx = await montar(baseDados());
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 4 })).status, 403);
    assert.strictEqual((await chamar(ctx.porta, '/api/historico-social/pedido/7', { usuario: 1 })).status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('sino: cada um lê e marca só os próprios avisos', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 1, corpo: { texto: 'Olá' } });
    await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/curtida', { usuario: 3, corpo: {} });

    const ana = await chamar(ctx.porta, '/api/notificacoes', { usuario: 2 });
    assert.strictEqual(ana.json.nao_lidas, 2);
    assert.strictEqual(ana.json.itens[0].autor, 'João', 'a curtida, mais nova, vem primeiro');
    assert.strictEqual(ana.json.itens[0].origem, 'prospeccao');
    assert.strictEqual(ana.json.itens[0].registro_id, 7);

    const joao = await chamar(ctx.porta, '/api/notificacoes', { usuario: 3 });
    assert.strictEqual(joao.json.nao_lidas, 1);

    // A Ana marca um aviso do João: nada acontece com o dele.
    const idDoJoao = joao.json.itens[0].id;
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes/lidas', { usuario: 2, corpo: { ids: [idDoJoao] } })).json.marcadas, 0);
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes', { usuario: 3 })).json.nao_lidas, 1);

    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes/lidas', { usuario: 2, corpo: { ids: [ana.json.itens[1].id] } })).json.marcadas, 1);
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes', { usuario: 2 })).json.nao_lidas, 1);
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes/lidas', { usuario: 2, corpo: { todas: true } })).json.marcadas, 1);
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes', { usuario: 2 })).json.nao_lidas, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('antes do SQL: a linha do tempo aparece (só leitura) e escrever pede o SQL', async () => {
  const dados = baseDados({ semSocial: true });
  const ctx = await montar(dados);
  try {
    const linha = await chamar(ctx.porta, '/api/historico-social/prospeccao/7', { usuario: 2 });
    assert.strictEqual(linha.status, 200);
    assert.strictEqual(linha.json.sql_pendente, true);
    assert.strictEqual(linha.json.itens.length, 1);

    const com = await chamar(ctx.porta, '/api/historico-social/prospeccao/7/itens/1/comentarios', { usuario: 2, corpo: { texto: 'oi' } });
    assert.strictEqual(com.status, 409);
    assert.strictEqual(com.json.sql_pendente, true);

    const sino = await chamar(ctx.porta, '/api/notificacoes', { usuario: 2 });
    assert.deepStrictEqual(sino.json, { itens: [], nao_lidas: 0, sql_pendente: true });
  } finally {
    await ctx.encerrar();
  }
});
