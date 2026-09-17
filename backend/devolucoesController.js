/**
 * Rotas da devolução de pedidos — /api/devolucoes/*.
 *
 *   GET  /pedido/:id             o que a tela precisa: peças, parcelas, nota, devoluções anteriores
 *   POST /pedido/:id/previa      { itens } → o plano (tipo, valor, parcelas, reembolso); não grava nada
 *   POST /pedido/:id/xml         { xml } → lê a NF-e de devolução do cliente e sugere as quantidades
 *   POST /pedido/:id             { itens, data_devolucao, motivo, observacao, xml, chave_idempotencia } → registra
 *   GET  /notas                  as notas de devolução guardadas (sem o XML), para as etiquetas dos pedidos
 *   GET  /notas/:id/xml          o XML guardado
 *   GET  /reembolsos?status=     os reembolsos (Financeiro)
 *   POST /reembolsos/:id/confirmar { data_pagamento, forma, observacao }
 *   GET  /:id                    uma devolução registrada, com as pendências
 *   POST /:id/reaplicar          tenta de novo o que falhou (estoque, abatimento ou baixa no BB)
 *
 * As tabelas nascem em sql/devolucoes.sql; sem ele as rotas respondem 409 com
 * `sql_pendente`. O BB é o do módulo de cobrança (cobrancaController), com o
 * cofre e as credenciais de lá.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const cobranca = require('./cobrancaController');
const configuracaoCobranca = require('./cobranca/configuracaoCobranca');
const c = require('./devolucoes/comum');
const registro = require('./devolucoes/registro');
const reembolsos = require('./devolucoes/reembolsos');

const DEVOLVER = 'ped.devolucao';
const VER_PEDIDOS = 'ped.view';
const VER_FINANCEIRO = 'financeiro.view';
const CONFIRMAR_REEMBOLSO = 'financeiro.reembolso.confirmar';

function hojeEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  const v = tipo => partes.find(p => p.type === tipo)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno na devolução', ...(err?.extra || {}) });
}

/** `contextoBB(api, boleto)` é injetável para os testes; o app usa o do módulo de cobrança. */
function criarRouter({ contextoBB = cobranca.contextoDoBoleto } = {}) {
  const router = express.Router();

  function rota(contexto, fn) {
    return async (req, res) => {
      try {
        const api = createApiClient(req);
        res.json(await fn({ req, api, hoje: hojeEmBrasilia(), usuarioId: cobranca.usuarioDaRequisicao(req) }));
      } catch (err) {
        responder(res, err, contexto);
      }
    };
  }

  router.get('/pedido/:id', exigirPermissao(DEVOLVER), rota('GET /api/devolucoes/pedido/:id',
    ({ req, api, hoje }) => registro.opcoes({ api, pedidoId: req.params.id, hoje })));

  router.post('/pedido/:id/previa', exigirPermissao(DEVOLVER), rota('POST /api/devolucoes/pedido/:id/previa',
    ({ req, api, hoje }) => registro.previa({ api, pedidoId: req.params.id, entrada: req.body || {}, hoje })));

  router.post('/pedido/:id/xml', exigirPermissao(DEVOLVER), rota('POST /api/devolucoes/pedido/:id/xml',
    ({ req, api, hoje }) => registro.lerXml({ api, pedidoId: req.params.id, xml: req.body?.xml, hoje })));

  router.post('/pedido/:id', exigirPermissao(DEVOLVER), rota('POST /api/devolucoes/pedido/:id', async ({ req, api, hoje, usuarioId }) => {
    const cfg = await configuracaoCobranca.carregar(api).catch(() => null);
    return registro.registrar({
      api, pedidoId: req.params.id, entrada: req.body || {}, usuarioId, hoje, desde: cfg?.recebimentos_desde || null, contextoBB
    });
  }));

  router.get('/notas', exigirPermissao(VER_PEDIDOS), rota('GET /api/devolucoes/notas', async ({ req, api }) => {
    const filtro = req.query?.pedido_id ? { pedido_id: Number(req.query.pedido_id) } : {};
    const notas = await c.lerSePuder(api, 'notas_devolucao', filtro);
    return notas.map(({ xml, itens, ...resto }) => resto);
  }));

  router.get('/notas/:id/xml', exigirPermissao(VER_PEDIDOS), rota('GET /api/devolucoes/notas/:id/xml', async ({ req, api }) => {
    const nota = (await c.ler(api, 'notas_devolucao', { id: Number(req.params.id) }))[0];
    if (!nota) throw c.erro('Nota de devolução não encontrada.', 404);
    return { nome: `NFe-devolucao-${nota.chave_acesso}.xml`, xml: nota.xml };
  }));

  router.get('/reembolsos', exigirPermissao(VER_FINANCEIRO), rota('GET /api/devolucoes/reembolsos',
    async ({ req, api, hoje }) => ({ reembolsos: await reembolsos.listar({ api, status: req.query?.status || null }), formas: reembolsos.FORMAS, hoje })));

  router.post('/reembolsos/:id/confirmar', exigirPermissao(CONFIRMAR_REEMBOLSO), rota('POST /api/devolucoes/reembolsos/:id/confirmar',
    ({ req, api, hoje, usuarioId }) => reembolsos.confirmar({ api, id: req.params.id, entrada: req.body || {}, usuarioId, hoje })));

  router.get('/:id', exigirPermissao(DEVOLVER), rota('GET /api/devolucoes/:id',
    ({ req, api }) => registro.detalhe(api, req.params.id)));

  router.post('/:id/reaplicar', exigirPermissao(DEVOLVER), rota('POST /api/devolucoes/:id/reaplicar',
    ({ req, api, hoje, usuarioId }) => registro.reaplicar({ api, devolucaoId: req.params.id, usuarioId, hoje, contextoBB })));

  return router;
}

module.exports = criarRouter();
module.exports.criarRouter = criarRouter;
