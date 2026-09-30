/**
 * Rotas da Contabilidade — /api/contabilidade/* (etapa 1: base do módulo).
 *
 *   GET  /painel?competencia=              checklist por fonte, pendências (3 severidades), situação e bloqueios
 *   GET  /atividade?competencia=&limite=   o histórico do módulo, com quem fez
 *   GET  /competencias                     as competências já fechadas/reabertas
 *   GET  /citaveis?busca=&competencia=     o que o "'" das mensagens cita (competência, documento, conta, lançamento, arquivo…)
 *   POST /fechar                           { competencia }                        (contabilidade.fechar)
 *   GET  /fechar/previa?competencia=       o que o fechamento vai congelar (etapa 7; não grava)
 *   GET  /fechamentos?competencia=         as versões do fechamento, o que mudou entre elas e desde a última
 *   POST /reabrir                          { competencia, justificativa }         (contabilidade.reabrir)
 *   POST /pendencias/ignorar               { competencia, chave, justificativa }  (contabilidade.pendencia.resolver)
 *   POST /pendencias/restaurar             { competencia, chave }                 (contabilidade.pendencia.resolver)
 *
 * Etapas 2 e 3 (documentos, evidências e contas a pagar):
 *
 *   GET  /fornecedores                     os contatos para escolher (fornecedor / prestador)
 *   GET  /categorias                       as categorias já usadas + as da contabilidade, e as formas de pagamento
 *   GET  /fechamentos-pagos                pagamentos de comissão/produção (para ligar a NFS-e)
 *   GET  /evidencias?competencia=          tudo o que prova o mês (notas, documentos, comprovantes)
 *   GET  /evidencias/xml/:tipo/:id         o XML de uma nota de saída | externa | devolução
 *   GET  /arquivos?competencia=|alvo_tipo=&alvo_id=   os arquivos
 *   GET  /arquivos/:id                     { nome, tipo, tamanho, base64 }
 *   POST /arquivos                         { nome, tipo, base64, categoria, descricao, competencia, vinculos }  (contabilidade.documento.registrar)
 *   POST /arquivos/:id/vinculos            { alvo_tipo, alvo_id }                  (contabilidade.documento.registrar)
 *   POST /arquivos/:id/excluir             { motivo }                              (contabilidade.documento.excluir)
 *   GET  /documentos?competencia=&tipo=    NF-e de entrada, NFS-e e outros
 *   GET  /documentos/:id                   a ficha (itens, arquivos, conta, histórico)
 *   POST /documentos/previa                { xml } | { chave, data_emissao, valor_total }  — lê sem gravar
 *   POST /documentos                       registra (com gerar_titulo pede também contabilidade.pagar.lancar)
 *   POST /documentos/:id/excluir           { motivo }                              (contabilidade.documento.excluir)
 *   GET  /titulos?competencia=&visao=      as parcelas da visão e os totais
 *   GET  /titulos/:id                      a conta (parcelas, pagamentos, arquivos, histórico)
 *   POST /titulos, PUT /titulos/:id        lança / altera                          (contabilidade.pagar.lancar)
 *   POST /titulos/:id/cancelar             { motivo }                              (contabilidade.pagar.estornar)
 *   POST /parcelas/:id/pagar               { data_pagamento, valor_pago, forma, observacao, comprovante? }  (contabilidade.pagar.pagar)
 *   POST /pagamentos/:id/estornar          { motivo }                              (contabilidade.pagar.estornar)
 *
 * Etapa 4 (extrato bancário):
 *
 *   GET  /contas-financeiras               as contas (e a sugestão da conta dos boletos)
 *   POST /contas-financeiras, PUT /contas-financeiras/:id   cadastra / altera   (contabilidade.contas.gerir)
 *   GET  /extrato?conta_id=&competencia=   os lançamentos do mês, totais, saldo do banco, cobertura e importações
 *   POST /extrato/previa                   { conta_id, base64 } — lê o OFX sem gravar       (contabilidade.extrato.importar)
 *   POST /extrato/importar                 { conta_id, nome, base64 }                       (contabilidade.extrato.importar)
 *   POST /extrato/importacoes/:id/desfazer { motivo }                                       (contabilidade.extrato.importar)
 *
 * Etapa 5 (conciliação do extrato):
 *
 *   GET  /conciliacao?conta_id=&competencia=&visao=   os lançamentos do mês com o que casam, as sugestões,
 *                                                     os totais e o que o app registrou sem lançamento
 *   GET  /conciliacao/movimentos/:id?dias=            o lançamento e as candidatas (escolha à mão)
 *   POST /conciliacao/movimentos/:id/conciliar        { itens: [{ tipo, id }], justificativa?, criterio? }  (contabilidade.conciliar)
 *   POST /conciliacao/movimentos/:id/desfazer         { motivo }                                          (contabilidade.conciliar)
 *   POST /conciliacao/movimentos/:id/ignorar          { motivo }                                          (contabilidade.conciliar)
 *   POST /conciliacao/movimentos/:id/reativar                                                             (contabilidade.conciliar)
 *   POST /conciliacao/movimentos/:id/criar-conta      { descricao, categoria, contato_id, forma }  (conciliar + pagar.lancar + pagar.pagar)
 *   POST /conciliacao/automatica                      { conta_id, competencia, aceitar_sugestoes }        (contabilidade.conciliar)
 *
 * Etapa 6 (classificação):
 *
 *   GET  /classificacao?competencia=&conta_id=&visao=   cada lançamento com a conta do plano e como; o total por conta
 *   POST /classificacao/classificar                     { ids, conta_id, observacao }      (contabilidade.classificar)
 *   POST /classificacao/movimentos/:id/automatico       tira a classificação à mão         (contabilidade.classificar)
 *   GET  /plano-contas, POST /plano-contas, PUT /plano-contas/:id                          (gravar: contabilidade.plano.gerir)
 *   GET  /regras, POST /regras, PUT /regras/:id        (+ sugeridas pelas classificações à mão) (gravar: contabilidade.plano.gerir)
 *   POST /regras/testar                                 { ...regra, competencia } — não grava
 *
 * Etapa 8 (relatório mensal e dossiê — leituras, nada é gravado):
 *
 *   GET  /relatorio?competencia=            o relatório do mês (mês fechado: a foto da versão; aberto: prévia)
 *   GET  /relatorio/documento?competencia=  { nome, html } — a tela imprime em PDF    (contabilidade.pacote.gerar)
 *   GET  /relatorio/planilha?competencia=   { nome, tipo, base64 } — a planilha .xlsx (contabilidade.pacote.gerar)
 *   GET  /dossie?tipo=movimento|titulo|documento&id=   tudo o que está ligado ao item, com o histórico
 *
 * Etapa 9 (o pacote para a contabilidade — o ZIP que o usuário salva e envia):
 *
 *   GET  /pacote?competencia=         se pode gerar (fechada, sem documental viva), o que vai em cada pasta, o que falta, os pacotes gerados
 *   POST /pacote                      { competencia, pdf_base64 } — gera, registra e devolve { nome, base64, hash }  (contabilidade.pacote.gerar)
 *   POST /pacote/:id/enviado          { para, meio, observacao } — marca como enviado                              (contabilidade.pacote.gerar)
 *
 * Etapas 10 a 13 (integrações automáticas — rotas em contabilidade/integracoes/rotas.js):
 *
 *   GET/PUT /integracoes[/:chave], credenciais, testar, sincronizar, execuções, certificado público
 *   GET /entrada e as ações da caixa de entrada (manifestar, baixar XML, registrar, ignorar, restaurar)
 *
 * Sem o SQL do módulo (sql/contabilidade_base.sql), o painel volta com
 * `sql_pendente: true` (a tela avisa) e as gravações respondem 409. Sem o
 * das etapas 2 e 3 (sql/contabilidade_contas_pagar.sql), as fontes novas
 * do checklist dizem "falta o SQL" e as rotas delas respondem 409.
 * Competência fechada recusa o que muda o mês (pagamento, documento, conta).
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const configuracaoCobranca = require('./cobranca/configuracaoCobranca');
const checklist = require('./contabilidade/checklist');
const fechamento = require('./contabilidade/fechamento');
const arquivos = require('./contabilidade/arquivos');
const documentos = require('./contabilidade/documentosRecebidos');
const titulos = require('./contabilidade/titulos');
const evidencias = require('./contabilidade/evidencias');
const extrato = require('./contabilidade/extrato/extrato');
const conciliacao = require('./contabilidade/conciliacao/conciliacao');
const classificacao = require('./contabilidade/classificacao/classificacao');
const plano = require('./contabilidade/classificacao/plano');
const regras = require('./contabilidade/classificacao/regras');
const relatorio = require('./contabilidade/relatorio/relatorio');
const relatorioDocumento = require('./contabilidade/relatorio/documento');
const relatorioPlanilha = require('./contabilidade/relatorio/planilha');
const dossie = require('./contabilidade/relatorio/dossie');
const pacote = require('./contabilidade/pacote/pacote');
const citaveis = require('./contabilidade/citaveis');

const VER = 'contabilidade.view';
const FECHAR = 'contabilidade.fechar';
const REABRIR = 'contabilidade.reabrir';
const RESOLVER = 'contabilidade.pendencia.resolver';
const REGISTRAR_DOCUMENTO = 'contabilidade.documento.registrar';
const EXCLUIR_DOCUMENTO = 'contabilidade.documento.excluir';
const LANCAR = 'contabilidade.pagar.lancar';
const PAGAR = 'contabilidade.pagar.pagar';
const ESTORNAR = 'contabilidade.pagar.estornar';
const IMPORTAR_EXTRATO = 'contabilidade.extrato.importar';
const GERIR_CONTAS = 'contabilidade.contas.gerir';
const CONCILIAR = 'contabilidade.conciliar';
const CLASSIFICAR = 'contabilidade.classificar';
const PLANO_GERIR = 'contabilidade.plano.gerir';
const PACOTE = 'contabilidade.pacote.gerar';

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

// O que o "'" das mensagens cita (competência, documento, conta, lançamento, arquivo…); as pendências vêm da tela.
router.get('/citaveis', exigirPermissao(VER), rota('GET /api/contabilidade/citaveis', ({ api, req, hoje }) =>
  citaveis.carregar({ api, busca: String(req.query?.busca || '').slice(0, 80), competencia: req.query?.competencia || null, hoje })));

router.post('/fechar', exigirPermissao(FECHAR), rota('POST /api/contabilidade/fechar', ({ api, req, hoje, desde, usuarioId }) =>
  fechamento.fechar({ api, competencia: req.body?.competencia, hoje, desde, usuarioId })));

// Etapa 7: o que o fechamento vai congelar (não grava) e o histórico das versões.
router.get('/fechar/previa', exigirPermissao(VER), rota('GET /api/contabilidade/fechar/previa', ({ api, req, hoje, desde }) =>
  fechamento.previa({ api, competencia: req.query?.competencia, hoje, desde })));

router.get('/fechamentos', exigirPermissao(VER), rota('GET /api/contabilidade/fechamentos', ({ api, req, hoje, desde }) =>
  fechamento.historico({ api, competencia: req.query?.competencia, hoje, desde })));

router.post('/reabrir', exigirPermissao(REABRIR), rota('POST /api/contabilidade/reabrir', ({ api, req, usuarioId }) =>
  fechamento.reabrir({ api, competencia: req.body?.competencia, justificativa: req.body?.justificativa, usuarioId })));

router.post('/pendencias/ignorar', exigirPermissao(RESOLVER), rota('POST /api/contabilidade/pendencias/ignorar', ({ api, req, hoje, desde, usuarioId }) =>
  fechamento.ignorarPendencia({ api, competencia: req.body?.competencia, chave: req.body?.chave, justificativa: req.body?.justificativa, hoje, desde, usuarioId })));

router.post('/pendencias/restaurar', exigirPermissao(RESOLVER), rota('POST /api/contabilidade/pendencias/restaurar', ({ api, req, usuarioId }) =>
  fechamento.restaurarPendencia({ api, competencia: req.body?.competencia, chave: req.body?.chave, usuarioId })));

// ------------------------------------------------------------ apoio das telas

router.get('/fornecedores', exigirPermissao(VER), rota('GET /api/contabilidade/fornecedores', ({ api }) => documentos.fornecedores(api)));

router.get('/categorias', exigirPermissao(VER), rota('GET /api/contabilidade/categorias', ({ api }) => titulos.categoriasDisponiveis(api)));

router.get('/fechamentos-pagos', exigirPermissao(VER), rota('GET /api/contabilidade/fechamentos-pagos', ({ api, hoje }) =>
  documentos.pagamentosDeFechamento(api, { hoje }).then(pagamentos => ({ pagamentos }))));

// ------------------------------------------------------------ evidências e arquivos

router.get('/evidencias', exigirPermissao(VER), rota('GET /api/contabilidade/evidencias', ({ api, req, hoje }) =>
  evidencias.carregar(api, { competencia: String(req.query?.competencia || ''), hoje })));

router.get('/evidencias/xml/:tipo/:id', exigirPermissao(VER), rota('GET /api/contabilidade/evidencias/xml', ({ api, req }) =>
  evidencias.baixarXml(api, { tipo: req.params.tipo, id: req.params.id })));

router.get('/arquivos', exigirPermissao(VER), rota('GET /api/contabilidade/arquivos', ({ api, req }) =>
  arquivos.listar(api, { competencia: req.query?.competencia || null, alvoTipo: req.query?.alvo_tipo || null, alvoId: req.query?.alvo_id || null })
    .then(lista => ({ arquivos: lista, categorias: arquivos.CATEGORIAS }))));

router.get('/arquivos/:id', exigirPermissao(VER), rota('GET /api/contabilidade/arquivos/:id', async ({ api, req }) => {
  const { arquivo, base64 } = await arquivos.ler(api, req.params.id);
  return { id: arquivo.id, nome: arquivo.nome_arquivo, tipo: arquivo.tipo_mime || 'application/octet-stream', tamanho: Number(arquivo.tamanho_bytes) || 0, base64 };
}));

router.post('/arquivos', exigirPermissao(REGISTRAR_DOCUMENTO), rota('POST /api/contabilidade/arquivos', async ({ api, req, usuarioId }) => {
  const corpo = req.body || {};
  const { arquivo, reaproveitado } = await arquivos.salvar(api, {
    nome: corpo.nome, tipo: corpo.tipo, base64: corpo.base64, categoria: corpo.categoria || 'outro', origem: 'fornecido',
    competencia: corpo.competencia || null, descricao: corpo.descricao || null, vinculos: corpo.vinculos || [], usuarioId
  });
  return { id: arquivo.id, reaproveitado };
}));

router.post('/arquivos/:id/vinculos', exigirPermissao(REGISTRAR_DOCUMENTO), rota('POST /api/contabilidade/arquivos/:id/vinculos', ({ api, req, usuarioId }) =>
  arquivos.vincular(api, req.params.id, req.body || {}, usuarioId)));

router.post('/arquivos/:id/excluir', exigirPermissao(EXCLUIR_DOCUMENTO), rota('POST /api/contabilidade/arquivos/:id/excluir', ({ api, req, usuarioId }) =>
  arquivos.excluir(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

// ------------------------------------------------------------ documentos recebidos

router.get('/documentos', exigirPermissao(VER), rota('GET /api/contabilidade/documentos', ({ api, req }) =>
  documentos.listar(api, { competencia: req.query?.competencia || null, tipo: req.query?.tipo || null })));

router.get('/documentos/:id', exigirPermissao(VER), rota('GET /api/contabilidade/documentos/:id', ({ api, req }) =>
  documentos.detalhe(api, req.params.id)));

router.post('/documentos/previa', exigirPermissao(REGISTRAR_DOCUMENTO), rota('POST /api/contabilidade/documentos/previa', ({ api, req, hoje }) =>
  documentos.previa(api, { entrada: req.body || {}, hoje })));

/** Registrar e já gerar a conta pede as duas permissões. */
const permissoesDoRegistro = req => (req.body?.gerar_titulo === true ? [REGISTRAR_DOCUMENTO, LANCAR] : [REGISTRAR_DOCUMENTO]);

