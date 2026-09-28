/**
 * Rotas da Contabilidade — /api/contabilidade/* (etapa 1: base do módulo).
 *
 *   GET  /painel?competencia=              checklist por fonte, pendências (3 severidades), situação e bloqueios
 *   GET  /atividade?competencia=&limite=   o histórico do módulo, com quem fez
 *   GET  /competencias                     as competências já fechadas/reabertas
 *   POST /fechar                           { competencia }                        (contabilidade.fechar)
 *   POST /reabrir                          { competencia, justificativa }         (contabilidade.reabrir)
 *   POST /pendencias/ignorar               { competencia, chave, justificativa }  (contabilidade.pendencia.resolver)
 *   POST /pendencias/restaurar             { competencia, chave }                 (contabilidade.pendencia.resolver)
 *
 * Sem o SQL do módulo (sql/contabilidade_base.sql), o painel volta com
 * `sql_pendente: true` (a tela avisa) e as gravações respondem 409.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const configuracaoCobranca = require('./cobranca/configuracaoCobranca');
const checklist = require('./contabilidade/checklist');
const fechamento = require('./contabilidade/fechamento');

const VER = 'contabilidade.view';
const FECHAR = 'contabilidade.fechar';
const REABRIR = 'contabilidade.reabrir';
const RESOLVER = 'contabilidade.pendencia.resolver';

const router = express.Router();

function hojeEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  const v = tipo => partes.find(p => p.type === tipo)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** O id do usuário do JWT (sem validar a assinatura — só leitura). */
function usuarioDaRequisicao(req) {
  try {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const payload = JSON.parse(Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload.id ?? payload.userId ?? payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno na Contabilidade', ...(err?.extra || {}) });
}

/** O corte "controlar a partir de" das contas a receber (fase E); sem a configuração, sem corte. */
async function desdeDe(api) {
  const cfg = await configuracaoCobranca.carregar(api).catch(() => null);
  return cfg?.recebimentos_desde || null;
}

/** Cada rota: um api por requisição, hoje em Brasília, o usuário e o corte; o erro vira a resposta padrão. */
function rota(contexto, fn) {
  return async (req, res) => {
    try {
      const api = createApiClient(req);
      const ctx = { req, api, hoje: hojeEmBrasilia(), usuarioId: usuarioDaRequisicao(req), desde: await desdeDe(api) };
      res.json(await fn(ctx));
    } catch (err) {
      responder(res, err, contexto);
    }
  };
}

router.get('/painel', exigirPermissao(VER), rota('GET /api/contabilidade/painel', async ({ api, req, hoje, desde }) => {
  const { situacao_bruta, ...painel } = await checklist.carregar({ api, competencia: String(req.query?.competencia || ''), hoje, desde });
  return painel;
}));

router.get('/atividade', exigirPermissao(VER), rota('GET /api/contabilidade/atividade', ({ api, req }) =>
  fechamento.atividade({ api, competencia: req.query?.competencia || null, limite: Number(req.query?.limite) || 50 })
    .then(eventos => ({ eventos }))));

router.get('/competencias', exigirPermissao(VER), rota('GET /api/contabilidade/competencias', ({ api }) =>
  fechamento.listarCompetencias({ api }).then(competencias => ({ competencias }))));

router.post('/fechar', exigirPermissao(FECHAR), rota('POST /api/contabilidade/fechar', ({ api, req, hoje, desde, usuarioId }) =>
  fechamento.fechar({ api, competencia: req.body?.competencia, hoje, desde, usuarioId })));

router.post('/reabrir', exigirPermissao(REABRIR), rota('POST /api/contabilidade/reabrir', ({ api, req, usuarioId }) =>
  fechamento.reabrir({ api, competencia: req.body?.competencia, justificativa: req.body?.justificativa, usuarioId })));

router.post('/pendencias/ignorar', exigirPermissao(RESOLVER), rota('POST /api/contabilidade/pendencias/ignorar', ({ api, req, hoje, desde, usuarioId }) =>
  fechamento.ignorarPendencia({ api, competencia: req.body?.competencia, chave: req.body?.chave, justificativa: req.body?.justificativa, hoje, desde, usuarioId })));

router.post('/pendencias/restaurar', exigirPermissao(RESOLVER), rota('POST /api/contabilidade/pendencias/restaurar', ({ api, req, usuarioId }) =>
  fechamento.restaurarPendencia({ api, competencia: req.body?.competencia, chave: req.body?.chave, usuarioId })));

module.exports = router;
