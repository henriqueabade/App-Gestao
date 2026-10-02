/**
 * Rotas das integrações automáticas (montadas em /api/contabilidade pelo
 * contabilidadeController):
 *
 *   GET    /integracoes                           estado de todas (sem segredo)          contabilidade.config.view
 *   PUT    /integracoes/:chave                    { ativa, ambiente, automatica, intervalo_min, parametros, confirmacao }   Sup Admin
 *   POST   /integracoes/:chave/credenciais        { ambiente, client_secret, destino }   Sup Admin
 *   DELETE /integracoes/:chave/credenciais        ?ambiente=&destino=                    Sup Admin
 *   POST   /integracoes/:chave/testar             fala com o serviço, não grava          contabilidade.config.view
 *   POST   /integracoes/:chave/sincronizar        { competencia? } — a busca de verdade  a permissão da integração
 *   GET    /integracoes/:chave/execucoes          o registro das buscas                  contabilidade.config.view
 *   GET    /integracoes/certificado/publico       o .cer para o portal do BB             Sup Admin
 *
 *   GET    /entrada?origem=&visao=&competencia=   a caixa de entrada (NF-e / NFS-e)      contabilidade.view
 *   GET    /entrada/:id/xml                       o XML guardado                         contabilidade.view
 *   POST   /entrada/:id/manifestar                { tipo, justificativa }                contabilidade.documento.registrar
 *   POST   /entrada/:id/baixar-xml                a NF-e completa pela chave             contabilidade.documento.registrar
 *   POST   /entrada/:id/registrar                 { gerar_titulo }                       documento.registrar (+ pagar.lancar)
 *   POST   /entrada/:id/ignorar                   { motivo }                             contabilidade.documento.registrar
 *   POST   /entrada/:id/historico                 a nota do mês anterior ao início        contabilidade.documento.registrar
 *   POST   /entrada/:id/restaurar                                                        contabilidade.documento.registrar
 *
 * Mudar a configuração e guardar segredo é do Sup Admin (como no fiscal e na
 * cobrança); ligar a produção exige a palavra PRODUCAO, conferida aqui. O
 * client_secret entra por aqui, é cifrado e nunca volta numa resposta.
 */
const express = require('express');
const { createApiClient } = require('../../apiHttpClient');
const { exigirPermissao, exigirSupAdmin, ehSupAdmin } = require('../../permissionsController');
const catalogo = require('./catalogo');
const servicoMod = require('./servico');

const VER = 'contabilidade.view';
const VER_CONFIG = 'contabilidade.config.view';
const REGISTRAR = 'contabilidade.documento.registrar';
const LANCAR = 'contabilidade.pagar.lancar';

/** Id do usuário do JWT (sem validar a assinatura — só para o registro). */
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
  res.status(status).json({ error: err?.message || 'Erro nas integrações da Contabilidade', ...(err?.extra || {}) });
}

/** Cada rota: um api por requisição e o usuário; o erro vira a resposta padrão. */
const rota = (contexto, fn) => async (req, res) => {
  try {
    res.json(await fn({ req, api: createApiClient(req), usuarioId: usuarioDaRequisicao(req) }));
  } catch (err) {
    responder(res, err, contexto);
  }
};