router.post('/documentos', exigirPermissao(permissoesDoRegistro), rota('POST /api/contabilidade/documentos', ({ api, req, hoje, usuarioId }) =>
  documentos.registrar(api, { entrada: req.body || {}, usuarioId, hoje, podeLancar: req.body?.gerar_titulo === true })));

router.post('/documentos/:id/excluir', exigirPermissao(EXCLUIR_DOCUMENTO), rota('POST /api/contabilidade/documentos/:id/excluir', ({ api, req, usuarioId }) =>
  documentos.excluir(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

// ------------------------------------------------------------ contas a pagar

router.get('/titulos', exigirPermissao(VER), rota('GET /api/contabilidade/titulos', ({ api, req, hoje }) =>
  titulos.listar(api, { visao: String(req.query?.visao || 'abertas'), competencia: String(req.query?.competencia || ''), hoje })));

router.get('/titulos/:id', exigirPermissao(VER), rota('GET /api/contabilidade/titulos/:id', ({ api, req, hoje }) =>
  titulos.detalhe(api, req.params.id, { hoje })));

router.post('/titulos', exigirPermissao(LANCAR), rota('POST /api/contabilidade/titulos', ({ api, req, hoje, usuarioId }) =>
  titulos.criar(api, { entrada: req.body || {}, usuarioId, hoje })));

router.put('/titulos/:id', exigirPermissao(LANCAR), rota('PUT /api/contabilidade/titulos/:id', ({ api, req, hoje, usuarioId }) =>
  titulos.editar(api, req.params.id, { entrada: req.body || {}, usuarioId, hoje })));

router.post('/titulos/:id/cancelar', exigirPermissao(ESTORNAR), rota('POST /api/contabilidade/titulos/:id/cancelar', ({ api, req, usuarioId }) =>
  titulos.cancelar(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

router.post('/parcelas/:id/pagar', exigirPermissao(PAGAR), rota('POST /api/contabilidade/parcelas/:id/pagar', ({ api, req, hoje, usuarioId }) =>
  titulos.pagar(api, req.params.id, { entrada: req.body || {}, usuarioId, hoje })));

router.post('/pagamentos/:id/estornar', exigirPermissao(ESTORNAR), rota('POST /api/contabilidade/pagamentos/:id/estornar', ({ api, req, usuarioId }) =>
  titulos.estornar(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

// ------------------------------------------------------------ extrato bancário

router.get('/contas-financeiras', exigirPermissao(VER), rota('GET /api/contabilidade/contas-financeiras', ({ api }) => extrato.listarContas(api)));

router.post('/contas-financeiras', exigirPermissao(GERIR_CONTAS), rota('POST /api/contabilidade/contas-financeiras', ({ api, req, usuarioId }) =>
  extrato.salvarConta(api, { entrada: req.body || {}, usuarioId })));

router.put('/contas-financeiras/:id', exigirPermissao(GERIR_CONTAS), rota('PUT /api/contabilidade/contas-financeiras/:id', ({ api, req, usuarioId }) =>
  extrato.salvarConta(api, { id: req.params.id, entrada: req.body || {}, usuarioId })));

router.get('/extrato', exigirPermissao(VER), rota('GET /api/contabilidade/extrato', ({ api, req, hoje }) =>
  extrato.movimentos(api, { contaId: req.query?.conta_id || null, competencia: String(req.query?.competencia || ''), hoje })));

router.post('/extrato/previa', exigirPermissao(IMPORTAR_EXTRATO), rota('POST /api/contabilidade/extrato/previa', ({ api, req }) =>
  extrato.previa(api, { contaId: req.body?.conta_id, base64: req.body?.base64 })));

router.post('/extrato/importar', exigirPermissao(IMPORTAR_EXTRATO), rota('POST /api/contabilidade/extrato/importar', ({ api, req, usuarioId }) =>
  extrato.importar(api, { contaId: req.body?.conta_id, nome: req.body?.nome, base64: req.body?.base64, usuarioId })));

router.post('/extrato/importacoes/:id/desfazer', exigirPermissao(IMPORTAR_EXTRATO), rota('POST /api/contabilidade/extrato/importacoes/:id/desfazer', ({ api, req, usuarioId }) =>
  extrato.desfazer(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

// ------------------------------------------------------------ conciliação (etapa 5)

router.get('/conciliacao', exigirPermissao(VER), rota('GET /api/contabilidade/conciliacao', ({ api, req, hoje }) =>
  conciliacao.painel(api, { contaId: req.query?.conta_id || null, competencia: String(req.query?.competencia || ''), visao: String(req.query?.visao || 'todos'), hoje })));

router.get('/conciliacao/movimentos/:id', exigirPermissao(VER), rota('GET /api/contabilidade/conciliacao/movimentos/:id', ({ api, req }) =>
  conciliacao.candidatos(api, req.params.id, { dias: req.query?.dias })));

router.post('/conciliacao/movimentos/:id/conciliar', exigirPermissao(CONCILIAR), rota('POST /api/contabilidade/conciliacao/movimentos/:id/conciliar', ({ api, req, usuarioId }) =>
  conciliacao.conciliar(api, req.params.id, { itens: req.body?.itens, justificativa: req.body?.justificativa, criterio: req.body?.criterio, usuarioId })));

router.post('/conciliacao/movimentos/:id/desfazer', exigirPermissao(CONCILIAR), rota('POST /api/contabilidade/conciliacao/movimentos/:id/desfazer', ({ api, req, usuarioId }) =>
  conciliacao.desfazer(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

router.post('/conciliacao/movimentos/:id/ignorar', exigirPermissao(CONCILIAR), rota('POST /api/contabilidade/conciliacao/movimentos/:id/ignorar', ({ api, req, usuarioId }) =>
  conciliacao.ignorar(api, req.params.id, { motivo: req.body?.motivo, usuarioId })));

router.post('/conciliacao/movimentos/:id/reativar', exigirPermissao(CONCILIAR), rota('POST /api/contabilidade/conciliacao/movimentos/:id/reativar', ({ api, req, usuarioId }) =>
  conciliacao.reativar(api, req.params.id, { usuarioId })));

// Lançar a conta paga a partir do débito: concilia e lança conta/pagamento (as três permissões).
router.post('/conciliacao/movimentos/:id/criar-conta', exigirPermissao([CONCILIAR, LANCAR, PAGAR]), rota('POST /api/contabilidade/conciliacao/movimentos/:id/criar-conta', ({ api, req, usuarioId, hoje }) =>
  conciliacao.criarConta(api, req.params.id, { entrada: req.body || {}, usuarioId, hoje })));

router.post('/conciliacao/automatica', exigirPermissao(CONCILIAR), rota('POST /api/contabilidade/conciliacao/automatica', ({ api, req, usuarioId, hoje }) =>
  conciliacao.automatica(api, { contaId: req.body?.conta_id, competencia: String(req.body?.competencia || ''), aceitarSugestoes: req.body?.aceitar_sugestoes === true, usuarioId, hoje })));

// ------------------------------------------------------------ classificação (etapa 6)

router.get('/classificacao', exigirPermissao(VER), rota('GET /api/contabilidade/classificacao', ({ api, req, hoje }) =>
  classificacao.painel(api, { competencia: String(req.query?.competencia || ''), contaId: req.query?.conta_id || null, visao: String(req.query?.visao || 'todos'), hoje })));

router.post('/classificacao/classificar', exigirPermissao(CLASSIFICAR), rota('POST /api/contabilidade/classificacao/classificar', ({ api, req, usuarioId }) =>
  classificacao.classificar(api, { ids: req.body?.ids, conta_id: req.body?.conta_id, observacao: req.body?.observacao, usuarioId })));

router.post('/classificacao/movimentos/:id/automatico', exigirPermissao(CLASSIFICAR), rota('POST /api/contabilidade/classificacao/movimentos/:id/automatico', ({ api, req, usuarioId }) =>
  classificacao.voltarAoAutomatico(api, req.params.id, { usuarioId })));

router.get('/plano-contas', exigirPermissao(VER), rota('GET /api/contabilidade/plano-contas', ({ api }) => plano.listar(api)));

router.post('/plano-contas', exigirPermissao(PLANO_GERIR), rota('POST /api/contabilidade/plano-contas', ({ api, req, usuarioId }) =>
  plano.salvar(api, { entrada: req.body || {}, usuarioId })));

router.put('/plano-contas/:id', exigirPermissao(PLANO_GERIR), rota('PUT /api/contabilidade/plano-contas/:id', ({ api, req, usuarioId }) =>
  plano.salvar(api, { id: req.params.id, entrada: req.body || {}, usuarioId })));

router.get('/regras', exigirPermissao(VER), rota('GET /api/contabilidade/regras', ({ api }) => classificacao.listarRegras(api)));

// Testar não grava: basta ver a Contabilidade.
router.post('/regras/testar', exigirPermissao(VER), rota('POST /api/contabilidade/regras/testar', ({ api, req, hoje }) =>
  classificacao.testarRegra(api, { entrada: req.body || {}, competencia: String(req.body?.competencia || ''), hoje })));

router.post('/regras', exigirPermissao(PLANO_GERIR), rota('POST /api/contabilidade/regras', ({ api, req, usuarioId }) =>
  regras.salvar(api, { entrada: req.body || {}, usuarioId })));

router.put('/regras/:id', exigirPermissao(PLANO_GERIR), rota('PUT /api/contabilidade/regras/:id', ({ api, req, usuarioId }) =>
  regras.salvar(api, { id: req.params.id, entrada: req.body || {}, usuarioId })));

// ------------------------------------------------------------ relatório mensal e dossiê (etapa 8)

// Ver na tela basta ver a Contabilidade; salvar o PDF ou a planilha (o que vai para a contabilidade) pede "Relatório e pacote".
router.get('/relatorio', exigirPermissao(VER), rota('GET /api/contabilidade/relatorio', ({ api, req, hoje, desde }) =>
  relatorio.montar(api, { competencia: req.query?.competencia, hoje, desde })));

router.get('/relatorio/documento', exigirPermissao(PACOTE), rota('GET /api/contabilidade/relatorio/documento', async ({ api, req, hoje, desde }) => {
  const rel = await relatorio.montar(api, { competencia: req.query?.competencia, hoje, desde });
  return { nome: rel.arquivo, html: relatorioDocumento.html(rel), versao: rel.situacao.versao, previa: rel.situacao.previa };
}));

router.get('/relatorio/planilha', exigirPermissao(PACOTE), rota('GET /api/contabilidade/relatorio/planilha', async ({ api, req, hoje, desde }) => {
  const rel = await relatorio.montar(api, { competencia: req.query?.competencia, hoje, desde });
  const bytes = await relatorioPlanilha.gerar(rel);
  return { nome: `${rel.arquivo}.xlsx`, tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: bytes.toString('base64'), versao: rel.situacao.versao, previa: rel.situacao.previa };
}));

router.get('/dossie', exigirPermissao(VER), rota('GET /api/contabilidade/dossie', ({ api, req, hoje }) =>
  dossie.carregar(api, { tipo: String(req.query?.tipo || ''), id: req.query?.id, hoje })));

// ------------------------------------------------------------ pacote para a contabilidade (etapa 9)

router.get('/pacote', exigirPermissao(VER), rota('GET /api/contabilidade/pacote', ({ api, req, hoje, desde }) =>
  pacote.previa(api, { competencia: req.query?.competencia, hoje, desde })));

router.post('/pacote', exigirPermissao(PACOTE), rota('POST /api/contabilidade/pacote', ({ api, req, hoje, desde, usuarioId }) =>
  pacote.gerar(api, { competencia: req.body?.competencia, hoje, desde, usuarioId, pdfBase64: req.body?.pdf_base64 || null })));

router.post('/pacote/:id/enviado', exigirPermissao(PACOTE), rota('POST /api/contabilidade/pacote/:id/enviado', ({ api, req, usuarioId }) =>
  pacote.marcarEnviado(api, req.params.id, { entrada: req.body || {}, usuarioId })));

// Etapas 10 a 13: integrações automáticas (SEFAZ, BB, ADN) e a caixa de entrada —
// /integracoes/* e /entrada/* (backend/contabilidade/integracoes/rotas.js).
router.use(require('./contabilidade/integracoes/rotas').criarRouter());

module.exports = router;
