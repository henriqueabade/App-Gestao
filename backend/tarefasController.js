/**
 * Tarefas e Calendário (/api/tarefas).
 *
 *   GET    /contexto                 quem sou, o que posso, usuários, listas, marcadores, convites
 *   GET    /                         as tarefas que vejo (?usuario=eu|todos|<id>, ?cliente_id, ?prospeccao_id, ?concluidas=1)
 *   GET    /agenda                   o calendário de [de, ate]: tarefas, atividades realizadas e marcos do histórico
 *   GET    /resumo                   "Meu dia"
 *   GET    /estatisticas             números do período
 *   GET    /convites                 convites de tarefa em conjunto esperando resposta
 *   GET    /buscar-vinculos?q=       clientes, prospecções, orçamentos e pedidos para ligar à tarefa
 *   POST   /avisos                   gera os lembretes e atrasos devidos (o sino chama a cada minuto)
 *   POST   /                         cria (participantes: convida; checklist: itens iniciais)
 *   GET    /:id                      a tarefa inteira (checklist, participantes, vínculos)
 *   PUT    /:id                      edita (PATCH /:id/mover: arrastar no calendário e no quadro)
 *   POST   /:id/concluir             { resultado, nota, proxima } — gera a atividade e a próxima da série
 *   POST   /:id/reabrir
 *   DELETE /:id                      exclusão por marca
 *   POST   /:id/checklist | PUT/DELETE /:id/checklist/:itemId
 *   POST   /:id/participantes        convidar | POST /:id/convite { resposta: aceitar|recusar } | DELETE /:id/participantes/:usuarioId
 *   listas, marcadores, visibilidade (Sup Admin) e automações
 *
 * Quem vê o quê (backend/tarefasRegras.js): cada um vê as próprias tarefas
 * (criou, responde ou participa); Admin e Sup Admin veem todas; quem tem
 * "Ver tarefas de outros usuários" vê as das pessoas escolhidas pelo Sup
 * Admin na ficha do usuário. Criar para outra pessoa: Admin, Sup Admin ou
 * quem tem "Atribuir tarefa"; os demais convidam, e o convidado aceita.
 */

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { obterPermissoesEfetivas, carregarUsuarioAtual, exigirSupAdmin } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const R = require('./tarefasRegras');
const S = require('./tarefasServico');
const social = require('./historicoSocial');
const acoes = require('./tarefasAcoes');

const router = express.Router();
const { erro } = R;
const lista = r => (Array.isArray(r) ? r : []);
const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const mesmoId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const agoraISO = () => new Date().toISOString();

// ------------------------------------------------------------ contexto

async function montarContexto(req) {
  if (req.ctxTarefas) return req.ctxTarefas;
  const api = createApiClient(req);
  const usuarioId = usuarioDaRequisicao(req);
  if (!usuarioId) throw erro(401, 'Sessão sem usuário.');
  const [usuario, permissoes] = await Promise.all([carregarUsuarioAtual(req), obterPermissoesEfetivas(req)]);
  const gestor = R.ehGestor(usuario);
  const supAdmin = permissoesRepo.isSupAdmin(usuario);
  const pode = chave => gestor || permissoesRepo.can(permissoes, chave);
  let linhas = [];
  if (!gestor && pode('tarefas.others.view')) {
    linhas = lista(await api.get('/api/tarefa_visibilidade', { query: { usuario_id: usuarioId } }).catch(() => []));
  }
  const escopo = R.escopoDeVisao({ usuario: { ...(usuario || {}), id: Number(usuarioId) }, permissaoVerOutros: pode('tarefas.others.view'), linhas });
  req.ctxTarefas = { api, usuarioId: Number(usuarioId), usuario, gestor, supAdmin, pode, escopo };
  return req.ctxTarefas;
}

/** Middleware: precisa de TODAS as chaves (Admin e Sup Admin passam sempre). */
function precisa(...chaves) {
  return async (req, res, next) => {
    try {
      const ctx = await montarContexto(req);
      const negada = chaves.find(c => !ctx.pode(c));
      if (negada) return res.status(403).json({ error: 'Permissão negada', code: 'FORBIDDEN', permissao: negada });
      return next();
    } catch (err) {
      return responderErro(res, err, 'contexto');
    }
  };
}

function responderErro(res, err, onde) {
  if (social.semTabela(err)) {
    return res.status(409).json({ error: 'Tarefas ainda não ativadas: rode sql/tarefas_calendario.sql e reinicie a API.', sql_pendente: true });
  }
  if (!err?.status || err.status >= 500) console.error(`[tarefas] ${onde}:`, err);
  return res.status(err?.status || 500).json({ error: err?.message || 'Erro nas tarefas.' });
}

// ------------------------------------------------------------ leitura

async function lerBase(ctx) {
  const [tarefas, participantes] = await Promise.all([
    ctx.api.get('/api/tarefas'),
    ctx.api.get('/api/tarefa_participantes').catch(() => [])
  ]);
  return { tarefas: lista(tarefas), participantes: lista(participantes) };
}

const visiveis = (ctx, base) => base.tarefas.filter(t => R.podeVerTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes: base.participantes }));

/** A tarefa e os participantes; 404 se não existe ou não é visível. */
async function carregarTarefa(ctx, id) {
  const t = await ctx.api.get(`/api/tarefas/${Number(id)}`).catch(err => {
    if (social.semTabela(err)) throw err;
    return null;
  });
  if (!t || t.error) throw erro(404, 'Tarefa não encontrada.');
  const participantes = lista(await ctx.api.get('/api/tarefa_participantes', { query: { tarefa_id: t.id } }).catch(() => []));
  if (!R.podeVerTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes })) throw erro(404, 'Tarefa não encontrada.');
  return { t, participantes };
}

/** Nomes de clientes, prospecções, orçamentos e pedidos que aparecem nas tarefas. */
async function nomesDosVinculos(api, tarefas) {
  const precisa = campo => tarefas.some(t => t[campo]);
  const [clientes, prospeccoes, orcamentos, pedidos] = await Promise.all([
    precisa('cliente_id') ? api.get('/api/clientes').catch(() => []) : [],
    precisa('prospeccao_id') ? api.get('/api/prospeccoes').catch(() => []) : [],
    precisa('orcamento_id') ? api.get('/api/orcamentos').catch(() => []) : [],
    precisa('pedido_id') ? api.get('/api/pedidos').catch(() => []) : []
  ]);
  const mapa = new Map();
  for (const c of lista(clientes)) mapa.set(`cliente_id:${c.id}`, c.nome_fantasia || c.razao_social || `Cliente #${c.id}`);
  for (const p of lista(prospeccoes)) mapa.set(`prospeccao_id:${p.id}`, p.nome_fantasia || `Prospecção #${p.id}`);
  for (const o of lista(orcamentos)) mapa.set(`orcamento_id:${o.id}`, o.numero || `#${o.id}`);
  for (const p of lista(pedidos)) mapa.set(`pedido_id:${p.id}`, p.numero || `#${p.id}`);
  return mapa;
}

function vinculosDe(t, nomesVinculos) {
  const saida = [];
  const pares = [['cliente_id', 'cliente'], ['prospeccao_id', 'prospeccao'], ['orcamento_id', 'orcamento'], ['pedido_id', 'pedido']];
  for (const [campo, tipo] of pares) {
    if (t[campo]) saida.push({ tipo, id: Number(t[campo]), nome: nomesVinculos.get(`${campo}:${t[campo]}`) || `#${t[campo]}` });
  }
  return saida;
}

