/**
 * Tarefas e Calendário — rotas (/api/tarefas) com o duplo da API.
 *
 * As regras que o dono pediu:
 *   - cada um vê só as próprias tarefas; Admin e Sup Admin veem todas; quem
 *     tem "Ver tarefas de outros" vê as das pessoas escolhidas;
 *   - só Admin/Sup Admin (ou quem tem "Atribuir") cria tarefa para outro;
 *   - tarefa em conjunto: o convidado aceita ou recusa (aviso no sino);
 *   - tarefa de cliente/prospecção vai para o histórico da ficha e, concluída,
 *     vira atividade;
 *   - o próximo passo da prospecção é uma tarefa;
 *   - atrasada avisa; tarefa repetida gera a próxima; automações.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const tokenDe = id => `x.${Buffer.from(JSON.stringify({ id })).toString('base64')}.y`;

const HIST = ['id', 'tipo', 'acao', 'entidade', 'campo', 'valor_anterior', 'valor_novo', 'detalhe', 'observacao', 'usuario_id', 'criado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'];
const PERM_TAREFAS = ['id', 'modelo_id', 'modulo_ativo', 'acao_view', 'acao_create', 'acao_edit', 'acao_delete', 'acao_assign', 'acao_calendar_view', 'acao_invite', 'acao_others_view', 'acao_stats', 'acao_export', 'acao_automations'];
const COLUNAS = {
  usuarios: ['id', 'nome', 'perfil', 'status', 'modelo_permissoes_id'],
  modelos_permissoes: ['id', 'nome'],
  perm_tarefas: PERM_TAREFAS,
  tarefas: [
    'id', 'titulo', 'descricao', 'tipo', 'status', 'prioridade', 'data', 'hora', 'duracao_min', 'lembrete_min', 'local',
    'responsavel_id', 'criado_por', 'lista_id', 'marcadores', 'cliente_id', 'prospeccao_id', 'orcamento_id', 'pedido_id',
    'origem', 'chave_origem', 'recorrencia', 'serie_id', 'ordem', 'resultado', 'resultado_nota', 'concluida_em', 'concluida_por',
    'interacao_origem', 'interacao_id', 'excluida_em', 'excluida_por', 'motivo_exclusao', 'criado_em', 'atualizado_em',
    'acao_chave', 'acao_registro', 'acao_rotulo'
  ],
  tarefa_participantes: ['id', 'tarefa_id', 'usuario_id', 'status', 'convidado_por', 'mensagem', 'convidado_em', 'respondido_em'],
  tarefa_checklist: ['id', 'tarefa_id', 'texto', 'feito', 'feito_por', 'feito_em', 'ordem', 'criado_por', 'criado_em'],
  tarefa_historico: ['tarefa_id', ...HIST],
  tarefa_listas: ['id', 'nome', 'cor', 'icone', 'usuario_id', 'ordem', 'criado_em'],
  tarefa_marcadores: ['id', 'nome', 'cor', 'criado_por', 'criado_em'],
  tarefa_visibilidade: ['id', 'usuario_id', 'alvo_id', 'concedido_por', 'criado_em'],
  tarefa_automacoes: ['id', 'chave', 'nome', 'descricao', 'ativa', 'dias', 'titulo', 'tipo', 'prioridade', 'atualizado_por', 'atualizado_em'],
  notificacoes: ['id', 'usuario_id', 'tipo', 'titulo', 'mensagem', 'origem', 'registro_id', 'item_id', 'comentario_id', 'autor_id', 'lida_em', 'criado_em', 'chave', 'excluida_em'],
  clientes: ['id', 'nome_fantasia', 'dono_cliente', 'criado_por'],
  cliente_interacoes: ['id', 'cliente_id', 'contato_id', 'tipo', 'data', 'resumo', 'detalhe', 'duracao_min', 'usuario_id', 'tarefa_id', 'criado_em'],
  cliente_historico: ['cliente_id', ...HIST],
  prospeccoes: ['id', 'nome_fantasia', 'etapa', 'status', 'responsavel_id', 'criado_por', 'proximo_passo', 'proximo_passo_data', 'probabilidade', 'cliente_id'],
  prospeccao_interacoes: ['id', 'prospeccao_id', 'contato_id', 'tipo', 'data', 'resumo', 'detalhe', 'duracao_min', 'usuario_id', 'passo_planejado', 'passo_planejado_data', 'tarefa_id', 'criado_em'],
  prospeccao_historico: ['prospeccao_id', ...HIST],
  historico_comentarios: ['id', 'origem', 'registro_id', 'item_id', 'usuario_id', 'texto', 'excluido_em'],
  historico_anexos: ['id', 'origem', 'registro_id', 'item_id', 'completo', 'excluido_em'],
  orcamentos: ['id', 'numero', 'cliente_id', 'prospeccao_id'],
  pedidos: ['id', 'numero', 'cliente_id']
};

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
        // Índice único parcial de tarefas.chave_origem e de notificacoes (usuario, chave).
        if (tabela === 'tarefas' && body?.chave_origem && tabelas.tarefas.some(t => t.chave_origem === body.chave_origem)) {
          return responder(500, { error: 'Erro no INSERT', detalhe: 'duplicate key value violates unique constraint' });
        }
        if (tabela === 'notificacoes' && body?.chave && tabelas.notificacoes.some(n => n.chave === body.chave && String(n.usuario_id) === String(body.usuario_id))) {
          return responder(500, { error: 'Erro no INSERT', detalhe: 'duplicate key value violates unique constraint' });
        }
        const linha = { id: Math.max(0, ...tabelas[tabela].map(r => Number(r.id) || 0)) + 1 };
        for (const c of colunas) if (body?.[c] !== undefined && c !== 'id') linha[c] = body[c];
        if (colunas.includes('criado_em') && !linha.criado_em) linha.criado_em = new Date(Date.now() + tabelas[tabela].length).toISOString();
        if (tabela === 'tarefas') {
          linha.status = linha.status || 'a_fazer';
          linha.prioridade = linha.prioridade || 'media';
          linha.tipo = linha.tipo || 'Tarefa';
          linha.origem = linha.origem || 'manual';
          linha.marcadores = linha.marcadores || [];
        }
        if (tabela === 'tarefa_participantes') linha.status = linha.status || 'pendente';
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
        return responder(200, { sucesso: true });
      }
      responder(405, { error: 'Método não suportado' });
    });
  });
  return { servidor, tabelas };
}

const MODULOS = [
  './apiHttpClient', './permissionsController', './permissionsRepository', './tarefasController', './tarefasServico',
  './historicoSocial', './historicoSocialController', './prospeccoesController', './notificacoesController', './clienteHistorico',
  './tarefasAcoes'
];

async function montar(dados) {
  const upstream = criarUpstream(dados);
  await new Promise(r => upstream.servidor.listen(0, '127.0.0.1', r));
  process.env.API_BASE_URL = `http://127.0.0.1:${upstream.servidor.address().port}`;
  for (const m of MODULOS) delete require.cache[require.resolve(m)];
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  // O vigia das ações de módulo, como no server.js, e um "módulo de pedidos" de mentira.
  app.use('/api', require('./tarefasAcoes').observar);
  app.put('/api/pedidos/:id/status', (req, res) => res.json({ success: true }));
  app.use('/api/tarefas', require('./tarefasController'));
  app.use('/api/prospeccoes', require('./prospeccoesController'));
  app.use('/api/notificacoes', require('./notificacoesController'));
  app.use('/api/historico-social', require('./historicoSocialController'));
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

const HOJE = require('./tarefasRegras').agoraEmBrasilia().dia;
const dia = n => require('./tarefasRegras').somarDias(HOJE, n);

/**
 * 1 Sup Admin; 2 Ana e 3 João vendedores (ver/criar/editar/excluir/convidar,
 * sem atribuir); 4 Carla perfil Admin (sem modelo: vale a natureza de
 * gestora); 5 Bia supervisora (Ver tarefas de outros: só as do João).
 */