function criarRouter({ servico = null } = {}) {
  const router = express.Router();
  const s = servico || servicoMod.criar();

  // A chave da integração: desconhecida para aqui, antes de qualquer permissão.
  router.param('chave', (req, res, next, chave) => {
    if (!catalogo.INTEGRACOES[chave]) return res.status(404).json({ error: `Integração desconhecida: ${chave}.` });
    return next();
  });

  router.get('/integracoes', exigirPermissao(VER_CONFIG), rota('GET /integracoes', async ({ req, api }) => ({
    ...(await s.estado(api)), pode_editar: await ehSupAdmin(req)
  })));

  router.get('/integracoes/certificado/publico', exigirSupAdmin, rota('GET /integracoes/certificado/publico', async ({ api }) => {
    const r = await s.certificadoPublico(api);
    const nome = `certificado-publico-${r.cnpj || 'empresa'}.cer`;
    return { nome, tipo: 'application/x-x509-ca-cert', base64: Buffer.from(r.pem, 'utf8').toString('base64'), titular: r.titular, cnpj: r.cnpj, valido_ate: r.validoAte };
  }));

  router.put('/integracoes/:chave', exigirSupAdmin, rota('PUT /integracoes/:chave', async ({ req, api, usuarioId }) => {
    const { confirmacao, ...entrada } = req.body || {};
    const estadoAntes = await s.estado(api);
    const antes = estadoAntes.integracoes.find(i => i.chave === req.params.chave);
    if (entrada.ambiente === catalogo.PRODUCAO && antes?.ambiente_no_banco !== catalogo.PRODUCAO && String(confirmacao || '').trim().toUpperCase() !== 'PRODUCAO') {
      const e = new Error('Para ligar a produção, confirme digitando PRODUCAO.');
      e.status = 400;
      throw e;
    }
    await s.salvar(api, req.params.chave, entrada, { usuarioId });
    return { ...(await s.estado(api)), pode_editar: true };
  }));

  router.post('/integracoes/:chave/credenciais', exigirSupAdmin, rota('POST /integracoes/:chave/credenciais', async ({ req, api, usuarioId }) => {
    const def = catalogo.definicao(req.params.chave);
    if (!def.segredo) {
      const e = new Error(`${def.nome} não usa client_secret (usa o certificado da empresa).`);
      e.status = 400;
      throw e;
    }
    const ambiente = req.body?.ambiente === catalogo.PRODUCAO ? catalogo.PRODUCAO : catalogo.HOMOLOGACAO;
    await s.seg.guardarSecret(api, def.segredo, ambiente, req.body?.client_secret, { destino: req.body?.destino || null, usuarioId });
    return { ...(await s.estado(api)), pode_editar: true };
  }));

  router.delete('/integracoes/:chave/credenciais', exigirSupAdmin, rota('DELETE /integracoes/:chave/credenciais', async ({ req, api }) => {
    const def = catalogo.definicao(req.params.chave);
    const ambiente = (req.query?.ambiente || req.body?.ambiente) === catalogo.PRODUCAO ? catalogo.PRODUCAO : catalogo.HOMOLOGACAO;
    await s.seg.removerSecret(api, def.segredo || def.chave, ambiente, String(req.query?.destino || req.body?.destino || 'ambos'));
    return { ...(await s.estado(api)), pode_editar: true };
  }));

  router.post('/integracoes/:chave/testar', exigirPermissao(VER_CONFIG), rota('POST /integracoes/:chave/testar', ({ req, api, usuarioId }) =>
    s.testar(api, req.params.chave, { usuarioId })));

  router.post('/integracoes/:chave/sincronizar', exigirPermissao(req => catalogo.INTEGRACOES[req.params.chave]?.permissaoExecutar || VER_CONFIG),
    rota('POST /integracoes/:chave/sincronizar', ({ req, api, usuarioId }) =>
      s.sincronizar(api, req.params.chave, { usuarioId, tipo: 'manual', competencia: req.body?.competencia || null })));

  router.get('/integracoes/:chave/execucoes', exigirPermissao(VER_CONFIG), rota('GET /integracoes/:chave/execucoes', async ({ req, api }) =>
    require('./execucoes').recentes(api, { integracao: req.params.chave, limite: 30 }).then(r => ({ execucoes: r.linhas, sem_tabela: r.sem_tabela }))));

  // ------------------------------------------------------------ caixa de entrada

  router.get('/entrada', exigirPermissao(VER), rota('GET /entrada', ({ req, api }) =>
    s.listarEntrada(api, { origem: req.query?.origem || null, visao: req.query?.visao || 'pendentes', competencia: req.query?.competencia || null })));

  router.get('/entrada/:id/xml', exigirPermissao(VER), rota('GET /entrada/:id/xml', ({ req, api }) => s.xmlDaEntrada(api, req.params.id)));

  router.post('/entrada/:id/manifestar', exigirPermissao(REGISTRAR), rota('POST /entrada/:id/manifestar', ({ req, api, usuarioId }) =>
    s.manifestar(api, req.params.id, { tipo: req.body?.tipo, justificativa: req.body?.justificativa || null, usuarioId })));

  router.post('/entrada/:id/baixar-xml', exigirPermissao(REGISTRAR), rota('POST /entrada/:id/baixar-xml', ({ req, api, usuarioId }) =>
    s.baixarXml(api, req.params.id, { usuarioId })));

  router.post('/entrada/:id/registrar', exigirPermissao(req => (req.body?.gerar_titulo === true ? [REGISTRAR, LANCAR] : [REGISTRAR])),
    rota('POST /entrada/:id/registrar', ({ req, api, usuarioId }) =>
      s.registrarDaEntrada(api, req.params.id, { usuarioId, gerarTitulo: req.body?.gerar_titulo === true, podeLancar: req.body?.gerar_titulo === true })));

  router.post('/entrada/:id/ignorar', exigirPermissao(REGISTRAR), rota('POST /entrada/:id/ignorar', ({ req, api, usuarioId }) =>
    s.ignorarDaEntrada(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

  router.post('/entrada/:id/historico', exigirPermissao(REGISTRAR), rota('POST /entrada/:id/historico', ({ req, api, usuarioId }) =>
    s.historicoDaEntrada(api, req.params.id, { usuarioId })));

  router.post('/entrada/:id/restaurar', exigirPermissao(REGISTRAR), rota('POST /entrada/:id/restaurar', ({ req, api }) =>
    s.restaurarDaEntrada(api, req.params.id)));

  return router;
}

module.exports = { criarRouter, usuarioDaRequisicao };