/** As tarefas prontas para a tela: nomes, vínculos, contagens e o que eu posso fazer. */
async function paraTela(ctx, tarefas, participantes, { detalhe = false } = {}) {
  const { api } = ctx;
  const ids = new Set(tarefas.map(t => String(t.id)));
  const [nomes, nomesVinculos, checklist, comentarios, anexos] = await Promise.all([
    social.nomesDosUsuarios(api),
    nomesDosVinculos(api, tarefas),
    tarefas.length ? api.get('/api/tarefa_checklist').catch(() => []) : [],
    tarefas.length ? api.get('/api/historico_comentarios', { query: { origem: 'tarefa' } }).catch(() => []) : [],
    tarefas.length ? api.get('/api/historico_anexos', { query: { origem: 'tarefa' } }).catch(() => []) : []
  ]);
  const contar = (linhas, filtro = () => true) => {
    const m = new Map();
    for (const l of lista(linhas)) {
      const chave = String(l.tarefa_id ?? l.registro_id);
      if (!ids.has(chave) || !filtro(l)) continue;
      m.set(chave, (m.get(chave) || 0) + 1);
    }
    return m;
  };
  const itens = lista(checklist).filter(c => ids.has(String(c.tarefa_id)));
  const feitos = contar(itens, c => c.feito);
  const total = contar(itens);
  const nComentarios = contar(comentarios, c => !c.excluido_em);
  const nAnexos = contar(anexos, a => a.completo && !a.excluido_em);
  const agora = new Date();

  return tarefas.map(t => {
    const meus = participantes.filter(p => mesmoId(p.tarefa_id, t.id) && ['pendente', 'aceito'].includes(p.status));
    const eu = { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes };
    const saida = {
      id: t.id, titulo: t.titulo, descricao: t.descricao || null, tipo: t.tipo, status: t.status, prioridade: t.prioridade,
      data: R.diaISO(t.data) || null, hora: R.horaHHMM(t.hora) || null, duracao_min: t.duracao_min ?? null,
      lembrete_min: t.lembrete_min ?? null, local: t.local || null,
      responsavel_id: t.responsavel_id ?? null, responsavel: t.responsavel_id ? nomes.get(Number(t.responsavel_id)) || null : null,
      criado_por: t.criado_por ?? null, criado_por_nome: t.criado_por ? nomes.get(Number(t.criado_por)) || null : null,
      lista_id: t.lista_id ?? null, marcadores: lista(t.marcadores).map(Number),
      vinculos: vinculosDe(t, nomesVinculos),
      cliente_id: t.cliente_id ?? null, prospeccao_id: t.prospeccao_id ?? null, orcamento_id: t.orcamento_id ?? null, pedido_id: t.pedido_id ?? null,
      origem: t.origem, recorrencia: t.recorrencia || null, recorrencia_texto: R.descreverRecorrencia(t.recorrencia) || null,
      serie_id: t.serie_id ?? null, ordem: Number(t.ordem) || 0,
      resultado: t.resultado || null, resultado_texto: R.RESULTADOS[t.resultado] || null, resultado_nota: t.resultado_nota || null,
      concluida_em: t.concluida_em || null, concluida_por_nome: t.concluida_por ? nomes.get(Number(t.concluida_por)) || null : null,
      excluida: Boolean(t.excluida_em),
      participantes: meus.map(p => ({ usuario_id: p.usuario_id, nome: nomes.get(Number(p.usuario_id)) || `#${p.usuario_id}`, status: p.status })),
      minha_participacao: R.participacao(participantes, t.id, ctx.usuarioId),
      checklist: { feitos: feitos.get(String(t.id)) || 0, total: total.get(String(t.id)) || 0 },
      comentarios: nComentarios.get(String(t.id)) || 0,
      anexos: nAnexos.get(String(t.id)) || 0,
      atrasada: R.atrasada(t, agora),
      grupo: R.grupoDoPrazo(t, agora),
      // A ação de outro módulo que esta tarefa cobra (conclui sozinha quando acontece).
      acao: t.acao_chave ? { ...acoes.descreverAcao(t.acao_chave, t.acao_rotulo), registro: t.acao_registro ?? null } : null,
      criado_em: t.criado_em, atualizado_em: t.atualizado_em,
      pode: {
        editar: ctx.pode('tarefas.edit') && R.podeMexerNaTarefa(t, eu),
        concluir: R.podeMexerNaTarefa(t, eu),
        excluir: ctx.pode('tarefas.delete') && R.podeExcluirTarefa(t, eu),
        convidar: ctx.pode('tarefas.invite') && R.podeMexerNaTarefa(t, eu),
        atribuir: ctx.pode('tarefas.assign')
      }
    };
    if (detalhe) {
      saida.itens_checklist = itens.filter(c => mesmoId(c.tarefa_id, t.id))
        .sort((a, b) => Number(a.ordem) - Number(b.ordem) || Number(a.id) - Number(b.id))
        .map(c => ({ id: c.id, texto: c.texto, feito: Boolean(c.feito), feito_por: c.feito_por ? nomes.get(Number(c.feito_por)) || null : null, feito_em: c.feito_em || null }));
      saida.todos_participantes = participantes.filter(p => mesmoId(p.tarefa_id, t.id))
        .map(p => ({ usuario_id: p.usuario_id, nome: nomes.get(Number(p.usuario_id)) || `#${p.usuario_id}`, status: p.status, convidado_por: p.convidado_por ? nomes.get(Number(p.convidado_por)) || null : null, mensagem: p.mensagem || null }));
    }
    return saida;
  });
}

/** Acesso de leitura a uma tarefa (usado pelo histórico social, origem 'tarefa'). */
async function acessoATarefa(req, id) {
  const ctx = await montarContexto(req);
  if (!ctx.pode('tarefas.view')) return false;
  try {
    await carregarTarefa(ctx, id);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

// ------------------------------------------------------------ contexto da tela

router.get('/contexto', async (req, res) => {
  try {
    const ctx = await montarContexto(req);
    const { api } = ctx;
    const [usuarios, listas, marcadores, participantes, automacoes] = await Promise.all([
      api.get('/api/usuarios').catch(() => []),
      api.get('/api/tarefa_listas', { query: { usuario_id: ctx.usuarioId } }).catch(err => { if (social.semTabela(err)) throw err; return []; }),
      api.get('/api/tarefa_marcadores').catch(() => []),
      api.get('/api/tarefa_participantes', { query: { usuario_id: ctx.usuarioId } }).catch(() => []),
      ctx.pode('tarefas.automations') ? api.get('/api/tarefa_automacoes').catch(() => []) : []
    ]);
    const ativos = lista(usuarios).filter(u => !u.status || u.status === 'ativo');
    const eu = ativos.find(u => mesmoId(u.id, ctx.usuarioId)) || lista(usuarios).find(u => mesmoId(u.id, ctx.usuarioId));
    const vejo = ativos.filter(u => mesmoId(u.id, ctx.usuarioId) || R.podeVerUsuario(ctx.escopo, ctx.usuarioId, u.id)).map(u => Number(u.id));
    let municipio = null;
    try {
      const cfg = await require('./fiscal/configuracaoFiscal').carregar(api);
      if (cfg?.municipio) municipio = { codigo: cfg.codigo_municipio || null, nome: cfg.municipio, uf: cfg.uf || null };
    } catch (_) { /* sem configuração fiscal, só feriados nacionais */ }
    res.json({
      eu: { id: ctx.usuarioId, nome: eu?.nome || null, gestor: ctx.gestor, sup_admin: ctx.supAdmin },
      pode: {
        ver: ctx.pode('tarefas.view'), criar: ctx.pode('tarefas.create'), editar: ctx.pode('tarefas.edit'),
        excluir: ctx.pode('tarefas.delete'), atribuir: ctx.pode('tarefas.assign'), convidar: ctx.pode('tarefas.invite'),
        calendario: ctx.pode('tarefas.calendar.view'), ver_outros: ctx.gestor || ctx.escopo.todos || ctx.escopo.alvos.size > 0,
        estatisticas: ctx.pode('tarefas.stats'), exportar: ctx.pode('tarefas.export'), automacoes: ctx.pode('tarefas.automations')
      },
      usuarios: ativos.map(u => ({ id: Number(u.id), nome: u.nome, perfil: u.perfil || null })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
      visiveis: vejo,
      listas: lista(listas).sort((a, b) => Number(a.ordem) - Number(b.ordem) || Number(a.id) - Number(b.id)),
      marcadores: lista(marcadores).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
      convites: lista(participantes).filter(p => p.status === 'pendente').length,
      automacoes: lista(automacoes).sort((a, b) => Number(a.id) - Number(b.id)),
      tipos: R.TIPOS, prioridades: R.PRIORIDADES, resultados: R.RESULTADOS,
      hoje: R.agoraEmBrasilia().dia,
      municipio
    });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ sql_pendente: true, eu: { id: usuarioDaRequisicao(req) }, pode: {}, usuarios: [], listas: [], marcadores: [], visiveis: [] });
    responderErro(res, err, 'contexto');
  }
});

// ------------------------------------------------------------ listagens

/** Filtro de pessoa: 'eu' (padrão), 'todos' (tudo que vejo) ou o id de alguém que vejo. */
function filtroDePessoa(ctx, valor, participantes) {
  const alvo = texto(valor) || 'eu';
  if (alvo === 'todos') return () => true;
  const id = alvo === 'eu' ? ctx.usuarioId : Number(alvo);
  if (!R.podeVerUsuario(ctx.escopo, ctx.usuarioId, id) && !ctx.gestor) throw erro(403, 'Você não tem acesso às tarefas desta pessoa.');
  return t => mesmoId(t.responsavel_id, id) || (id === ctx.usuarioId && (mesmoId(t.criado_por, id) || R.participacao(participantes, t.id, id)))
    || (id !== ctx.usuarioId && R.participacao(participantes, t.id, id) === 'aceito');
}

router.get('/', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const base = await lerBase(ctx);
    const deQuem = req.query.cliente_id || req.query.prospeccao_id ? () => true : filtroDePessoa(ctx, req.query.usuario, base.participantes);
    const hoje = R.agoraEmBrasilia().dia;
    const limiteConcluidas = R.somarDias(hoje, -Number(req.query.dias_concluidas || 60));
    const tarefas = visiveis(ctx, base)
      .filter(t => !t.excluida_em)
      .filter(deQuem)
      .filter(t => !req.query.cliente_id || mesmoId(t.cliente_id, req.query.cliente_id))
      .filter(t => !req.query.prospeccao_id || mesmoId(t.prospeccao_id, req.query.prospeccao_id))
      .filter(t => R.ABERTOS.has(t.status) || (req.query.concluidas !== '0' && t.concluida_em && String(t.concluida_em).slice(0, 10) >= limiteConcluidas) || (t.status === 'cancelada' && req.query.canceladas === '1'))
      .sort(R.compararTarefas);
    res.json({ tarefas: await paraTela(ctx, tarefas, base.participantes), hoje });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ tarefas: [], sql_pendente: true });
    responderErro(res, err, 'listar');
  }
});

