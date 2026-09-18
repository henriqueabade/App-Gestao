/**
 * Avisos por usuário — o sino do topo (/api/notificacoes).
 *
 *   GET  /           os meus últimos 50 avisos, o total de não lidos e o nome de quem fez
 *   POST /lidas      { ids: [...] } marca estes; { todas: true } marca todos os meus
 *   POST /dispensar  { ids: [...] } tira do sino (fica no banco, com excluida_em)
 *
 * Convite de tarefa em conjunto (tipo convite_tarefa) volta com
 * `convite_pendente`: enquanto for true, o sino mostra Aceitar/Recusar.
 *
 * Quem grava os avisos é quem gera o fato (hoje, o histórico social de
 * Prospecções e Clientes — backend/historicoSocial.js). Cada um só lê e marca
 * os PRÓPRIOS avisos: o id vem do token, nunca do corpo.
 *
 * Sem a tabela (sql/historico_social.sql não rodou) responde vazio com
 * `sql_pendente`, e o sino fica quieto em vez de dar erro.
 */

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const { semTabela, nomesDosUsuarios } = require('./historicoSocial');

const router = express.Router();
const LIMITE = 50;

/**
 * Os avisos de um usuário, do mais novo ao mais antigo, com o nome do autor.
 * Os dispensados ficam de fora. `convitesPendentes`: ids das tarefas com
 * convite meu ainda sem resposta. Pura.
 */
function montarAvisos(linhas = [], nomes = new Map(), limite = LIMITE, convitesPendentes = new Set()) {
  const todos = (Array.isArray(linhas) ? linhas : [])
    .filter(n => !n.excluida_em)
    .slice()
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)) || Number(b.id) - Number(a.id));
  return {
    nao_lidas: todos.filter(n => !n.lida_em).length,
    itens: todos.slice(0, limite).map(n => ({
      id: n.id, tipo: n.tipo, titulo: n.titulo, mensagem: n.mensagem || '',
      origem: n.origem || null, registro_id: n.registro_id ?? null, item_id: n.item_id ?? null,
      comentario_id: n.comentario_id ?? null, autor_id: n.autor_id ?? null,
      autor: n.autor_id ? nomes.get(Number(n.autor_id)) || null : null,
      lida: Boolean(n.lida_em), criado_em: n.criado_em,
      ...(n.tipo === 'convite_tarefa' ? { convite_pendente: convitesPendentes.has(String(n.registro_id)) } : {})
    }))
  };
}

router.get('/', async (req, res) => {
  const usuarioId = usuarioDaRequisicao(req);
  if (!usuarioId) return res.json({ itens: [], nao_lidas: 0 });
  try {
    const api = createApiClient(req);
    const [linhas, nomes, participacoes] = await Promise.all([
      api.get('/api/notificacoes', { query: { usuario_id: usuarioId } }),
      nomesDosUsuarios(api),
      // Sem o SQL de tarefas, simplesmente não há convite pendente.
      api.get('/api/tarefa_participantes', { query: { usuario_id: usuarioId, status: 'pendente' } }).catch(() => [])
    ]);
    const pendentes = new Set((Array.isArray(participacoes) ? participacoes : []).filter(p => p.status === 'pendente').map(p => String(p.tarefa_id)));
    res.json(montarAvisos(linhas, nomes, LIMITE, pendentes));
  } catch (err) {
    if (semTabela(err)) return res.json({ itens: [], nao_lidas: 0, sql_pendente: true });
    console.error('[notificacoes] falha ao listar:', err);
    res.status(err.status || 500).json({ error: 'Não foi possível ler os avisos.' });
  }
});

router.post('/lidas', async (req, res) => {
  const usuarioId = usuarioDaRequisicao(req);
  if (!usuarioId) return res.status(401).json({ error: 'Sessão sem usuário.' });
  try {
    const api = createApiClient(req);
    const meus = await api.get('/api/notificacoes', { query: { usuario_id: usuarioId } });
    const pedidos = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    const alvo = (Array.isArray(meus) ? meus : [])
      .filter(n => !n.lida_em && (req.body?.todas === true || pedidos.has(String(n.id))));
    const agora = new Date().toISOString();
    for (const n of alvo) await api.put(`/api/notificacoes/${n.id}`, { lida_em: agora });
    res.json({ marcadas: alvo.length });
  } catch (err) {
    if (semTabela(err)) return res.json({ marcadas: 0, sql_pendente: true });
    console.error('[notificacoes] falha ao marcar lidas:', err);
    res.status(err.status || 500).json({ error: 'Não foi possível marcar os avisos.' });
  }
});

router.post('/dispensar', async (req, res) => {
  const usuarioId = usuarioDaRequisicao(req);
  if (!usuarioId) return res.status(401).json({ error: 'Sessão sem usuário.' });
  try {
    const api = createApiClient(req);
    const meus = await api.get('/api/notificacoes', { query: { usuario_id: usuarioId } });
    const pedidos = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    const alvo = (Array.isArray(meus) ? meus : []).filter(n => !n.excluida_em && pedidos.has(String(n.id)));
    const agora = new Date().toISOString();
    for (const n of alvo) await api.put(`/api/notificacoes/${n.id}`, { excluida_em: agora, lida_em: n.lida_em || agora });
    res.json({ dispensadas: alvo.length });
  } catch (err) {
    if (semTabela(err)) return res.json({ dispensadas: 0, sql_pendente: true });
    console.error('[notificacoes] falha ao dispensar:', err);
    res.status(err.status || 500).json({ error: 'Não foi possível tirar o aviso do sino.' });
  }
});

module.exports = router;
module.exports.montarAvisos = montarAvisos;
