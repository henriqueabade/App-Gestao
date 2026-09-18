/**
 * Rotas do histórico social de Prospecções e Clientes (/api/historico-social).
 *
 *   GET  /:origem/:id                                  a linha do tempo (eventos + comentários + curtidas + anexos)
 *   POST /:origem/:id/observacoes                      { texto }
 *   POST /:origem/:id/itens/:itemId/comentarios        { texto, resposta_de? }
 *   PUT  /:origem/:id/comentarios/:comentarioId        { texto }            — só o autor
 *   POST /:origem/:id/itens/:itemId/curtida            curtir/descurtir o evento
 *   POST /:origem/:id/comentarios/:comentarioId/curtida
 *   POST /:origem/:id/itens/:itemId/excluir            { motivo? }          — só Sup Admin
 *   POST /:origem/:id/comentarios/:comentarioId/excluir { motivo? }         — só Sup Admin
 *   POST /:origem/:id/anexos                           { item_id | comentario_id, nome, tipo, base64 }
 *   GET  /:origem/:id/anexos/:anexoId                  { nome, tipo, tamanho, base64 }
 *
 * `origem` é `prospeccao` ou `cliente`; ver quem pode é a permissão de ver
 * detalhes de cada módulo (pros.details.view / cli.details.view). Curtir,
 * comentar, publicar e anexar vêm com ela. Excluir é do Sup Admin, conferido
 * aqui de novo (esconder o botão não basta).
 *
 * O corpo aceita até 30 MB (um anexo de 20 MB em base64): o server.js usa um
 * parser de 30 MB só para este caminho (o resto fica em 3 MB).
 */

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const { usuarioDaRequisicao } = require('./usuarioAtual');
const social = require('./historicoSocial');

const router = express.Router();

/** Origem desconhecida para aqui, antes de qualquer permissão. */
router.param('origem', (req, res, next, origem) => {
  if (!social.ORIGENS[origem]) return res.status(400).json({ error: 'Origem inválida: use prospeccao ou cliente.' });
  return next();
});

const porPermissao = exigirPermissao(req => social.ORIGENS[req.params.origem]?.permissao);

/**
 * Prospecção e cliente: basta a permissão de ver detalhes. Tarefa: é preciso
 * poder ver AQUELA tarefa (quem criou, quem responde, quem participa ou tem
 * a visão da agenda da pessoa) — a regra mora no controller de tarefas.
 */
function podeVer(req, res, next) {
  if (req.params.origem !== 'tarefa') return porPermissao(req, res, next);
  return require('./tarefasController').acessoATarefa(req, Number(req.params.id))
    .then(ok => (ok ? next() : res.status(403).json({ error: 'Você não participa desta tarefa.' })))
    .catch(err => res.status(err.status || 500).json({ error: err.message || 'Não foi possível conferir o acesso.' }));
}

/** Resposta de erro com o `sql_pendente` quando é o caso. */
function responderErro(res, err, contexto) {
  if (!err?.status || err.status >= 500) console.error(`[historico-social] ${contexto}:`, err);
  const corpo = { error: err?.message || 'Erro no histórico' };
  if (err?.sql_pendente) corpo.sql_pendente = true;
  res.status(err?.status || 500).json(corpo);
}

/** Contexto de cada chamada: API, quem é, nomes. */
async function contexto(req) {
  const api = createApiClient(req);
  const usuarioId = usuarioDaRequisicao(req);
  const nomes = await social.nomesDosUsuarios(api);
  return { api, usuarioId: usuarioId === null ? null : Number(usuarioId), nomes, origem: req.params.origem, registroId: Number(req.params.id) };
}

router.get('/:origem/:id', podeVer, async (req, res) => {
  try {
    const api = createApiClient(req);
    const usuarioId = usuarioDaRequisicao(req);
    const supAdmin = await ehSupAdmin(req);
    res.json(await social.carregarLinhaDoTempo(api, {
      origem: req.params.origem, registroId: Number(req.params.id), usuarioId, supAdmin
    }));
  } catch (err) {
    responderErro(res, err, 'GET linha do tempo');
  }
});