/** Um instante (timestamptz) → { dia, hora } de Brasília. */
function diaEHora(instante) {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return { dia: null, hora: null };
  const { dia, minutos } = R.agoraEmBrasilia(d);
  return { dia, hora: `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}` };
}

const TIPOS_MARCO = new Set(['etapa', 'orcamento', 'conversao', 'arquivamento']);

router.get('/agenda', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const de = R.diaISO(req.query.de);
    const ate = R.diaISO(req.query.ate);
    if (!de || !ate || de > ate) throw erro(400, 'Informe o período (de, ate).');
    if (R.diasEntre(de, ate) > 400) throw erro(400, 'Período grande demais (até 400 dias).');
    const camadas = new Set(String(req.query.camadas || 'tarefas,atividades,marcos').split(',').map(s => s.trim()));
    const base = await lerBase(ctx);
    const deQuem = filtroDePessoa(ctx, req.query.usuario, base.participantes);
    const noPeriodo = dia => dia && dia >= de && dia <= ate;

    let tarefas = [];
    if (camadas.has('tarefas')) {
      tarefas = visiveis(ctx, base)
        .filter(t => !t.excluida_em && t.status !== 'cancelada')
        .filter(deQuem)
        .filter(t => noPeriodo(R.diaISO(t.data)) || (!R.diaISO(t.data) && t.concluida_em && noPeriodo(diaEHora(t.concluida_em).dia)));
    }

    // Quem fez a atividade/o marco precisa ser alguém cuja agenda eu vejo.
    const alvo = texto(req.query.usuario) || 'eu';
    const daPessoa = usuarioId => {
      if (alvo === 'todos') return ctx.gestor || R.podeVerUsuario(ctx.escopo, ctx.usuarioId, usuarioId);
      const id = alvo === 'eu' ? ctx.usuarioId : Number(alvo);
      return mesmoId(usuarioId, id);
    };

    const [nomes, pInter, cInter, pHist, cHist, prospeccoes, clientes] = await Promise.all([
      social.nomesDosUsuarios(api),
      camadas.has('atividades') ? api.get('/api/prospeccao_interacoes').catch(() => []) : [],
      camadas.has('atividades') ? api.get('/api/cliente_interacoes').catch(() => []) : [],
      camadas.has('marcos') ? api.get('/api/prospeccao_historico').catch(() => []) : [],
      camadas.has('marcos') ? api.get('/api/cliente_historico').catch(() => []) : [],
      camadas.has('atividades') || camadas.has('marcos') ? api.get('/api/prospeccoes').catch(() => []) : [],
      camadas.has('atividades') || camadas.has('marcos') ? api.get('/api/clientes').catch(() => []) : []
    ]);
    const nomeP = new Map(lista(prospeccoes).map(p => [String(p.id), p.nome_fantasia]));
    const nomeC = new Map(lista(clientes).map(c => [String(c.id), c.nome_fantasia]));

    const atividades = [];
    for (const [origem, linhas, coluna, nomesDe] of [['prospeccao', pInter, 'prospeccao_id', nomeP], ['cliente', cInter, 'cliente_id', nomeC]]) {
      for (const i of lista(linhas)) {
        if (i.tarefa_id) continue; // a tarefa concluída já aparece
        const { dia, hora } = diaEHora(i.data);
        if (!noPeriodo(dia) || !daPessoa(i.usuario_id)) continue;
        atividades.push({
          id: `${origem}-${i.id}`, origem, registro_id: i[coluna], registro: nomesDe.get(String(i[coluna])) || `#${i[coluna]}`,
          tipo: i.tipo, resumo: i.resumo, detalhe: i.detalhe || null, dia, hora, duracao_min: i.duracao_min ?? null,
          usuario_id: i.usuario_id ?? null, usuario: i.usuario_id ? nomes.get(Number(i.usuario_id)) || null : null
        });
      }
    }

    const marcos = [];
    for (const [origem, linhas, coluna, nomesDe] of [['prospeccao', pHist, 'prospeccao_id', nomeP], ['cliente', cHist, 'cliente_id', nomeC]]) {
      for (const h of lista(linhas)) {
        if (h.excluido_em || !TIPOS_MARCO.has(h.tipo)) continue;
        const { dia, hora } = diaEHora(h.criado_em);
        if (!noPeriodo(dia) || !daPessoa(h.usuario_id)) continue;
        marcos.push({
          id: `${origem}-${h.id}`, origem, registro_id: h[coluna], registro: nomesDe.get(String(h[coluna])) || `#${h[coluna]}`,
          tipo: h.tipo, acao: h.acao, titulo: h.entidade || h.tipo, antes: h.valor_anterior || null, depois: h.valor_novo || null,
          dia, hora, usuario_id: h.usuario_id ?? null, usuario: h.usuario_id ? nomes.get(Number(h.usuario_id)) || null : null
        });
      }
    }

    res.json({ de, ate, tarefas: await paraTela(ctx, tarefas, base.participantes), atividades, marcos });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ tarefas: [], atividades: [], marcos: [], sql_pendente: true });
    responderErro(res, err, 'agenda');
  }
});

router.get('/resumo', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const base = await lerBase(ctx);
    const convites = base.participantes.filter(p => mesmoId(p.usuario_id, ctx.usuarioId) && p.status === 'pendente').length;
    res.json(R.resumoDoDia(base.tarefas, { usuarioId: ctx.usuarioId, convites }));
  } catch (err) {
    if (social.semTabela(err)) return res.json({ hoje: 0, atrasadas: 0, concluidas_hoje: 0, convites: 0, proxima: null, sql_pendente: true });
    responderErro(res, err, 'resumo');
  }
});

router.get('/estatisticas', precisa('tarefas.view', 'tarefas.stats'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const base = await lerBase(ctx);
    const hoje = R.agoraEmBrasilia().dia;
    const de = R.diaISO(req.query.de) || R.somarDias(hoje, -55);
    const ate = R.diaISO(req.query.ate) || hoje;
    const deQuem = filtroDePessoa(ctx, req.query.usuario, base.participantes);
    const tarefas = visiveis(ctx, base).filter(deQuem);
    res.json(R.montarEstatisticas(tarefas, { de, ate, nomes: await social.nomesDosUsuarios(ctx.api) }));
  } catch (err) {
    responderErro(res, err, 'estatísticas');
  }
});

router.get('/convites', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const base = await lerBase(ctx);
    const meus = base.participantes.filter(p => mesmoId(p.usuario_id, ctx.usuarioId) && p.status === 'pendente');
    const tarefas = base.tarefas.filter(t => !t.excluida_em && R.ABERTOS.has(t.status) && meus.some(p => mesmoId(p.tarefa_id, t.id)));
    const nomes = await social.nomesDosUsuarios(ctx.api);
    const prontas = await paraTela(ctx, tarefas, base.participantes);
    res.json({
      convites: prontas.map(t => {
        const p = meus.find(x => mesmoId(x.tarefa_id, t.id));
        return { tarefa: t, convidado_por: p?.convidado_por ? nomes.get(Number(p.convidado_por)) || null : null, mensagem: p?.mensagem || null, convidado_em: p?.convidado_em || null };
      })
    });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ convites: [], sql_pendente: true });
    responderErro(res, err, 'convites');
  }
});

// ------------------------------------------------------------ ações de outros módulos

/** O que um usuário pode fazer (Admin e Sup Admin: tudo). Para conferir o responsável. */
async function permissoesDoUsuario(api, usuarioId) {
  const u = await api.get(`/api/usuarios/${Number(usuarioId)}`).catch(() => null);
  if (!u || u.error) return { pode: () => false, nome: null };
  if (R.ehGestor(u)) return { pode: () => true, nome: u.nome || null };
  const permissoes = await permissoesRepo.loadPermissionsForUsuario(api, u).catch(() => null);
  return { pode: chave => Boolean(permissoes) && permissoesRepo.can(permissoes, chave), nome: u.nome || null };
}

