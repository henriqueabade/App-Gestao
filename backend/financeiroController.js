/**
 * Rotas do Financeiro completo — /api/financeiro/* (etapa 6, fase G):
 * comissões CMS e Royalty, ajustes, produção, fechamentos e pagamentos.
 *
 *   GET    /painel?competencia=                 cartões, resumos, pendências e atividade
 *   GET    /regras                              regras de CMS/Royalty, setores, valores por peça, feriados, prazos
 *   POST   /regras, PUT /regras/:id             cria / altera (ativo: false desliga)
 *   POST   /setores, PUT /setores/:id
 *   POST   /valores                             { setor_id, produto_id|null, valor_unitario } ou { ..., remover: true }
 *   POST   /feriados, DELETE /feriados/:id
 *   PUT    /configuracao                        dia do pagamento das comissões, dia útil da produção, sábado
 *   GET    /buscas/clientes|pedidos|produtos    listas enxutas para escolher na tela de regras
 *   GET    /parcelas?visao=atrasadas|previstas|ajustaveis
 *   GET    /parcelas/:pedidoId/:numero          detalhes da parcela (valores, ajustes, histórico)
 *   POST   /ajustes, POST /ajustes/:id/cancelar
 *   GET    /producao/pedidos                    pedidos em que se registra produção
 *   GET    /producao/pedidos/:id                itens, saldo por setor e registros
 *   POST   /producao, POST /producao/:id/estornar
 *   GET    /producao?competencia=               a produção da competência (prévia ou fechada)
 *   GET    /fechamentos/previa?tipo=&competencia=
 *   GET    /fechamentos?tipo=
 *   POST   /fechamentos                         { tipo, competencia }
 *   POST   /pagamentos                          { tipo, competencia, data_pagamento, forma, observacao }
 *   GET    /relatorios/:chave?competencia=&inicio=&fim=
 *   GET    /pedidos/:id                         visão consolidada do pedido
 *
 * Permissões separadas (spec §21): ver (financeiro.comissao.view), editar
 * regras, registrar ajuste, registrar produção, fechar competência e
 * confirmar pagamento. Sem o SQL da fase, as rotas respondem 409 com
 * `sql_pendente`.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const { usuarioDaRequisicao } = require('./cobrancaController');
const configuracaoCobranca = require('./cobranca/configuracaoCobranca');
const c = require('./financeiro/comum');
const regras = require('./financeiro/regras');
const comissoes = require('./financeiro/comissoes');
const ajustes = require('./financeiro/ajustes');
const producao = require('./financeiro/producao');
const fechamentos = require('./financeiro/fechamentos');
const painel = require('./financeiro/painel');
const relatorios = require('./financeiro/relatorios');
const detalhes = require('./financeiro/detalhes');
const base = require('./financeiro/base');

const VER = 'financeiro.comissao.view';
const EDITAR_REGRAS = 'financeiro.regras.editar';
const REGISTRAR_AJUSTE = 'financeiro.ajuste.registrar';
const REGISTRAR_PRODUCAO = 'financeiro.producao.registrar';
const FECHAR = 'financeiro.competencia.fechar';
const PAGAR = 'financeiro.pagamento.confirmar';

function hojeEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  const v = tipo => partes.find(p => p.type === tipo)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno no Financeiro', ...(err?.extra || {}) });
}

/** O corte "controlar a partir de" das contas a receber (fase E); sem a configuração, sem corte. */
async function desdeDe(api) {
  const cfg = await configuracaoCobranca.carregar(api).catch(() => null);
  return cfg?.recebimentos_desde || null;
}

/**
 * Cada rota: um api por requisição, hoje em Brasília, o usuário e o corte;
 * o erro vira a resposta padrão.
 */
function rota(contexto, fn) {
  return async (req, res) => {
    try {
      const api = createApiClient(req);
      const ctx = { req, api, hoje: hojeEmBrasilia(), usuarioId: usuarioDaRequisicao(req), desde: null };
      ctx.desde = await desdeDe(api);
      res.json(await fn(ctx));
    } catch (err) {
      responder(res, err, contexto);
    }
  };
}

const linhaDaParcela = p => ({
  pedido_id: p.pedido_id, pedido: p.pedido, cliente_id: p.cliente_id, cliente: p.cliente, nf: p.nf,
  numero_parcela: p.numero_parcela, parcela: p.parcela, vencimento: p.vencimento, dias_atraso: p.dias_atraso, faixa: p.faixa,
  situacao: p.situacao, estado_parcela: p.estado_parcela, controlada: p.controlada,
  valor_original: p.valor_original, abatimento_boleto: p.abatimento_boleto, ajustes_total: p.ajustes_total, liquido: p.liquido,
  cms: p.potencial.cms, royalty: p.potencial.royalty, comissao: p.potencial.total,
  taxas: { cms: p.taxas.cms, royalty: p.taxas.royalty, pct_cms: p.taxas.pct_cms, pct_royalty: p.taxas.pct_royalty, congeladas: p.taxas.congeladas },
  sem_regra: p.sem_regra, comissao_fechada: p.comissao_fechada,
  boleto: p.boleto ? { id: p.boleto.id, status: p.boleto.status, nosso_numero: p.boleto.nosso_numero } : null,
  recebimento: p.recebimento
});