function baseDados() {
  const vendedor = { modelo_id: 9, modulo_ativo: true, acao_view: true, acao_create: true, acao_edit: true, acao_delete: true, acao_assign: false, acao_calendar_view: true, acao_invite: true, acao_others_view: false, acao_stats: true, acao_export: true, acao_automations: false };
  return {
    usuarios: [
      { id: 1, nome: 'Henrique', perfil: 'Sup Admin', status: 'ativo', modelo_permissoes_id: null },
      { id: 2, nome: 'Ana', perfil: 'Vendedor', status: 'ativo', modelo_permissoes_id: 9 },
      { id: 3, nome: 'João', perfil: 'Vendedor', status: 'ativo', modelo_permissoes_id: 9 },
      { id: 4, nome: 'Carla', perfil: 'Admin', status: 'ativo', modelo_permissoes_id: null },
      { id: 5, nome: 'Bia', perfil: 'Supervisor', status: 'ativo', modelo_permissoes_id: 10 }
    ],
    modelos_permissoes: [{ id: 9, nome: 'Vendedor' }, { id: 10, nome: 'Supervisor' }],
    perm_tarefas: [{ id: 1, ...vendedor }, { id: 2, ...vendedor, modelo_id: 10, acao_others_view: true }],
    tarefas: [], tarefa_participantes: [], tarefa_checklist: [], tarefa_historico: [], tarefa_listas: [],
    tarefa_marcadores: [], tarefa_visibilidade: [{ id: 1, usuario_id: 5, alvo_id: 3 }],
    tarefa_automacoes: [
      { id: 1, chave: 'orcamento_enviado', nome: 'Orçamento enviado', ativa: true, dias: 3, titulo: 'Follow-up do orçamento {orcamento} — {cliente}', tipo: 'Follow-up', prioridade: 'alta' },
      { id: 2, chave: 'pedido_entregue', nome: 'Pós-venda', ativa: false, dias: 7, titulo: 'Pós-venda {pedido}', tipo: 'Ligação', prioridade: 'media' }
    ],
    notificacoes: [],
    clientes: [{ id: 7, nome_fantasia: 'Loja Boa', dono_cliente: 'Ana' }],
    cliente_interacoes: [], cliente_historico: [],
    prospeccoes: [{ id: 8, nome_fantasia: 'ACME', etapa: 'Qualificado', status: 'ativa', responsavel_id: 3, criado_por: 3, proximo_passo: null, proximo_passo_data: null, probabilidade: 50 }],
    prospeccao_interacoes: [], prospeccao_historico: [],
    historico_comentarios: [], historico_anexos: [],
    orcamentos: [{ id: 30, numero: 'ORC-30', cliente_id: 7 }],
    pedidos: [{ id: 40, numero: 'PED-40', cliente_id: 7 }]
  };
}