/**
 * O catálogo das ações, marcando o que o RESPONSÁVEL pode fazer — é ele quem
 * vai fazer (?responsavel=id; sem ele, quem está usando).
 */
router.get('/acoes', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const responsavel = Number(req.query.responsavel) || ctx.usuarioId;
    const { pode } = mesmoId(responsavel, ctx.usuarioId) ? { pode: ctx.pode } : await permissoesDoUsuario(ctx.api, responsavel);
    res.json(acoes.catalogo(pode));
  } catch (err) {
    responderErro(res, err, 'ações');
  }
});

/**
 * Confere a ação que a tela mandou: o responsável precisa poder fazê-la, e o
 * registro dela (pedido, orçamento…) vira também o vínculo da tarefa — assim
 * ela aparece na ficha do cliente/prospecção como qualquer outra.
 */
async function conferirAcao(ctx, dados, { responsavelId, atual = {} } = {}) {
  if (!dados.acao_chave) return;
  const acao = acoes.ACOES.find(a => a.chave === dados.acao_chave);
  const quem = mesmoId(responsavelId, ctx.usuarioId) ? { pode: ctx.pode, nome: null } : await permissoesDoUsuario(ctx.api, responsavelId);
  if (!quem.pode(acao.permissao)) {
    throw erro(400, `${quem.nome ? `${quem.nome} não tem` : 'Você não tem'} permissão para "${acao.rotulo}". Escolha outra ação ou outro responsável.`);
  }
  const tipo = acoes.MODULOS[acao.modulo].registro;
  if (tipo === 'competencia') return;
  const campo = `${tipo}_id`;
  if (!dados[campo] && !atual[campo]) {
    dados[campo] = Number(dados.acao_registro);
    await conferirVinculos(ctx.api, { [campo]: dados[campo] });
  }
}

/**
 * A ação aconteceu no módulo (tarefasAcoes.observar viu a rota dar certo):
 * conclui as tarefas abertas que a cobravam — seja quem for que fez —, com a
 * nota de quem fez e quando, a atividade na ficha, a próxima da série e o
 * aviso para quem acompanha.
 */
async function concluirPelaAcao(req, { chave, registro }) {
  const api = createApiClient(req);
  const usuarioId = Number(usuarioDaRequisicao(req)) || null;
  let abertas;
  try {
    abertas = lista(await api.get('/api/tarefas', { query: { acao_chave: chave, acao_registro: String(registro) } }));
  } catch (err) {
    if (social.semTabela(err)) return [];
    throw err;
  }
  abertas = abertas.filter(t => R.ABERTOS.has(t.status) && !t.excluida_em && t.acao_chave === chave && String(t.acao_registro) === String(registro));
  if (!abertas.length) return [];
  const nomes = await social.nomesDosUsuarios(api);
  const quem = nomes.get(usuarioId) || 'Alguém';
  const descricao = acoes.descreverAcao(chave);
  const concluidas = [];
  for (const t of abertas) {
    const alvo = t.acao_rotulo ? ` (${t.acao_rotulo})` : '';
    const nota = `Feito no módulo ${descricao.moduloRotulo}: ${quem} ${descricao.feito}${alvo}.`;
    let interacao = null;
    if (t.origem !== 'proximo_passo' && (t.prospeccao_id || t.cliente_id)) {
      interacao = await registrarAtividade(api, t, { resultado: 'feito', nota, usuarioId }).catch(() => null);
    }
    await S.concluirTarefa(api, t, { usuarioId, resultado: 'feito', nota, interacao, nomes, registrarFicha: true });
    const participantes = lista(await api.get('/api/tarefa_participantes', { query: { tarefa_id: t.id } }).catch(() => []));
    if (t.recorrencia) await criarProximaDaSerie({ api, usuarioId }, t, participantes, nomes).catch(() => null);
    const interessados = [t.criado_por, t.responsavel_id, ...participantes.filter(p => mesmoId(p.tarefa_id, t.id) && p.status === 'aceito').map(p => p.usuario_id)];
    const para = social.destinatarios(interessados, usuarioId);
    if (para.length) {
      await social.notificar(api, para, {
        tipo: 'acao_concluida', titulo: 'Tarefa concluída pelo módulo',
        mensagem: `${quem} ${descricao.feito}${alvo} — "${t.titulo}" foi concluída sozinha.`,
        origem: 'tarefa', registro_id: Number(t.id), autor_id: usuarioId
      });
    }
    concluidas.push(t.id);
  }
  return concluidas;
}

router.get('/buscar-vinculos', precisa('tarefas.view'), async (req, res) => {
  try {
    const { api } = req.ctxTarefas;
    const q = texto(req.query.q).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (q.length < 2) return res.json({ resultados: [] });
    // ?tipo=pedido: só pedidos (a "Ação no sistema" busca num módulo só).
    const soTipo = ['cliente', 'prospeccao', 'orcamento', 'pedido'].includes(req.query.tipo) ? req.query.tipo : null;
    const casa = (...campos) => campos.some(c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q));
    const digitos = q.replace(/\D/g, '');
    const [clientes, prospeccoes, orcamentos, pedidos] = await Promise.all([
      api.get('/api/clientes').catch(() => []), api.get('/api/prospeccoes').catch(() => []),
      api.get('/api/orcamentos').catch(() => []), api.get('/api/pedidos').catch(() => [])
    ]);
    const nomeCliente = new Map(lista(clientes).map(c => [String(c.id), c.nome_fantasia]));
    const nomeProsp = new Map(lista(prospeccoes).map(p => [String(p.id), p.nome_fantasia]));
    const resultados = [
      ...lista(clientes).filter(c => casa(c.nome_fantasia, c.razao_social) || (digitos.length >= 4 && String(c.cnpj || c.cpf || '').replace(/\D/g, '').includes(digitos)))
        .slice(0, 8).map(c => ({ tipo: 'cliente', id: c.id, nome: c.nome_fantasia, detalhe: c.razao_social || null })),
      ...lista(prospeccoes).filter(p => p.status !== 'arquivada' && casa(p.nome_fantasia, p.razao_social))
        .slice(0, 8).map(p => ({ tipo: 'prospeccao', id: p.id, nome: p.nome_fantasia, detalhe: p.etapa || null })),
      ...lista(orcamentos).filter(o => casa(o.numero) || casa(nomeCliente.get(String(o.cliente_id)), nomeProsp.get(String(o.prospeccao_id))))
        .slice(0, 6).map(o => ({ tipo: 'orcamento', id: o.id, nome: o.numero, detalhe: nomeCliente.get(String(o.cliente_id)) || nomeProsp.get(String(o.prospeccao_id)) || null, cliente_id: o.cliente_id || null, prospeccao_id: o.prospeccao_id || null })),
      ...lista(pedidos).filter(p => casa(p.numero) || casa(nomeCliente.get(String(p.cliente_id))))
        .slice(0, 6).map(p => ({ tipo: 'pedido', id: p.id, nome: p.numero || `#${p.id}`, detalhe: nomeCliente.get(String(p.cliente_id)) || null, cliente_id: p.cliente_id || null }))
    ];
    res.json({ resultados: soTipo ? resultados.filter(r => r.tipo === soTipo) : resultados });
  } catch (err) {
    responderErro(res, err, 'buscar vínculos');
  }
});

// ------------------------------------------------------------ listas e marcadores

const COR = /^#[0-9a-f]{6}$/i;

router.post('/listas', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const nome = texto(req.body?.nome).slice(0, 60);
    if (!nome) throw erro(400, 'Dê um nome à lista.');
    const cor = COR.test(req.body?.cor || '') ? req.body.cor : '#8aa7f3';
    const minhas = lista(await ctx.api.get('/api/tarefa_listas', { query: { usuario_id: ctx.usuarioId } }));
    if (minhas.some(l => texto(l.nome).toLowerCase() === nome.toLowerCase())) throw erro(409, 'Você já tem uma lista com este nome.');
    const criada = await ctx.api.post('/api/tarefa_listas', { nome, cor, icone: texto(req.body?.icone).slice(0, 40) || null, usuario_id: ctx.usuarioId, ordem: minhas.length + 1 });
    res.status(201).json(criada);
  } catch (err) {
    responderErro(res, err, 'lista');
  }
});

async function minhaLista(ctx, id) {
  const l = await ctx.api.get(`/api/tarefa_listas/${Number(id)}`).catch(() => null);
  if (!l || l.error) throw erro(404, 'Lista não encontrada.');
  if (!mesmoId(l.usuario_id, ctx.usuarioId)) throw erro(403, 'A lista é de outra pessoa.');
  return l;
}