function criarRouter() {
  const router = express.Router();

  router.get('/painel', exigirPermissao(VER), rota('GET /api/financeiro/painel', ({ api, req, hoje, desde }) =>
    painel.carregar({ api, competencia: String(req.query?.competencia || ''), hoje, desde })));

  // ------------------------------------------------------------- regras
  router.get('/regras', exigirPermissao(VER), rota('GET /api/financeiro/regras', ({ api }) => regras.paraTela(api)));
  router.post('/regras', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/regras', ({ api, req, usuarioId }) =>
    regras.salvarRegra({ api, entrada: req.body, usuarioId })));
  router.put('/regras/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/regras/:id', ({ api, req, usuarioId }) =>
    regras.salvarRegra({ api, id: req.params.id, entrada: req.body, usuarioId })));
  router.post('/setores', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/setores', ({ api, req, usuarioId }) =>
    regras.salvarSetor({ api, entrada: req.body, usuarioId })));
  router.put('/setores/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/setores/:id', ({ api, req, usuarioId }) =>
    regras.salvarSetor({ api, id: req.params.id, entrada: req.body, usuarioId })));
  router.post('/valores', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/valores', async ({ api, req, usuarioId }) =>
    ({ valor: await regras.salvarValor({ api, entrada: req.body, usuarioId }) })));
  router.post('/feriados', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/feriados', ({ api, req, usuarioId }) =>
    regras.adicionarFeriado({ api, entrada: req.body, usuarioId })));
  router.delete('/feriados/:id', exigirPermissao(EDITAR_REGRAS), rota('DELETE /api/financeiro/feriados/:id', async ({ api, req, usuarioId }) =>
    ({ removido: await regras.removerFeriado({ api, id: req.params.id, usuarioId }) })));
  router.put('/configuracao', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/configuracao', ({ api, req, usuarioId }) =>
    regras.salvarConfiguracao({ api, entrada: req.body, usuarioId })));

  // Listas enxutas para escolher cliente, pedido ou peça nas regras (sem depender dos módulos de origem).
  router.get('/buscas/:alvo', exigirPermissao(VER), rota('GET /api/financeiro/buscas/:alvo', async ({ api, req }) => {
    const alvo = String(req.params.alvo);
    if (alvo === 'clientes') {
      const linhas = c.lista(await api.get('/api/clientes', { query: { select: 'id,nome_fantasia,razao_social' } }).catch(() => []));
      return linhas.map(x => ({ id: x.id, nome: c.nomeDoCliente(x) || `Cliente ${x.id}` })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    if (alvo === 'pedidos') {
      const linhas = c.lista(await api.get('/api/pedidos', { query: { select: 'id,numero,cliente_id,situacao' } }).catch(() => [])).filter(p => String(p.situacao || '').toLowerCase() !== 'cancelado');
      return linhas.map(p => ({ id: p.id, numero: p.numero ?? String(p.id), cliente_id: p.cliente_id ?? null, situacao: p.situacao }))
        .sort((a, b) => String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
    }
    if (alvo === 'produtos') {
      const linhas = c.lista(await api.get('/api/produtos', { query: { select: 'id,codigo,nome' } }).catch(() => []));
      return linhas.map(p => ({ id: p.id, codigo: p.codigo || null, nome: p.nome || null })).sort((a, b) => String(a.codigo || a.nome).localeCompare(String(b.codigo || b.nome), 'pt-BR', { numeric: true }));
    }
    throw c.erro('Busca desconhecida.', 404);
  }));

  // ------------------------------------------------------------ parcelas
  router.get('/parcelas', exigirPermissao(VER), rota('GET /api/financeiro/parcelas', async ({ api, req, hoje, desde }) => {
    const visao = String(req.query?.visao || 'atrasadas');
    if (!['atrasadas', 'previstas', 'ajustaveis'].includes(visao)) throw c.erro('Visão desconhecida.', 400);
    const { b, apuradas } = await fechamentos.dadosComissao(api, { competencia: c.competenciaDe(hoje), hoje, desde });
    const v = comissoes.visoes(apuradas);
    let escolhidas;
    if (visao === 'atrasadas') escolhidas = v.atrasadas;
    else if (visao === 'previstas') escolhidas = v.previstas;
    else escolhidas = apuradas.filter(p => p.estado_parcela !== 'cancelada' && p.situacao !== 'nao_realizada')
      .sort((x, y) => String(y.pedido).localeCompare(String(x.pedido), 'pt-BR', { numeric: true }) || x.numero_parcela - y.numero_parcela);
    const nomes = await base.nomesDosClientes(api, escolhidas.map(p => p.cliente_id));
    const linhas = escolhidas.map(p => ({ ...linhaDaParcela(p), cliente: p.cliente || nomes.get(String(p.cliente_id)) || null }));
    return {
      visao, hoje, linhas,
      aging: visao === 'atrasadas' ? comissoes.aging(escolhidas) : null,
      tem_regras: b.regras.regras.some(r => regras.ativo(r.ativo))
    };
  }));
  router.get('/parcelas/:pedidoId/:numero', exigirPermissao(VER), rota('GET /api/financeiro/parcelas/:pedidoId/:numero', ({ api, req, hoje, desde }) =>
    detalhes.parcela({ api, pedidoId: Number(req.params.pedidoId), numero: Number(req.params.numero), hoje, desde })));

  // ------------------------------------------------------------- ajustes
  router.post('/ajustes', exigirPermissao(REGISTRAR_AJUSTE), rota('POST /api/financeiro/ajustes', ({ api, req, usuarioId, hoje, desde }) =>
    ajustes.registrar({ api, entrada: req.body, usuarioId, hoje, desde })));
  router.post('/ajustes/:id/cancelar', exigirPermissao(REGISTRAR_AJUSTE), rota('POST /api/financeiro/ajustes/:id/cancelar', async ({ api, req, usuarioId, hoje, desde }) =>
    ({ ajuste: await ajustes.cancelar({ api, id: req.params.id, motivo: req.body?.motivo, usuarioId, hoje, desde }) })));

  // ------------------------------------------------------------ produção
  router.get('/producao/pedidos', exigirPermissao(REGISTRAR_PRODUCAO), rota('GET /api/financeiro/producao/pedidos', async ({ api }) =>
    ({ pedidos: await producao.pedidosParaProduzir(api) })));
  router.get('/producao/pedidos/:id', exigirPermissao(REGISTRAR_PRODUCAO), rota('GET /api/financeiro/producao/pedidos/:id', ({ api, req }) =>
    producao.doPedido(api, req.params.id)));
  router.post('/producao', exigirPermissao(REGISTRAR_PRODUCAO), rota('POST /api/financeiro/producao', ({ api, req, usuarioId, hoje }) =>
    producao.registrar({ api, entrada: req.body, usuarioId, hoje })));
  router.post('/producao/:id/estornar', exigirPermissao(REGISTRAR_PRODUCAO), rota('POST /api/financeiro/producao/:id/estornar', ({ api, req, usuarioId, hoje }) =>
    producao.estornar({ api, id: req.params.id, motivo: req.body?.motivo, usuarioId, hoje })));
  router.get('/producao', exigirPermissao(VER), rota('GET /api/financeiro/producao', ({ api, req, hoje, desde }) =>
    fechamentos.previa({ api, tipo: 'producao', competencia: c.competenciaValida(req.query?.competencia) ? req.query.competencia : c.competenciaDe(hoje), hoje, desde })));

  // ---------------------------------------------------------- fechamentos
  router.get('/fechamentos/previa', exigirPermissao(VER), rota('GET /api/financeiro/fechamentos/previa', ({ api, req, hoje, desde }) =>
    fechamentos.previa({ api, tipo: String(req.query?.tipo || ''), competencia: String(req.query?.competencia || ''), hoje, desde })));
  router.get('/fechamentos', exigirPermissao(VER), rota('GET /api/financeiro/fechamentos', async ({ api, req }) =>
    ({ fechamentos: await fechamentos.listar(api, String(req.query?.tipo || '')) })));
  router.post('/fechamentos', exigirPermissao(FECHAR), rota('POST /api/financeiro/fechamentos', ({ api, req, usuarioId, hoje, desde }) =>
    fechamentos.fechar({ api, tipo: String(req.body?.tipo || ''), competencia: String(req.body?.competencia || ''), hoje, desde, usuarioId })));
  router.post('/pagamentos', exigirPermissao(PAGAR), rota('POST /api/financeiro/pagamentos', ({ api, req, usuarioId, hoje }) =>
    fechamentos.pagar({ api, entrada: req.body, hoje, usuarioId })));

  // ---------------------------------------------------------- relatórios
  router.get('/relatorios/:chave', exigirPermissao(VER), rota('GET /api/financeiro/relatorios/:chave', ({ api, req, hoje, desde }) =>
    relatorios.gerar({
      api, chave: String(req.params.chave), competencia: String(req.query?.competencia || ''),
      inicio: String(req.query?.inicio || ''), fim: String(req.query?.fim || ''), hoje, desde
    })));

  router.get('/pedidos/:id', exigirPermissao(VER), rota('GET /api/financeiro/pedidos/:id', ({ api, req, hoje, desde }) =>
    detalhes.pedido({ api, pedidoId: req.params.id, hoje, desde })));

  return router;
}

const router = criarRouter();
module.exports = router;
module.exports.criarRouter = criarRouter;
module.exports.hojeEmBrasilia = hojeEmBrasilia;