const avisosDe = (ctx, usuarioId, tipo) => ctx.tabelas.notificacoes.filter(n => n.usuario_id === usuarioId && (!tipo || n.tipo === tipo));

test('criar: vendedor cria para si; para outro só Admin/Sup Admin — e o outro é avisado', async () => {
  const ctx = await montar(baseDados());
  try {
    const minha = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Ligar para ACME', data: dia(1), hora: '10:00', tipo: 'Ligação', checklist: ['Separar catálogo', 'Ligar'] } });
    assert.strictEqual(minha.status, 201);
    const t = ctx.tabelas.tarefas.find(x => x.id === minha.json.id);
    assert.strictEqual(t.responsavel_id, 2);
    assert.strictEqual(t.criado_por, 2);
    assert.strictEqual(ctx.tabelas.tarefa_checklist.length, 2);
    assert.strictEqual(ctx.tabelas.tarefa_historico.filter(h => h.tarefa_id === t.id && h.acao === 'criou').length, 1);

    const outra = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Para o João', responsavel_id: 3 } });
    assert.strictEqual(outra.status, 403);

    const daChefe = await chamar(ctx.porta, '/api/tarefas', { usuario: 4, corpo: { titulo: 'Relatório mensal', responsavel_id: 3, data: dia(2) } });
    assert.strictEqual(daChefe.status, 201, 'perfil Admin atribui por natureza');
    const aviso = avisosDe(ctx, 3, 'tarefa_atribuida')[0];
    assert.match(aviso.mensagem, /Carla atribuiu: Relatório mensal/);
    assert.strictEqual(aviso.origem, 'tarefa');
  } finally {
    await ctx.encerrar();
  }
});

test('visibilidade: cada um vê as suas; Admin vê todas; a supervisora só as do João', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Da Ana', data: dia(0) } });
    const doJoao = await chamar(ctx.porta, '/api/tarefas', { usuario: 3, corpo: { titulo: 'Do João', data: dia(0) } });

    const ana = await chamar(ctx.porta, '/api/tarefas', { usuario: 2 });
    assert.deepStrictEqual(ana.json.tarefas.map(t => t.titulo), ['Da Ana']);
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${doJoao.json.id}`, { usuario: 2 })).status, 404, 'nem pelo id');
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas?usuario=3', { usuario: 2 })).status, 403);

    const carla = await chamar(ctx.porta, '/api/tarefas?usuario=todos', { usuario: 4 });
    assert.strictEqual(carla.json.tarefas.length, 2);

    const bia = await chamar(ctx.porta, '/api/tarefas?usuario=todos', { usuario: 5 });
    assert.deepStrictEqual(bia.json.tarefas.map(t => t.titulo), ['Do João']);
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas?usuario=2', { usuario: 5 })).status, 403);
    const contexto = await chamar(ctx.porta, '/api/tarefas/contexto', { usuario: 5 });
    assert.deepStrictEqual(contexto.json.visiveis.sort(), [3, 5]);
    assert.strictEqual(contexto.json.pode.ver_outros, true);
    assert.strictEqual(contexto.json.pode.atribuir, false);
  } finally {
    await ctx.encerrar();
  }
});

test('tarefa em conjunto: convite, aviso, aceitar (passa a mexer) e recusar', async () => {
  const ctx = await montar(baseDados());
  try {
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Montar proposta', data: dia(3), participantes: [3, 4], mensagem_convite: 'me ajuda?' } });
    const id = criada.json.id;
    assert.strictEqual(ctx.tabelas.tarefa_participantes.length, 2);
    const convite = avisosDe(ctx, 3, 'convite_tarefa')[0];
    assert.match(convite.mensagem, /Ana convidou você: Montar proposta/);

    const sino = await chamar(ctx.porta, '/api/notificacoes', { usuario: 3 });
    assert.strictEqual(sino.json.itens[0].convite_pendente, true);

    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${id}`, { usuario: 3, method: 'PUT', corpo: { titulo: 'x' } })).status, 403, 'antes de aceitar não mexe');
    const pendentes = await chamar(ctx.porta, '/api/tarefas/convites', { usuario: 3 });
    assert.strictEqual(pendentes.json.convites[0].convidado_por, 'Ana');

    const aceite = await chamar(ctx.porta, `/api/tarefas/${id}/convite`, { usuario: 3, corpo: { resposta: 'aceitar' } });
    assert.strictEqual(aceite.status, 200);
    assert.strictEqual(avisosDe(ctx, 2, 'convite_respondido')[0].titulo, 'Convite aceito');
    assert.ok(avisosDe(ctx, 3, 'convite_tarefa')[0].lida_em, 'o aviso do convite sai do não lido');
    assert.strictEqual((await chamar(ctx.porta, '/api/notificacoes', { usuario: 3 })).json.itens.find(n => n.tipo === 'convite_tarefa').convite_pendente, false);
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${id}`, { usuario: 3, method: 'PUT', corpo: { prioridade: 'alta' } })).status, 200);
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${id}/convite`, { usuario: 3, corpo: { resposta: 'recusar' } })).status, 409, 'já respondido');

    await chamar(ctx.porta, `/api/tarefas/${id}/convite`, { usuario: 4, corpo: { resposta: 'recusar' } });
    assert.strictEqual(ctx.tabelas.tarefa_participantes.find(p => p.usuario_id === 4).status, 'recusado');
  } finally {
    await ctx.encerrar();
  }
});