router.put('/listas/:listaId', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const l = await minhaLista(ctx, req.params.listaId);
    const patch = {};
    if (req.body?.nome !== undefined) {
      patch.nome = texto(req.body.nome).slice(0, 60);
      if (!patch.nome) throw erro(400, 'Dê um nome à lista.');
    }
    if (req.body?.cor !== undefined && COR.test(req.body.cor)) patch.cor = req.body.cor;
    if (req.body?.ordem !== undefined && Number.isFinite(Number(req.body.ordem))) patch.ordem = Number(req.body.ordem);
    if (Object.keys(patch).length) await ctx.api.put(`/api/tarefa_listas/${l.id}`, patch);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'lista');
  }
});

router.delete('/listas/:listaId', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const l = await minhaLista(ctx, req.params.listaId);
    await ctx.api.delete(`/api/tarefa_listas/${l.id}`);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'lista');
  }
});

router.post('/marcadores', precisa('tarefas.create'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const nome = texto(req.body?.nome).replace(/^#/, '').slice(0, 40);
    if (!nome) throw erro(400, 'Dê um nome ao marcador.');
    const todos = lista(await ctx.api.get('/api/tarefa_marcadores'));
    const existente = todos.find(m => texto(m.nome).toLowerCase() === nome.toLowerCase());
    if (existente) return res.json(existente);
    const cor = COR.test(req.body?.cor || '') ? req.body.cor : '#d4c169';
    res.status(201).json(await ctx.api.post('/api/tarefa_marcadores', { nome, cor, criado_por: ctx.usuarioId }));
  } catch (err) {
    responderErro(res, err, 'marcador');
  }
});

async function marcadorParaMexer(ctx, id) {
  const m = await ctx.api.get(`/api/tarefa_marcadores/${Number(id)}`).catch(() => null);
  if (!m || m.error) throw erro(404, 'Marcador não encontrado.');
  if (!ctx.gestor && !mesmoId(m.criado_por, ctx.usuarioId)) throw erro(403, 'Só quem criou o marcador (ou Admin/Sup Admin) muda ou exclui.');
  return m;
}

router.put('/marcadores/:marcadorId', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const m = await marcadorParaMexer(ctx, req.params.marcadorId);
    const patch = {};
    if (req.body?.nome !== undefined) patch.nome = texto(req.body.nome).replace(/^#/, '').slice(0, 40) || m.nome;
    if (req.body?.cor !== undefined && COR.test(req.body.cor)) patch.cor = req.body.cor;
    if (Object.keys(patch).length) await ctx.api.put(`/api/tarefa_marcadores/${m.id}`, patch);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'marcador');
  }
});

router.delete('/marcadores/:marcadorId', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const m = await marcadorParaMexer(ctx, req.params.marcadorId);
    const comEle = lista(await ctx.api.get('/api/tarefas')).filter(t => lista(t.marcadores).map(Number).includes(Number(m.id)));
    for (const t of comEle) {
      await ctx.api.put(`/api/tarefas/${t.id}`, { marcadores: lista(t.marcadores).map(Number).filter(id => id !== Number(m.id)) });
    }
    await ctx.api.delete(`/api/tarefa_marcadores/${m.id}`);
    res.json({ success: true, tarefas: comEle.length });
  } catch (err) {
    responderErro(res, err, 'marcador');
  }
});

// ------------------------------------------------------------ visibilidade (Sup Admin)

router.get('/visibilidade/:usuarioId', exigirSupAdmin, async (req, res) => {
  try {
    const api = createApiClient(req);
    const linhas = lista(await api.get('/api/tarefa_visibilidade', { query: { usuario_id: Number(req.params.usuarioId) } }));
    res.json({
      todos: linhas.some(l => l.alvo_id === null || l.alvo_id === undefined),
      alvos: linhas.filter(l => l.alvo_id !== null && l.alvo_id !== undefined).map(l => Number(l.alvo_id))
    });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ todos: false, alvos: [], sql_pendente: true });
    responderErro(res, err, 'visibilidade');
  }
});

router.put('/visibilidade/:usuarioId', exigirSupAdmin, async (req, res) => {
  try {
    const api = createApiClient(req);
    const usuarioId = Number(req.params.usuarioId);
    const quem = usuarioDaRequisicao(req);
    const todos = Boolean(req.body?.todos);
    const alvos = todos ? [] : [...new Set(lista(req.body?.alvos).map(Number))].filter(id => Number.isInteger(id) && id > 0 && id !== usuarioId);
    const atuais = lista(await api.get('/api/tarefa_visibilidade', { query: { usuario_id: usuarioId } }));
    for (const l of atuais) await api.delete(`/api/tarefa_visibilidade/${l.id}`);
    if (todos) await api.post('/api/tarefa_visibilidade', { usuario_id: usuarioId, alvo_id: null, concedido_por: quem });
    for (const alvo of alvos) await api.post('/api/tarefa_visibilidade', { usuario_id: usuarioId, alvo_id: alvo, concedido_por: quem });
    res.json({ success: true, todos, alvos });
  } catch (err) {
    responderErro(res, err, 'visibilidade');
  }
});

// ------------------------------------------------------------ automações

router.get('/automacoes', precisa('tarefas.automations'), async (req, res) => {
  try {
    res.json({ automacoes: lista(await req.ctxTarefas.api.get('/api/tarefa_automacoes')).sort((a, b) => Number(a.id) - Number(b.id)) });
  } catch (err) {
    responderErro(res, err, 'automações');
  }
});

router.put('/automacoes/:chave', precisa('tarefas.automations'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const regra = lista(await ctx.api.get('/api/tarefa_automacoes', { query: { chave: req.params.chave } }))[0];
    if (!regra) throw erro(404, 'Regra não encontrada.');
    const patch = { atualizado_por: ctx.usuarioId, atualizado_em: agoraISO() };
    if (req.body?.ativa !== undefined) patch.ativa = Boolean(req.body.ativa);
    if (req.body?.dias !== undefined) {
      const dias = Number(req.body.dias);
      if (!Number.isInteger(dias) || dias < 0 || dias > 365) throw erro(400, 'Os dias vão de 0 a 365.');
      patch.dias = dias;
    }
    if (req.body?.titulo !== undefined) {
      patch.titulo = texto(req.body.titulo).slice(0, 200);
      if (!patch.titulo) throw erro(400, 'O título da tarefa não pode ficar vazio.');
    }
    if (req.body?.tipo !== undefined) {
      if (!R.TIPOS.includes(req.body.tipo)) throw erro(400, 'Tipo inválido.');
      patch.tipo = req.body.tipo;
    }
    if (req.body?.prioridade !== undefined) {
      if (!R.PRIORIDADES.includes(req.body.prioridade)) throw erro(400, 'Prioridade inválida.');
      patch.prioridade = req.body.prioridade;
    }
    await ctx.api.put(`/api/tarefa_automacoes/${regra.id}`, patch);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'automações');
  }
});

// ------------------------------------------------------------ avisos do sino

router.post('/avisos', async (req, res) => {
  try {
    const ctx = await montarContexto(req);
    if (!ctx.pode('tarefas.view')) return res.json({ novos: [] });
    const { api } = ctx;
    const base = await lerBase(ctx);
    const minhas = base.tarefas.filter(t => mesmoId(t.responsavel_id, ctx.usuarioId) || R.participacao(base.participantes, t.id, ctx.usuarioId) === 'aceito');
    const existentes = lista(await api.get('/api/notificacoes', { query: { usuario_id: ctx.usuarioId } }).catch(() => []));
    const jaEnviadas = new Set(existentes.map(n => n.chave).filter(Boolean));
    const devidos = R.avisosDevidos(minhas, { usuarioId: ctx.usuarioId, jaEnviadas });
    const novos = [];
    for (const aviso of devidos) {
      try {
        const criado = await api.post('/api/notificacoes', aviso);
        novos.push({ id: criado?.id ?? null, tipo: aviso.tipo, titulo: aviso.titulo, mensagem: aviso.mensagem, registro_id: aviso.registro_id });
      } catch (err) {
        // Outro computador do mesmo usuário gravou primeiro (índice único): tudo bem.
        if (!/duplicate|unique/i.test(`${err?.message} ${JSON.stringify(err?.body || {})}`)) console.warn('[tarefas] aviso não gravado:', err?.message || err);
      }
    }
    res.json({ novos });
  } catch (err) {
    if (social.semTabela(err)) return res.json({ novos: [], sql_pendente: true });
    responderErro(res, err, 'avisos');
  }
});

// ------------------------------------------------------------ vínculos