router.post('/:origem/:id/observacoes', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    const criado = await social.publicarObservacao(c.api, { ...c, texto: req.body?.texto });
    res.status(201).json({ id: criado?.id ?? null });
  } catch (err) {
    responderErro(res, err, 'POST observação');
  }
});

router.post('/:origem/:id/itens/:itemId/comentarios', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    const criado = await social.comentar(c.api, {
      ...c, itemId: Number(req.params.itemId), respostaDe: req.body?.resposta_de ? Number(req.body.resposta_de) : null, texto: req.body?.texto
    });
    res.status(201).json({ id: criado?.id ?? null });
  } catch (err) {
    responderErro(res, err, 'POST comentário');
  }
});

router.put('/:origem/:id/comentarios/:comentarioId', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    await social.editarComentario(c.api, { ...c, comentarioId: Number(req.params.comentarioId), texto: req.body?.texto });
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'PUT comentário');
  }
});

router.post('/:origem/:id/itens/:itemId/curtida', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    res.json(await social.alternarCurtida(c.api, { ...c, itemId: Number(req.params.itemId) }));
  } catch (err) {
    responderErro(res, err, 'curtida no evento');
  }
});

router.post('/:origem/:id/comentarios/:comentarioId/curtida', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    res.json(await social.alternarCurtida(c.api, { ...c, comentarioId: Number(req.params.comentarioId) }));
  } catch (err) {
    responderErro(res, err, 'curtida no comentário');
  }
});

router.post('/:origem/:id/itens/:itemId/excluir', podeVer, exigirSupAdmin, async (req, res) => {
  try {
    const c = await contexto(req);
    await social.excluirEvento(c.api, { ...c, itemId: Number(req.params.itemId), motivo: req.body?.motivo });
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'excluir evento');
  }
});

router.post('/:origem/:id/comentarios/:comentarioId/excluir', podeVer, exigirSupAdmin, async (req, res) => {
  try {
    const c = await contexto(req);
    await social.excluirComentario(c.api, { ...c, comentarioId: Number(req.params.comentarioId), motivo: req.body?.motivo });
    res.json({ success: true });
  } catch (err) {
    responderErro(res, err, 'excluir comentário');
  }
});

router.post('/:origem/:id/anexos', podeVer, async (req, res) => {
  try {
    const c = await contexto(req);
    const anexo = await social.salvarAnexo(c.api, {
      ...c,
      itemId: req.body?.item_id ? Number(req.body.item_id) : null,
      comentarioId: req.body?.comentario_id ? Number(req.body.comentario_id) : null,
      nome: req.body?.nome, tipo: req.body?.tipo, base64: req.body?.base64
    });
    res.status(201).json({ id: anexo?.id ?? null });
  } catch (err) {
    responderErro(res, err, 'POST anexo');
  }
});

router.get('/:origem/:id/anexos/:anexoId', podeVer, async (req, res) => {
  try {
    const api = createApiClient(req);
    const { anexo, base64 } = await social.lerAnexo(api, Number(req.params.anexoId));
    if (anexo.origem !== req.params.origem || String(anexo.registro_id) !== String(req.params.id)) {
      return res.status(404).json({ error: 'Anexo não encontrado nesta ficha.' });
    }
    if (anexo.excluido_em && !(await ehSupAdmin(req))) return res.status(404).json({ error: 'Anexo removido.' });
    res.json({ id: anexo.id, nome: anexo.nome_arquivo, tipo: anexo.tipo_mime || 'application/octet-stream', tamanho: Number(anexo.tamanho_bytes) || 0, base64 });
  } catch (err) {
    responderErro(res, err, 'GET anexo');
  }
});

module.exports = router;