test('tarefa do cliente: histórico da ficha ao criar e concluir; concluída vira atividade', async () => {
  const ctx = await montar(baseDados());
  try {
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Visitar a loja', tipo: 'Visita', cliente_id: 7, data: dia(0) } });
    const id = criada.json.id;
    const criou = ctx.tabelas.cliente_historico.find(h => h.cliente_id === 7 && h.tipo === 'tarefa' && h.acao === 'criou');
    assert.strictEqual(criou.entidade, 'Tarefa — Visitar a loja');
    assert.strictEqual(criou.usuario_id, 2);

    const fim = await chamar(ctx.porta, `/api/tarefas/${id}/concluir`, { usuario: 2, corpo: { resultado: 'resposta_positiva', nota: 'Quer ver amostras' } });
    assert.strictEqual(fim.status, 200);
    const atividade = ctx.tabelas.cliente_interacoes[0];
    assert.deepStrictEqual([atividade.tipo, atividade.resumo, atividade.tarefa_id, atividade.detalhe], ['Visita', 'Visitar a loja', id, 'Resposta positiva — Quer ver amostras']);
    const t = ctx.tabelas.tarefas.find(x => x.id === id);
    assert.deepStrictEqual([t.status, t.resultado, t.interacao_origem, t.interacao_id], ['concluida', 'resposta_positiva', 'cliente', atividade.id]);
    assert.ok(ctx.tabelas.cliente_historico.some(h => h.acao === 'concluiu' && h.valor_novo === 'Resposta positiva — Quer ver amostras'));
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${id}/concluir`, { usuario: 2, corpo: {} })).status, 409);

    // A atividade gerada pela tarefa não aparece duas vezes na agenda.
    const agenda = await chamar(ctx.porta, `/api/tarefas/agenda?de=${dia(-1)}&ate=${dia(1)}`, { usuario: 2 });
    assert.strictEqual(agenda.json.tarefas.length, 1);
    assert.strictEqual(agenda.json.atividades.length, 0);

    const reaberta = await chamar(ctx.porta, `/api/tarefas/${id}/reabrir`, { usuario: 2, corpo: {} });
    assert.strictEqual(reaberta.status, 200);
    assert.strictEqual(ctx.tabelas.tarefas.find(x => x.id === id).status, 'a_fazer');
  } finally {
    await ctx.encerrar();
  }
});

test('repetida: concluir gera a próxima da série, com o checklist zerado', async () => {
  const ctx = await montar(baseDados());
  try {
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Relatório semanal', data: HOJE, recorrencia: { freq: 'semanal' }, checklist: ['Juntar números'] } });
    const id = criada.json.id;
    const item = ctx.tabelas.tarefa_checklist[0];
    await chamar(ctx.porta, `/api/tarefas/${id}/checklist/${item.id}`, { usuario: 2, method: 'PUT', corpo: { feito: true } });
    assert.strictEqual(ctx.tabelas.tarefa_checklist[0].feito, true);
    const fim = await chamar(ctx.porta, `/api/tarefas/${id}/concluir`, { usuario: 2, corpo: {} });
    assert.strictEqual(fim.json.serie_data, dia(7));
    const proxima = ctx.tabelas.tarefas.find(t => t.id === fim.json.serie_id);
    assert.deepStrictEqual([proxima.origem, proxima.serie_id, proxima.status, proxima.recorrencia.ocorrencia], ['recorrencia', id, 'a_fazer', 2]);
    const itens = ctx.tabelas.tarefa_checklist.filter(c => c.tarefa_id === proxima.id);
    assert.deepStrictEqual(itens.map(c => [c.texto, Boolean(c.feito)]), [['Juntar números', false]]);
  } finally {
    await ctx.encerrar();
  }
});

test('próximo passo da prospecção = tarefa: definir cria, concluir lá fecha aqui, concluir aqui limpa lá', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/prospeccoes/8/proximo-passo', { usuario: 1, method: 'PUT', corpo: { proximo_passo: 'Enviar catálogo', proximo_passo_data: dia(2) } });
    let espelho = ctx.tabelas.tarefas.filter(t => t.origem === 'proximo_passo');
    assert.strictEqual(espelho.length, 1);
    assert.deepStrictEqual([espelho[0].titulo, espelho[0].responsavel_id, espelho[0].prospeccao_id], ['Enviar catálogo', 3, 8]);

    // Arrastar a tarefa no calendário (o João, responsável) reagenda o passo lá.
    const mover = await chamar(ctx.porta, `/api/tarefas/${espelho[0].id}/mover`, { usuario: 3, method: 'PATCH', corpo: { data: dia(4) } });
    assert.strictEqual(mover.status, 200);
    assert.strictEqual(require('./tarefasRegras').diaISO(ctx.tabelas.prospeccoes.find(x => x.id === 8).proximo_passo_data), dia(4));
    assert.ok(ctx.tabelas.prospeccao_historico.some(h => h.campo === 'proximo_passo_data'), 'o histórico da prospecção conta a mudança');
    espelho = ctx.tabelas.tarefas.filter(t => t.origem === 'proximo_passo');
    assert.strictEqual(espelho.length, 1, 'a mesma tarefa, sem duplicar');

    // Concluir o passo lá conclui a tarefa aqui.
    await chamar(ctx.porta, '/api/prospeccoes/8/concluir-passo', { usuario: 1, corpo: { nota: 'Catálogo enviado', proximo_passo: 'Ligar para saber', proximo_passo_data: dia(6) } });
    const [velha, nova] = ctx.tabelas.tarefas.filter(t => t.origem === 'proximo_passo').sort((a, b) => a.id - b.id);
    assert.strictEqual(velha.status, 'concluida');
    assert.ok(velha.interacao_id, 'ligada à atividade do passo');
    assert.deepStrictEqual([nova.titulo, nova.status], ['Ligar para saber', 'a_fazer']);

    // Concluir a tarefa aqui (pelo João, o responsável) conclui o passo lá.
    const fim = await chamar(ctx.porta, `/api/tarefas/${nova.id}/concluir`, { usuario: 3, corpo: { resultado: 'atendeu', nota: 'Vai fechar' } });
    assert.strictEqual(fim.status, 200);
    const p = ctx.tabelas.prospeccoes.find(x => x.id === 8);
    assert.strictEqual(p.proximo_passo, null);
    const atividade = ctx.tabelas.prospeccao_interacoes.find(i => i.tarefa_id === nova.id);
    assert.deepStrictEqual([atividade.tipo, atividade.passo_planejado, atividade.detalhe], ['Atividade realizada', 'Ligar para saber', 'Falou com o cliente — Vai fechar']);
    assert.strictEqual(ctx.tabelas.tarefas.filter(t => t.origem === 'proximo_passo' && t.status === 'a_fazer').length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('avisos: atrasada avisa uma vez por dia; convite e prazo mudado pelo gestor também', async () => {
  const ctx = await montar(baseDados());
  try {
    await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Proposta atrasada', data: dia(-2) } });
    const um = await chamar(ctx.porta, '/api/tarefas/avisos', { usuario: 2, corpo: {} });
    assert.deepStrictEqual(um.json.novos.map(n => n.tipo), ['tarefa_atrasada']);
    const dois = await chamar(ctx.porta, '/api/tarefas/avisos', { usuario: 2, corpo: {} });
    assert.deepStrictEqual(dois.json.novos, []);
    assert.strictEqual(avisosDe(ctx, 2, 'tarefa_atrasada').length, 1);

    const daAna = ctx.tabelas.tarefas[0];
    await chamar(ctx.porta, `/api/tarefas/${daAna.id}/mover`, { usuario: 4, method: 'PATCH', corpo: { data: dia(1), titulo: 'ignorado no mover' } });
    assert.strictEqual(ctx.tabelas.tarefas[0].titulo, 'Proposta atrasada', 'mover só mexe em data/hora/duração/situação/ordem');
    assert.match(avisosDe(ctx, 2, 'tarefa_alterada')[0].mensagem, /Carla mudou o prazo/);
  } finally {
    await ctx.encerrar();
  }
});

test('excluir: por marca, só quem criou (sendo o responsável) ou gestor', async () => {
  const ctx = await montar(baseDados());
  try {
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Rascunho', participantes: [3] } });
    await chamar(ctx.porta, `/api/tarefas/${criada.json.id}/convite`, { usuario: 3, corpo: { resposta: 'aceitar' } });
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${criada.json.id}`, { usuario: 3, method: 'DELETE', corpo: {} })).status, 403);
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/${criada.json.id}`, { usuario: 2, method: 'DELETE', corpo: { motivo: 'duplicada' } })).status, 200);
    const t = ctx.tabelas.tarefas[0];
    assert.ok(t.excluida_em);
    assert.strictEqual(t.motivo_exclusao, 'duplicada');
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas', { usuario: 2 })).json.tarefas.length, 0);
  } finally {
    await ctx.encerrar();
  }
});

test('agenda: tarefas do período, atividades feitas fora de tarefa e marcos do histórico', async () => {
  const dados = baseDados();
  const agora = new Date().toISOString();
  dados.prospeccao_interacoes.push({ id: 1, prospeccao_id: 8, tipo: 'Ligação', data: agora, resumo: 'Liguei', usuario_id: 3 });
  dados.prospeccao_historico.push({ id: 1, prospeccao_id: 8, tipo: 'etapa', acao: 'moveu', entidade: 'Etapa do funil', valor_anterior: 'Novo', valor_novo: 'Qualificado', usuario_id: 3, criado_em: agora });
  dados.prospeccao_historico.push({ id: 2, prospeccao_id: 8, tipo: 'campo', acao: 'alterou', entidade: 'Site', usuario_id: 3, criado_em: agora });
  const ctx = await montar(dados);
  try {
    await chamar(ctx.porta, '/api/tarefas', { usuario: 3, corpo: { titulo: 'No período', data: HOJE } });
    await chamar(ctx.porta, '/api/tarefas', { usuario: 3, corpo: { titulo: 'Fora', data: dia(40) } });
    const r = await chamar(ctx.porta, `/api/tarefas/agenda?de=${dia(-3)}&ate=${dia(3)}`, { usuario: 3 });
    assert.deepStrictEqual(r.json.tarefas.map(t => t.titulo), ['No período']);
    assert.deepStrictEqual(r.json.atividades.map(a => [a.resumo, a.registro]), [['Liguei', 'ACME']]);
    assert.deepStrictEqual(r.json.marcos.map(m => [m.tipo, m.depois]), [['etapa', 'Qualificado']], 'edição de campo não é marco');
    const daAna = await chamar(ctx.porta, `/api/tarefas/agenda?de=${dia(-3)}&ate=${dia(3)}`, { usuario: 2 });
    assert.strictEqual(daAna.json.atividades.length + daAna.json.marcos.length + daAna.json.tarefas.length, 0, 'a Ana não vê a agenda do João');
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas/agenda', { usuario: 3 })).status, 400);
  } finally {
    await ctx.encerrar();
  }
});

test('comentar na tarefa: quem vê a tarefa comenta; criador, responsável e participantes recebem aviso', async () => {
  const dados = baseDados();
  dados.historico_comentarios = [];
  dados.historico_curtidas = [];
  dados.historico_comentario_versoes = [];
  dados.historico_anexos = [];
  COLUNAS.historico_comentarios = ['id', 'origem', 'registro_id', 'item_id', 'resposta_de', 'usuario_id', 'texto', 'criado_em', 'editado_em', 'excluido_em', 'excluido_por', 'motivo_exclusao'];
  const ctx = await montar(dados);
  try {
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 4, corpo: { titulo: 'Fechar ACME', responsavel_id: 3, participantes: [2] } });
    const id = criada.json.id;
    await chamar(ctx.porta, `/api/tarefas/${id}/convite`, { usuario: 2, corpo: { resposta: 'aceitar' } });
    const evento = ctx.tabelas.tarefa_historico.find(h => h.tarefa_id === id && h.acao === 'criou');

    // A Bia vê as tarefas do João (é dele): lê a linha do tempo.
    const daBia = await chamar(ctx.porta, `/api/historico-social/tarefa/${id}`, { usuario: 5 });
    assert.strictEqual(daBia.status, 200);
    assert.ok(daBia.json.itens.some(i => i.acao === 'criou'));

    const comentario = await chamar(ctx.porta, `/api/historico-social/tarefa/${id}/itens/${evento.id}/comentarios`, { usuario: 2, corpo: { texto: 'Já liguei para eles' } });
    assert.strictEqual(comentario.status, 201);
    assert.strictEqual(avisosDe(ctx, 3, 'comentario').length, 1, 'o responsável');
    assert.strictEqual(avisosDe(ctx, 4, 'comentario').length, 1, 'quem criou');
    assert.strictEqual(avisosDe(ctx, 2, 'comentario').length, 0, 'quem comentou não');
    assert.strictEqual(avisosDe(ctx, 3, 'comentario')[0].origem, 'tarefa');

    // Tarefa de outra pessoa, sem convite: fora.
    const daAna = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Particular' } });
    assert.strictEqual((await chamar(ctx.porta, `/api/historico-social/tarefa/${daAna.json.id}`, { usuario: 3 })).status, 403);
  } finally {
    await ctx.encerrar();
  }
});

test('Sup Admin escolhe de quem cada um vê as tarefas', async () => {
  const ctx = await montar(baseDados());
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas/visibilidade/5', { usuario: 4, method: 'PUT', corpo: { todos: true } })).status, 403, 'só o Sup Admin');
    await chamar(ctx.porta, '/api/tarefas/visibilidade/5', { usuario: 1, method: 'PUT', corpo: { alvos: [2, 3] } });
    assert.deepStrictEqual((await chamar(ctx.porta, '/api/tarefas/visibilidade/5', { usuario: 1 })).json, { todos: false, alvos: [2, 3] });
    await chamar(ctx.porta, '/api/tarefas/visibilidade/5', { usuario: 1, method: 'PUT', corpo: { todos: true } });
    assert.deepStrictEqual(ctx.tabelas.tarefa_visibilidade.map(l => [l.usuario_id, l.alvo_id ?? null]), [[5, null]]);
  } finally {
    await ctx.encerrar();
  }
});

test('automação: cria uma vez, com o título preenchido; regra desligada não cria', async () => {
  const ctx = await montar(baseDados());
  try {
    const S = require('./tarefasServico');
    const { createApiClient } = require('./apiHttpClient');
    const api = createApiClient({ headers: { authorization: `Bearer ${tokenDe(2)}` } });
    const contexto = { refId: 30, responsavelId: 2, usuarioId: 2, vinculos: { orcamento_id: 30, cliente_id: 7 }, valores: { orcamento: 'ORC-30', cliente: 'Loja Boa' } };
    const t = await S.criarTarefaAutomatica(api, 'orcamento_enviado', contexto);
    assert.strictEqual(t.titulo, 'Follow-up do orçamento ORC-30 — Loja Boa');
    assert.strictEqual(require('./tarefasRegras').diaISO(t.data), dia(3));
    assert.deepStrictEqual([t.origem, t.chave_origem, t.prioridade, t.orcamento_id, t.cliente_id], ['automacao', 'orcamento_enviado:30', 'alta', 30, 7]);
    assert.strictEqual(await S.criarTarefaAutomatica(api, 'orcamento_enviado', contexto), null, 'não repete');
    assert.strictEqual(await S.criarTarefaAutomatica(api, 'pedido_entregue', { refId: 40, usuarioId: 2 }), null, 'desligada');
    assert.strictEqual(ctx.tabelas.tarefas.length, 1);
    assert.ok(ctx.tabelas.cliente_historico.some(h => h.tipo === 'tarefa' && h.acao === 'criou'));
  } finally {
    await ctx.encerrar();
  }
});

test('listas pessoais, marcadores de todos, checklist e estatísticas', async () => {
  const ctx = await montar(baseDados());
  try {
    const lista = await chamar(ctx.porta, '/api/tarefas/listas', { usuario: 2, corpo: { nome: 'Clientes VIP', cor: '#ff8800' } });
    assert.strictEqual(lista.status, 201);
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas/listas', { usuario: 2, corpo: { nome: 'clientes vip' } })).status, 409);
    assert.strictEqual((await chamar(ctx.porta, `/api/tarefas/listas/${lista.json.id}`, { usuario: 3, method: 'PUT', corpo: { nome: 'x' } })).status, 403);
    const m1 = await chamar(ctx.porta, '/api/tarefas/marcadores', { usuario: 2, corpo: { nome: '#urgente' } });
    const m2 = await chamar(ctx.porta, '/api/tarefas/marcadores', { usuario: 3, corpo: { nome: 'Urgente' } });
    assert.strictEqual(m1.json.id, m2.json.id, 'o mesmo marcador para todos');
    const criada = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Com tudo', lista_id: lista.json.id, marcadores: [m1.json.id] } });
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas', { usuario: 3, corpo: { titulo: 'Na lista dos outros', lista_id: lista.json.id } })).status, 403);
    await chamar(ctx.porta, `/api/tarefas/${criada.json.id}/checklist`, { usuario: 2, corpo: { texto: 'Passo 1' } });
    const detalhe = await chamar(ctx.porta, `/api/tarefas/${criada.json.id}`, { usuario: 2 });
    assert.deepStrictEqual([detalhe.json.checklist.total, detalhe.json.itens_checklist[0].texto, detalhe.json.marcadores], [1, 'Passo 1', [m1.json.id]]);
    // Excluir o marcador tira ele das tarefas.
    await chamar(ctx.porta, `/api/tarefas/marcadores/${m1.json.id}`, { usuario: 2, method: 'DELETE', corpo: {} });
    assert.deepStrictEqual(ctx.tabelas.tarefas[0].marcadores, []);
    await chamar(ctx.porta, `/api/tarefas/${criada.json.id}/concluir`, { usuario: 2, corpo: {} });
    const est = await chamar(ctx.porta, '/api/tarefas/estatisticas', { usuario: 2 });
    assert.strictEqual(est.json.concluidas, 1);
    const resumo = await chamar(ctx.porta, '/api/tarefas/resumo', { usuario: 2 });
    assert.strictEqual(resumo.json.concluidas_hoje, 1);
  } finally {
    await ctx.encerrar();
  }
});

test('sem o SQL: as telas recebem sql_pendente em vez de erro', async () => {
  const dados = baseDados();
  for (const t of ['tarefas', 'tarefa_participantes', 'tarefa_listas', 'tarefa_checklist', 'tarefa_historico', 'tarefa_marcadores', 'tarefa_visibilidade', 'tarefa_automacoes']) delete dados[t];
  const ctx = await montar(dados);
  try {
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas', { usuario: 2 })).json.sql_pendente, true);
    assert.strictEqual((await chamar(ctx.porta, '/api/tarefas/contexto', { usuario: 2 })).json.sql_pendente, true);
    const criar = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'x' } });
    assert.strictEqual(criar.status, 409);
    assert.strictEqual(criar.json.sql_pendente, true);
    // A prospecção continua funcionando sem as tarefas.
    const passo = await chamar(ctx.porta, '/api/prospeccoes/8/proximo-passo', { usuario: 1, method: 'PUT', corpo: { proximo_passo: 'Ligar', proximo_passo_data: dia(1) } });
    assert.strictEqual(passo.status, 200);
  } finally {
    await ctx.encerrar();
  }
});

// ---------------------------------------------------------------------------
// Ação de outro módulo (18/09/2026, 2ª rodada): a tarefa cobra "Despachar o
// pedido" e conclui sozinha quando alguém despacha — seja quem for.
// ---------------------------------------------------------------------------

test('ação de módulo: só vale o que o responsável pode fazer, e a tarefa conclui quando a ação acontece', async () => {
  const ctx = await montar(baseDados());
  try {
    // O catálogo marca o que cada um pode (a vendedora não despacha pedido).
    const minhas = await chamar(ctx.porta, '/api/tarefas/acoes');
    assert.strictEqual(minhas.status, 200);
    assert.ok(minhas.json.acoes.find(a => a.chave === 'pedido.despachar').pode, 'Sup Admin pode tudo');
    const daAna = await chamar(ctx.porta, '/api/tarefas/acoes?responsavel=2');
    assert.strictEqual(daAna.json.acoes.find(a => a.chave === 'pedido.despachar').pode, false);

    const semPermissao = await chamar(ctx.porta, '/api/tarefas', { usuario: 2, corpo: { titulo: 'Despachar', acao_chave: 'pedido.despachar', acao_registro: 40 } });
    assert.strictEqual(semPermissao.status, 400, 'a vendedora não cria tarefa que cobra o que ela não pode fazer');
    assert.match(semPermissao.json.error, /permissão/);

    const semRegistro = await chamar(ctx.porta, '/api/tarefas', { corpo: { titulo: 'Despachar', acao_chave: 'pedido.despachar' } });
    assert.strictEqual(semRegistro.status, 400);
    assert.match(semRegistro.json.error, /o pedido/);

    const criada = await chamar(ctx.porta, '/api/tarefas', { corpo: { titulo: 'Despachar o PED-40', acao_chave: 'pedido.despachar', acao_registro: 40, acao_rotulo: 'PED-40 — Loja Boa' } });
    assert.strictEqual(criada.status, 201);
    const t = ctx.tabelas.tarefas.find(x => x.id === criada.json.id);
    assert.strictEqual(t.acao_registro, '40');
    assert.strictEqual(t.pedido_id, 40, 'o pedido da ação vira o vínculo da tarefa');
    const tela = await chamar(ctx.porta, `/api/tarefas/${t.id}`);
    assert.strictEqual(tela.json.acao.rotulo, 'Despachar o pedido (Enviado)');
    assert.strictEqual(tela.json.acao.registroRotulo, 'PED-40 — Loja Boa');

    // Outro status do mesmo pedido não conta; "Enviado" (feito pelo João) conclui.
    await chamar(ctx.porta, '/api/pedidos/40/status', { usuario: 3, method: 'PUT', corpo: { status: 'Produção' } });
    await new Promise(r => setTimeout(r, 150));
    assert.strictEqual(t.status, 'a_fazer');
    await chamar(ctx.porta, '/api/pedidos/40/status', { usuario: 3, method: 'PUT', corpo: { status: 'Enviado' } });
    for (let i = 0; i < 40 && t.status !== 'concluida'; i++) await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(t.status, 'concluida');
    assert.match(t.resultado_nota, /João despachou o pedido \(PED-40 — Loja Boa\)/);
    assert.strictEqual(avisosDe(ctx, 1, 'acao_concluida').length, 1, 'quem criou e responde é avisado');
    assert.strictEqual(avisosDe(ctx, 3, 'acao_concluida').length, 0, 'quem fez a ação não');
  } finally {
    await ctx.encerrar();
  }
});