async function conferirVinculos(api, dados) {
  const pares = [['cliente_id', 'clientes', 'Cliente'], ['prospeccao_id', 'prospeccoes', 'Prospecção'], ['orcamento_id', 'orcamentos', 'Orçamento'], ['pedido_id', 'pedidos', 'Pedido']];
  for (const [campo, tabela, rotulo] of pares) {
    if (!dados[campo]) continue;
    const r = await api.get(`/api/${tabela}/${dados[campo]}`).catch(() => null);
    if (!r || r.error) throw erro(400, `${rotulo} não encontrado.`);
    // Orçamento e pedido trazem o cliente/prospecção junto, se a tela não mandou.
    if (campo === 'orcamento_id') {
      if (r.cliente_id && dados.cliente_id === undefined) dados.cliente_id = Number(r.cliente_id);
      if (r.prospeccao_id && dados.prospeccao_id === undefined && !r.cliente_id) dados.prospeccao_id = Number(r.prospeccao_id);
    }
    if (campo === 'pedido_id' && r.cliente_id && dados.cliente_id === undefined) dados.cliente_id = Number(r.cliente_id);
  }
}

async function conferirLista(api, listaId, usuarioId, gestor) {
  if (!listaId) return;
  const l = await api.get(`/api/tarefa_listas/${listaId}`).catch(() => null);
  if (!l || l.error) throw erro(400, 'Lista não encontrada.');
  if (!mesmoId(l.usuario_id, usuarioId) && !gestor) throw erro(403, 'A lista é de outra pessoa.');
}

// ------------------------------------------------------------ criar

router.post('/', precisa('tarefas.create'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const dados = R.normalizarTarefa(req.body || {});
    dados.responsavel_id = R.conferirResponsavel(dados.responsavel_id, { usuarioId: ctx.usuarioId, podeAtribuir: ctx.pode('tarefas.assign') });
    if (dados.status && !R.ABERTOS.has(dados.status)) delete dados.status;
    if (req.body?.acao_chave) {
      Object.assign(dados, acoes.normalizarAcao(req.body));
      await conferirAcao(ctx, dados, { responsavelId: dados.responsavel_id });
    }
    await conferirVinculos(api, dados);
    await conferirLista(api, dados.lista_id, ctx.usuarioId, ctx.gestor);
    const participantes = lista(req.body?.participantes).map(Number).filter(Boolean);
    if (participantes.length && !ctx.pode('tarefas.invite')) throw erro(403, 'Você não tem permissão para convidar pessoas para a tarefa.');
    const nomes = await social.nomesDosUsuarios(api);
    const t = await S.criarTarefa(api, { ...dados, status: dados.status || 'a_fazer', origem: 'manual' }, {
      usuarioId: ctx.usuarioId, nomes, participantes,
      checklist: lista(req.body?.checklist), mensagem: req.body?.mensagem_convite
    });
    res.status(201).json({ id: t.id });
  } catch (err) {
    responderErro(res, err, 'criar');
  }
});

// ------------------------------------------------------------ detalhe

router.get('/:id', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { t, participantes } = await carregarTarefa(ctx, req.params.id);
    const [pronta] = await paraTela(ctx, [t], participantes, { detalhe: true });
    res.json(pronta);
  } catch (err) {
    responderErro(res, err, 'detalhe');
  }
});

// ------------------------------------------------------------ editar

/** O próximo passo da prospecção acompanha a tarefa-espelho (título/data, ou some se cancelada). */
async function refletirNoPasso(ctx, t, dados) {
  if (t.origem !== 'proximo_passo' || !t.prospeccao_id) return;
  const pros = require('./prospeccoesController');
  if (dados.status === 'cancelada') {
    await pros.atualizarPassoPelaTarefa(ctx.api, t.prospeccao_id, { passo: null, data: null }, ctx.usuarioId);
    return;
  }
  if (!('titulo' in dados) && !('data' in dados)) return;
  await pros.atualizarPassoPelaTarefa(ctx.api, t.prospeccao_id, {
    passo: dados.titulo ?? t.titulo,
    data: 'data' in dados ? dados.data : R.diaISO(t.data)
  }, ctx.usuarioId);
}

async function editar(req, res, { mover = false } = {}) {
  const ctx = req.ctxTarefas;
  const { api } = ctx;
  const { t, participantes } = await carregarTarefa(ctx, req.params.id);
  const eu = { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes };
  if (!R.podeMexerNaTarefa(t, eu)) throw erro(403, 'Só quem criou, quem responde e quem participa mexem nesta tarefa.');

  const corpo = { ...(req.body || {}) };
  delete corpo.criado_por; delete corpo.origem; delete corpo.chave_origem; delete corpo.serie_id;
  const dados = R.normalizarTarefa({ ...corpo, __data_atual: R.diaISO(t.data) }, { parcial: true });
  if (dados.status === 'concluida') throw erro(400, 'Para concluir use "Concluir" (ele registra o resultado e a atividade).');
  if (dados.status && !R.ABERTOS.has(t.status) && dados.status !== t.status && t.status === 'concluida') throw erro(400, 'Para voltar uma tarefa concluída use "Reabrir".');
  if ('responsavel_id' in dados && !mesmoId(dados.responsavel_id, t.responsavel_id)) {
    dados.responsavel_id = R.conferirResponsavel(dados.responsavel_id, { usuarioId: ctx.usuarioId, podeAtribuir: ctx.pode('tarefas.assign') });
  }
  if ('lista_id' in dados) await conferirLista(api, dados.lista_id, ctx.usuarioId, ctx.gestor);
  if (Object.prototype.hasOwnProperty.call(corpo, 'acao_chave')) {
    if (t.origem === 'proximo_passo' && corpo.acao_chave) throw erro(400, 'O próximo passo da prospecção não cobra ação de outro módulo.');
    Object.assign(dados, acoes.normalizarAcao(corpo));
    await conferirAcao(ctx, dados, { responsavelId: dados.responsavel_id ?? t.responsavel_id, atual: t });
  }
  const vinculos = Object.fromEntries(['cliente_id', 'prospeccao_id', 'orcamento_id', 'pedido_id'].filter(c => c in dados).map(c => [c, dados[c]]));
  if (Object.keys(vinculos).length) await conferirVinculos(api, vinculos);
  if (req.body?.ordem !== undefined && Number.isFinite(Number(req.body.ordem))) dados.ordem = Number(req.body.ordem);
  if (!Object.keys(dados).length) return res.json({ success: true });

  // Tirar a data de uma tarefa com hora: a hora vai junto.
  if ('data' in dados && !dados.data) dados.hora = null;

  await api.put(`/api/tarefas/${t.id}`, { ...dados, atualizado_em: agoraISO() });
  const nomes = await social.nomesDosUsuarios(api);
  const nomesVinculos = await nomesDosVinculos(api, [{ ...t, ...dados }]);
  const listas = 'lista_id' in dados ? lista(await api.get('/api/tarefa_listas').catch(() => [])) : [];
  const marcadores = 'marcadores' in dados ? lista(await api.get('/api/tarefa_marcadores').catch(() => [])) : [];
  const eventos = R.diferencasDaTarefa(t, dados, {
    usuarios: nomes, vinculos: nomesVinculos,
    listas: new Map(listas.map(l => [Number(l.id), l.nome])), marcadores: new Map(marcadores.map(m => [Number(m.id), m.nome]))
  });
  if (mover && eventos.length) eventos.forEach(e => { e.observacao = e.observacao || 'Arrastada no calendário/quadro'; });
  await S.registrarNaTarefa(api, t.id, eventos, ctx.usuarioId);
  await refletirNoPasso(ctx, t, dados);

  const autor = nomes.get(ctx.usuarioId) || 'Alguém';
  if ('responsavel_id' in dados && dados.responsavel_id && !mesmoId(dados.responsavel_id, t.responsavel_id) && !mesmoId(dados.responsavel_id, ctx.usuarioId)) {
    await social.notificar(api, [dados.responsavel_id], {
      tipo: 'tarefa_atribuida', titulo: 'Nova tarefa para você',
      mensagem: `${autor} passou para você: ${dados.titulo || t.titulo} — ${S.prazoLegivel({ ...t, ...dados })}`,
      origem: 'tarefa', registro_id: Number(t.id), autor_id: ctx.usuarioId
    });
  } else if (('data' in dados || 'hora' in dados) && t.responsavel_id && !mesmoId(t.responsavel_id, ctx.usuarioId) && eventos.some(e => ['data', 'hora'].includes(e.campo))) {
    await social.notificar(api, [t.responsavel_id], {
      tipo: 'tarefa_alterada', titulo: 'Tarefa reagendada',
      mensagem: `${autor} mudou o prazo: ${t.titulo} — agora ${S.prazoLegivel({ ...t, ...dados })}`,
      origem: 'tarefa', registro_id: Number(t.id), autor_id: ctx.usuarioId
    });
  }
  if (dados.status === 'cancelada' && t.status !== 'cancelada') {
    await S.registrarNaFicha(api, t, S.eventoNaFicha('cancelou', t, { nomes, valor: 'Cancelada' }), ctx.usuarioId);
  }
  res.json({ success: true });
}

router.put('/:id', precisa('tarefas.edit'), (req, res) => editar(req, res).catch(err => responderErro(res, err, 'editar')));
// Arrastar no calendário/quadro: mesma regra, sem pedir "Editar tarefa" (quem
// responde reagenda a própria tarefa mesmo sem poder editar as dos outros).
router.patch('/:id/mover', precisa('tarefas.view'), (req, res) => {
  const permitido = ['data', 'hora', 'duracao_min', 'status', 'ordem'];
  req.body = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitido.includes(k)));
  return editar(req, res, { mover: true }).catch(err => responderErro(res, err, 'mover'));
});

// ------------------------------------------------------------ concluir / reabrir / excluir

async function registrarAtividade(api, t, { resultado, nota, usuarioId }) {
  const detalhe = [R.RESULTADOS[resultado], texto(nota)].filter(Boolean).join(' — ') || null;
  const base = {
    tipo: R.tipoDaAtividade(t.tipo), data: agoraISO(), resumo: String(t.titulo).slice(0, 300),
    detalhe, usuario_id: usuarioId ?? null, tarefa_id: Number(t.id)
  };
  let primeira = null;
  if (t.prospeccao_id) {
    const r = await api.post('/api/prospeccao_interacoes', { ...base, prospeccao_id: Number(t.prospeccao_id) });
    primeira = primeira || { origem: 'prospeccao', id: r?.id ?? null };
  }
  if (t.cliente_id) {
    const r = await api.post('/api/cliente_interacoes', { ...base, cliente_id: Number(t.cliente_id) });
    primeira = primeira || { origem: 'cliente', id: r?.id ?? null };
  }
  return primeira;
}

/** A próxima de uma série (copia campos, checklist zerado e participantes que já aceitaram). */
async function criarProximaDaSerie(ctx, t, participantes, nomes) {
  const hoje = R.agoraEmBrasilia().dia;
  const prox = R.proximaOcorrencia(R.diaISO(t.data), t.recorrencia, hoje);
  if (!prox) return null;
  const itens = lista(await ctx.api.get('/api/tarefa_checklist', { query: { tarefa_id: t.id } }).catch(() => []))
    .sort((a, b) => Number(a.ordem) - Number(b.ordem)).map(c => c.texto);
  const nova = await S.criarTarefa(ctx.api, {
    titulo: t.titulo, descricao: t.descricao || null, tipo: t.tipo, prioridade: t.prioridade, status: 'a_fazer',
    data: prox.data, hora: R.horaHHMM(t.hora) || null, duracao_min: t.duracao_min ?? null, lembrete_min: t.lembrete_min ?? null,
    local: t.local || null, responsavel_id: t.responsavel_id, criado_por: t.criado_por, lista_id: t.lista_id || null,
    marcadores: lista(t.marcadores), cliente_id: t.cliente_id || null, prospeccao_id: t.prospeccao_id || null,
    orcamento_id: t.orcamento_id || null, pedido_id: t.pedido_id || null,
    recorrencia: { ...R.normalizarRecorrencia(t.recorrencia), ocorrencia: prox.ocorrencia },
    serie_id: t.serie_id || t.id, origem: 'recorrencia'
  }, { usuarioId: ctx.usuarioId, nomes, checklist: itens, registrarFicha: false });
  for (const p of participantes.filter(x => mesmoId(x.tarefa_id, t.id) && x.status === 'aceito')) {
    await ctx.api.post('/api/tarefa_participantes', { tarefa_id: Number(nova.id), usuario_id: p.usuario_id, status: 'aceito', convidado_por: p.convidado_por ?? null, respondido_em: agoraISO() }).catch(() => null);
  }
  return nova;
}

router.post('/:id/concluir', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const { t, participantes } = await carregarTarefa(ctx, req.params.id);
    if (!R.podeMexerNaTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes })) throw erro(403, 'Só quem criou, quem responde e quem participa concluem esta tarefa.');
    if (!R.ABERTOS.has(t.status)) throw erro(409, t.status === 'concluida' ? 'Esta tarefa já foi concluída.' : 'Esta tarefa está cancelada.');
    const resultado = R.RESULTADOS[req.body?.resultado] ? req.body.resultado : 'feito';
    const nota = texto(req.body?.nota).slice(0, 2000) || null;
    const nomes = await social.nomesDosUsuarios(api);

    // A atividade real: na prospecção/cliente ligados. O próximo passo segue
    // o caminho de "Concluir passo planejado" (fica o combinado x realizado).
    let interacao = null;
    let registrarFicha = true;
    if (t.origem === 'proximo_passo' && t.prospeccao_id) {
      const pros = require('./prospeccoesController');
      const legivel = [R.RESULTADOS[resultado], nota].filter(Boolean).join(' — ');
      const id = await pros.concluirPassoPelaTarefa(api, t.prospeccao_id, { nota: legivel || 'Concluído', tarefaId: t.id }, ctx.usuarioId);
      if (id) interacao = { origem: 'prospeccao', id };
      registrarFicha = false;
    } else if (t.prospeccao_id || t.cliente_id) {
      interacao = await registrarAtividade(api, t, { resultado, nota, usuarioId: ctx.usuarioId });
    }
    await S.concluirTarefa(api, t, { usuarioId: ctx.usuarioId, resultado, nota, interacao, nomes, registrarFicha });

    let serie = null;
    if (t.recorrencia) serie = await criarProximaDaSerie(ctx, t, participantes, nomes);

    // "Concluir e agendar a próxima": o próximo passo, na prospecção, é o
    // campo dela (a tarefa-espelho nasce de lá); fora disso, tarefa nova.
    let proxima = null;
    const pedido = req.body?.proxima;
    if (pedido && texto(pedido.titulo)) {
      if (t.origem === 'proximo_passo' && t.prospeccao_id) {
        const pros = require('./prospeccoesController');
        await pros.atualizarPassoPelaTarefa(api, t.prospeccao_id, { passo: texto(pedido.titulo), data: R.diaISO(pedido.data) || null }, ctx.usuarioId);
      } else {
        const dados = R.normalizarTarefa({
          titulo: pedido.titulo, tipo: pedido.tipo || t.tipo, prioridade: pedido.prioridade || t.prioridade,
          data: pedido.data || null, hora: pedido.hora || null
        });
        proxima = await S.criarTarefa(api, {
          ...dados, status: 'a_fazer', responsavel_id: t.responsavel_id || ctx.usuarioId, lista_id: t.lista_id || null,
          marcadores: lista(t.marcadores), cliente_id: t.cliente_id || null, prospeccao_id: t.prospeccao_id || null,
          orcamento_id: t.orcamento_id || null, pedido_id: t.pedido_id || null, origem: 'manual'
        }, { usuarioId: ctx.usuarioId, nomes });
      }
    }

    const interessados = [t.criado_por, t.responsavel_id, ...participantes.filter(p => mesmoId(p.tarefa_id, t.id) && p.status === 'aceito').map(p => p.usuario_id)];
    const para = social.destinatarios(interessados, ctx.usuarioId);
    if (para.length) {
      await social.notificar(api, para, {
        tipo: 'tarefa_concluida', titulo: 'Tarefa concluída',
        mensagem: `${nomes.get(ctx.usuarioId) || 'Alguém'} concluiu: ${t.titulo}${R.RESULTADOS[resultado] && resultado !== 'feito' ? ` — ${R.RESULTADOS[resultado]}` : ''}`,
        origem: 'tarefa', registro_id: Number(t.id), autor_id: ctx.usuarioId
      });
    }
    res.json({ success: true, interacao, proxima_id: proxima?.id ?? null, serie_id: serie?.id ?? null, serie_data: serie?.data ?? null });
  } catch (err) {
    responderErro(res, err, 'concluir');
  }
});

router.post('/:id/reabrir', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const { t, participantes } = await carregarTarefa(ctx, req.params.id);
    if (!R.podeMexerNaTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes })) throw erro(403, 'Você não mexe nesta tarefa.');
    if (R.ABERTOS.has(t.status)) return res.json({ success: true });
    // Reaberta, a tarefa não é mais o espelho do passo (o passo já foi cumprido lá).
    await api.put(`/api/tarefas/${t.id}`, {
      status: 'a_fazer', concluida_em: null, concluida_por: null, resultado: null, resultado_nota: null,
      origem: t.origem === 'proximo_passo' ? 'manual' : t.origem, atualizado_em: agoraISO()
    });
    await S.registrarNaTarefa(api, t.id, [{ tipo: 'situacao', acao: 'reabriu', entidade: 'Tarefa', valor_anterior: R.ROTULO_STATUS[t.status], valor_novo: 'A fazer' }], ctx.usuarioId);
    await S.registrarNaFicha(api, t, S.eventoNaFicha('reabriu', t, { nomes: await social.nomesDosUsuarios(api), valor: 'Reaberta' }), ctx.usuarioId);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'reabrir');
  }
});

router.delete('/:id', precisa('tarefas.delete'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const { t } = await carregarTarefa(ctx, req.params.id);
    if (!R.podeExcluirTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo })) throw erro(403, 'Só quem criou a tarefa (ou Admin/Sup Admin) exclui.');
    const motivo = texto(req.body?.motivo || req.query?.motivo) || null;
    await api.put(`/api/tarefas/${t.id}`, { excluida_em: agoraISO(), excluida_por: ctx.usuarioId, motivo_exclusao: motivo, atualizado_em: agoraISO() });
    await S.registrarNaTarefa(api, t.id, [{ tipo: 'situacao', acao: 'excluiu', entidade: 'Tarefa', valor_anterior: t.titulo, observacao: motivo }], ctx.usuarioId);
    await S.registrarNaFicha(api, t, S.eventoNaFicha('excluiu', t, { nomes: await social.nomesDosUsuarios(api), observacao: motivo }), ctx.usuarioId);
    if (R.ABERTOS.has(t.status)) await refletirNoPasso(ctx, t, { status: 'cancelada' });
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'excluir');
  }
});

// ------------------------------------------------------------ checklist

async function tarefaParaMexer(req) {
  const ctx = req.ctxTarefas;
  const { t, participantes } = await carregarTarefa(ctx, req.params.id);
  if (!R.podeMexerNaTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes })) throw erro(403, 'Você não mexe nesta tarefa.');
  return { ctx, t, participantes };
}

router.post('/:id/checklist', precisa('tarefas.view'), async (req, res) => {
  try {
    const { ctx, t } = await tarefaParaMexer(req);
    const itemTexto = texto(req.body?.texto).slice(0, 300);
    if (!itemTexto) throw erro(400, 'Escreva o item.');
    const itens = lista(await ctx.api.get('/api/tarefa_checklist', { query: { tarefa_id: t.id } }).catch(() => []));
    const ordem = itens.reduce((m, c) => Math.max(m, Number(c.ordem) || 0), 0) + 1;
    const criado = await ctx.api.post('/api/tarefa_checklist', { tarefa_id: Number(t.id), texto: itemTexto, ordem, criado_por: ctx.usuarioId });
    res.status(201).json({ id: criado?.id ?? null });
  } catch (err) {
    responderErro(res, err, 'checklist');
  }
});

router.put('/:id/checklist/:itemId', precisa('tarefas.view'), async (req, res) => {
  try {
    const { ctx, t } = await tarefaParaMexer(req);
    const item = await ctx.api.get(`/api/tarefa_checklist/${Number(req.params.itemId)}`).catch(() => null);
    if (!item || !mesmoId(item.tarefa_id, t.id)) throw erro(404, 'Item não encontrado.');
    const patch = {};
    if (req.body?.texto !== undefined) {
      patch.texto = texto(req.body.texto).slice(0, 300);
      if (!patch.texto) throw erro(400, 'Escreva o item.');
    }
    if (req.body?.feito !== undefined) {
      patch.feito = Boolean(req.body.feito);
      patch.feito_por = patch.feito ? ctx.usuarioId : null;
      patch.feito_em = patch.feito ? agoraISO() : null;
    }
    if (req.body?.ordem !== undefined && Number.isFinite(Number(req.body.ordem))) patch.ordem = Number(req.body.ordem);
    if (Object.keys(patch).length) await ctx.api.put(`/api/tarefa_checklist/${item.id}`, patch);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'checklist');
  }
});

router.delete('/:id/checklist/:itemId', precisa('tarefas.view'), async (req, res) => {
  try {
    const { ctx, t } = await tarefaParaMexer(req);
    const item = await ctx.api.get(`/api/tarefa_checklist/${Number(req.params.itemId)}`).catch(() => null);
    if (!item || !mesmoId(item.tarefa_id, t.id)) throw erro(404, 'Item não encontrado.');
    await ctx.api.delete(`/api/tarefa_checklist/${item.id}`);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'checklist');
  }
});

// ------------------------------------------------------------ participantes

router.post('/:id/participantes', precisa('tarefas.invite'), async (req, res) => {
  try {
    const { ctx, t } = await tarefaParaMexer(req);
    const ids = lista(req.body?.usuarios).map(Number).filter(Boolean);
    if (!ids.length) throw erro(400, 'Escolha quem convidar.');
    const convidados = await S.convidar(ctx.api, t, ids, { usuarioId: ctx.usuarioId, nomes: await social.nomesDosUsuarios(ctx.api), mensagem: req.body?.mensagem });
    res.json({ convidados });
  } catch (err) {
    responderErro(res, err, 'convidar');
  }
});

router.post('/:id/convite', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const resposta = texto(req.body?.resposta);
    if (!['aceitar', 'recusar'].includes(resposta)) throw erro(400, 'Responda aceitar ou recusar.');
    const { t, participantes } = await carregarTarefa(ctx, req.params.id);
    const meu = participantes.find(p => mesmoId(p.usuario_id, ctx.usuarioId));
    if (!meu || meu.status !== 'pendente') throw erro(409, meu ? 'Este convite já foi respondido.' : 'Não há convite seu nesta tarefa.');
    const status = resposta === 'aceitar' ? 'aceito' : 'recusado';
    await api.put(`/api/tarefa_participantes/${meu.id}`, { status, respondido_em: agoraISO() });
    const nomes = await social.nomesDosUsuarios(api);
    const eu = nomes.get(ctx.usuarioId) || 'Alguém';
    await S.registrarNaTarefa(api, t.id, [{ tipo: 'participantes', acao: 'respondeu', entidade: 'Convite', valor_novo: `${eu} ${status === 'aceito' ? 'aceitou' : 'recusou'}` }], ctx.usuarioId);
    const para = social.destinatarios([meu.convidado_por, t.responsavel_id], ctx.usuarioId);
    if (para.length) {
      await social.notificar(api, para, {
        tipo: 'convite_respondido', titulo: status === 'aceito' ? 'Convite aceito' : 'Convite recusado',
        mensagem: `${eu} ${status === 'aceito' ? 'aceitou' : 'recusou'} participar de: ${t.titulo}`,
        origem: 'tarefa', registro_id: Number(t.id), autor_id: ctx.usuarioId
      });
    }
    // O aviso do convite some do "não lido": já foi respondido.
    const avisos = lista(await api.get('/api/notificacoes', { query: { usuario_id: ctx.usuarioId, registro_id: t.id } }).catch(() => []))
      .filter(n => n.tipo === 'convite_tarefa' && n.origem === 'tarefa' && !n.lida_em);
    for (const n of avisos) await api.put(`/api/notificacoes/${n.id}`, { lida_em: agoraISO() }).catch(() => null);
    res.json({ success: true, status });
  } catch (err) {
    responderErro(res, err, 'responder convite');
  }
});

router.delete('/:id/participantes/:usuarioId', precisa('tarefas.view'), async (req, res) => {
  try {
    const ctx = req.ctxTarefas;
    const { api } = ctx;
    const alvo = Number(req.params.usuarioId);
    const { t, participantes } = await carregarTarefa(ctx, req.params.id);
    const saindo = mesmoId(alvo, ctx.usuarioId);
    if (!saindo && !R.podeMexerNaTarefa(t, { usuarioId: ctx.usuarioId, escopo: ctx.escopo, participantes })) throw erro(403, 'Você não mexe nesta tarefa.');
    const p = participantes.find(x => mesmoId(x.usuario_id, alvo));
    if (!p) throw erro(404, 'Esta pessoa não participa da tarefa.');
    await api.put(`/api/tarefa_participantes/${p.id}`, { status: 'saiu', respondido_em: agoraISO() });
    const nomes = await social.nomesDosUsuarios(api);
    await S.registrarNaTarefa(api, t.id, [{ tipo: 'participantes', acao: 'alterou', entidade: 'Participantes', valor_anterior: nomes.get(alvo) || `#${alvo}`, observacao: saindo ? 'Saiu da tarefa' : 'Removido da tarefa' }], ctx.usuarioId);
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'participantes');
  }
});

module.exports = router;
module.exports.acessoATarefa = acessoATarefa;
module.exports.montarContexto = montarContexto;
module.exports.concluirPelaAcao = concluirPelaAcao;
