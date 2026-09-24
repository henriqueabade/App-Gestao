/**
 * Rotas do Financeiro completo — /api/financeiro/* (etapa 6, fase G):
 * comissões CMS e Royalty, ajustes, produção, fechamentos e pagamentos.
 *
 *   GET    /painel?competencia=                 cartões, resumos, pendências e atividade
 *   GET    /atividade?limite=                   o histórico do módulo inteiro, com quem fez (o modal "Ver todas")
 *   GET    /regras                              regras de CMS/Royalty, setores, valores por peça, feriados, prazos
 *   POST   /regras, PUT /regras/:id             cria / altera (ativo: false desliga)
 *   POST   /setores, PUT /setores/:id           (fase G, sem uso na tela: os setores viraram os processos)
 *   POST   /etapas, PUT /etapas/:id, DELETE /etapas/:id   processos: incluir, renomear, ligar/desligar o pagamento, excluir
 *   POST   /valores                             { etapa_id, produto_id|null, tipo: valor|percentual, valor } ou { ..., remover: true }
 *   GET    /regra-producao?produto_id=          a regra de produção de uma peça (o botão "Regra Produção" do cadastro)
 *   PUT    /regra-producao/:produtoId           { valores: [{ etapa_id, modo: padrao|valor|percentual, valor }] }
 *   POST   /feriados, DELETE /feriados/:id
 *   PUT    /configuracao                        dia do pagamento das comissões, dia útil da produção, sábado
 *   GET    /buscas/clientes|pedidos|produtos|donos   listas enxutas para escolher na tela de regras
 *   GET    /parcelas?visao=atrasadas|previstas|ajustaveis[&competencia=]  (com a competência: as do mês, que passam para os seguintes até serem pagas)
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
const { exigirPermissao, exigirAlgumaPermissao, exigirSupAdmin, ehSupAdmin } = require('./permissionsController');
const { usuarioDaRequisicao } = require('./cobrancaController');
const configuracaoCobranca = require('./cobranca/configuracaoCobranca');
const c = require('./financeiro/comum');
const regras = require('./financeiro/regras');
const comissoes = require('./financeiro/comissoes');
const ajustes = require('./financeiro/ajustes');
const producao = require('./financeiro/producao');
const confirmacao = require('./financeiro/producaoConfirmacao');
const fechamentos = require('./financeiro/fechamentos');
const painel = require('./financeiro/painel');
const relatorios = require('./financeiro/relatorios');
const detalhes = require('./financeiro/detalhes');
const base = require('./financeiro/base');
const auditoria = require('./financeiro/auditoria');
const rateios = require('./financeiro/rateios');

const VER = 'financeiro.comissao.view';
const EDITAR_REGRAS = 'financeiro.regras.editar';
const REGISTRAR_AJUSTE = 'financeiro.ajuste.registrar';
/** A regra de produção da peça é lida e gravada também pelo cadastro de peças. */
const LEEM_REGRA_DA_PECA = ['prod.create', 'prod.edit', 'prod.clone', 'prod.details.view', VER];
const GRAVAM_REGRA_DA_PECA = ['prod.create', 'prod.edit', 'prod.clone', 'financeiro.regras.editar'];
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
  // Quem recebe (CMS/Royalty por pessoa): a tela usa nas etiquetas e no filtro.
  benef_lista: (p.potencial.beneficiarios || []).map(x => ({
    tipo: x.tipo, beneficiario: x.beneficiario, valor: x.valor,
    percentual: x.percentual === null || x.percentual === undefined ? null : Number(x.percentual)
  })),
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
  // `pode_excluir` diz à tela se aparece o botão de EXCLUIR a regra (só Sup Admin).
  router.get('/regras', exigirPermissao(VER), rota('GET /api/financeiro/regras', async ({ api, req }) =>
    ({ ...(await regras.paraTela(api)), pode_excluir: await ehSupAdmin(req) })));
  router.post('/regras', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/regras', ({ api, req, usuarioId }) =>
    regras.salvarRegra({ api, entrada: req.body, usuarioId })));
  router.put('/regras/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/regras/:id', ({ api, req, usuarioId }) =>
    regras.salvarRegra({ api, id: req.params.id, entrada: req.body, usuarioId })));
  // Desativar guarda o histórico; EXCLUIR some com a linha — por isso só o Sup Admin.
  router.delete('/regras/:id', exigirSupAdmin, rota('DELETE /api/financeiro/regras/:id', async ({ api, req, usuarioId }) =>
    ({ removida: await regras.removerRegra({ api, id: req.params.id, usuarioId }) })));
  // ------------------------------- colaboradores e rateio das comissões
  // A comissão de cada PEÇA contabilizada é repartida entre colaboradores,
  // em %. Fechar a competência exige 100% em toda peça — mas só quando há
  // colaborador cadastrado (ver backend/financeiro/rateios.js).
  router.get('/colaboradores', exigirPermissao(VER), rota('GET /api/financeiro/colaboradores', async ({ api }) => {
    const lista = await rateios.listarColaboradores(api, { incluirDesligados: true });
    return lista === null
      ? { sql_pendente: true, arquivo: rateios.SQL_ARQUIVO, colaboradores: [] }
      : { sql_pendente: false, colaboradores: lista };
  }));
  router.post('/colaboradores', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/colaboradores', ({ api, req, usuarioId }) =>
    rateios.salvarColaborador({ api, dados: req.body, usuarioId })));
  router.put('/colaboradores/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/colaboradores/:id', ({ api, req, usuarioId }) =>
    rateios.salvarColaborador({ api, dados: { ...req.body, id: req.params.id }, usuarioId })));
  router.delete('/colaboradores/:id', exigirPermissao(EDITAR_REGRAS), rota('DELETE /api/financeiro/colaboradores/:id', ({ api, req, usuarioId }) =>
    rateios.removerColaborador({ api, id: req.params.id, usuarioId })));

  /**
   * Os PROCESSOS contabilizados da competência (o que já foi decidido no
   * mês), com o que cada um já distribuiu. Dá para ratear a qualquer momento:
   * processo ainda não confirmado nem aparece aqui.
   */
  router.get('/rateio', exigirPermissao(VER), rota('GET /api/financeiro/rateio', async ({ api, req, hoje, desde }) => {
    const competencia = String(req.query?.competencia || '') || c.competenciaDe(hoje);
    const previa = await fechamentos.previa({ api, tipo: 'producao', competencia, hoje, desde });
    const visao = await rateios.lerVisao({ api, linhas: previa.linhas || [] });
    return {
      competencia, fechado: Boolean(previa.fechado),
      a_pagar: previa.a_pagar, pagar_ate: previa.pagar_ate,
      // O que ainda espera decisão na competência: a tela avisa que o rateio
      // do que falta só aparece depois de confirmado.
      bloqueios: previa.bloqueios || [], pode_fechar: Boolean(previa.pode_fechar),
      ...visao
    };
  }));
  router.post('/rateio/peca', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/rateio/peca', ({ api, req, usuarioId }) =>
    rateios.aplicarNaPeca({ api, dados: req.body, usuarioId })));
  router.post('/rateio', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/rateio', ({ api, req, usuarioId }) =>
    rateios.salvarLinha({ api, dados: req.body, usuarioId })));
  router.put('/rateio/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/rateio/:id', ({ api, req, usuarioId }) =>
    rateios.salvarLinha({ api, dados: { ...req.body, id: req.params.id }, usuarioId })));
  router.delete('/rateio/:id', exigirPermissao(EDITAR_REGRAS), rota('DELETE /api/financeiro/rateio/:id', ({ api, req, usuarioId }) =>
    rateios.removerLinha({ api, id: req.params.id, usuarioId })));

  router.post('/setores', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/setores', ({ api, req, usuarioId }) =>
    regras.salvarSetor({ api, entrada: req.body, usuarioId })));
  router.put('/setores/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/setores/:id', ({ api, req, usuarioId }) =>
    regras.salvarSetor({ api, id: req.params.id, entrada: req.body, usuarioId })));
  router.post('/valores', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/valores', async ({ api, req, usuarioId }) =>
    ({ valor: await regras.salvarValor({ api, entrada: req.body, usuarioId }) })));

  // Processos (etapas_producao): os mesmos da peça e da matéria-prima.
  router.post('/etapas', exigirPermissao(EDITAR_REGRAS), rota('POST /api/financeiro/etapas', ({ api, req, usuarioId }) =>
    regras.salvarEtapa({ api, entrada: req.body, usuarioId })));
  router.put('/etapas/:id', exigirPermissao(EDITAR_REGRAS), rota('PUT /api/financeiro/etapas/:id', ({ api, req, usuarioId }) =>
    regras.salvarEtapa({ api, id: req.params.id, entrada: req.body, usuarioId })));
  router.delete('/etapas/:id', exigirPermissao(EDITAR_REGRAS), rota('DELETE /api/financeiro/etapas/:id', async ({ api, req, usuarioId }) =>
    ({ removido: await regras.removerEtapa({ api, id: req.params.id, usuarioId }) })));

  // A regra de produção de uma peça (cadastro de peças → "Regra Produção").
  router.get('/regra-producao', exigirAlgumaPermissao(LEEM_REGRA_DA_PECA), rota('GET /api/financeiro/regra-producao', ({ api, req }) =>
    regras.regraDaPeca(api, req.query?.produto_id || null)));
  router.put('/regra-producao/:produtoId', exigirAlgumaPermissao(GRAVAM_REGRA_DA_PECA), rota('PUT /api/financeiro/regra-producao/:produtoId', ({ api, req, usuarioId }) =>
    regras.salvarRegraDaPeca({ api, produtoId: req.params.produtoId, valores: req.body?.valores, usuarioId })));
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
      const linhas = c.lista(await api.get('/api/clientes', { query: { select: 'id,nome_fantasia,razao_social,dono_cliente' } }).catch(() => []));
      return linhas.map(x => ({ id: x.id, nome: c.nomeDoCliente(x) || `Cliente ${x.id}`, dono: String(x.dono_cliente || '').trim() || null }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    }
    if (alvo === 'donos') return { donos: await regras.donosDeClientes(api) };
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

  // ------------------------------------------------------------ atividade
  // O histórico do módulo inteiro (o card mostra só os últimos): quem fez,
  // quando, o quê. O nome e a foto de quem fez a tela busca na lista de
  // usuários — aqui vai só o `usuario_id`.
  router.get('/atividade', exigirPermissao(VER), rota('GET /api/financeiro/atividade', async ({ api, req }) => {
    const limite = Math.min(500, Math.max(10, Number(req.query?.limite) || 200));
    const eventos = await auditoria.recentes(api, { limite });
    const nomes = await detalhes.nomesDosUsuarios(api, eventos.map(e => e.usuario_id ?? e.criado_por));
    return {
      itens: eventos.map(e => ({
        id: e.id, quando: e.criado_em, tipo: e.tipo, rotulo: e.rotulo, descricao: e.descricao || '',
        valor: e.valor === null || e.valor === undefined ? null : c.centavos(e.valor),
        pedido_id: e.pedido_id ?? null, numero_parcela: e.numero_parcela ?? null,
        usuario_id: e.usuario_id ?? e.criado_por ?? null,
        usuario: nomes.get(String(e.usuario_id ?? e.criado_por)) || null
      }))
    };
  }));

  // ------------------------------------------------------------ parcelas
  router.get('/parcelas', exigirPermissao(VER), rota('GET /api/financeiro/parcelas', async ({ api, req, hoje, desde }) => {
    const visao = String(req.query?.visao || 'atrasadas');
    if (!['atrasadas', 'previstas', 'ajustaveis'].includes(visao)) throw c.erro('Visão desconhecida.', 400);
    const { b, apuradas } = await fechamentos.dadosComissao(api, { competencia: c.competenciaDe(hoje), hoje, desde });
    const v = comissoes.visoes(apuradas);
    // Com a competência, previstas e atrasadas DO MÊS (decisões do dono,
    // 24/09/2026: a atrasada passa para os meses seguintes até ser paga; o mês
    // passado mostra a foto do fim dele). Sem ela, a posição de hoje.
    const competencia = c.competenciaValida(req.query?.competencia) ? req.query.competencia : null;
    const mes = competencia ? comissoes.visaoDoMes(apuradas, { competencia, hoje, feriados: b.receber?.feriados || [] }) : null;
    let escolhidas;
    if (visao === 'atrasadas') escolhidas = mes ? mes.atrasadas : v.atrasadas;
    else if (visao === 'previstas') escolhidas = mes ? mes.previstas : v.previstas;
    else escolhidas = apuradas.filter(p => p.estado_parcela !== 'cancelada' && p.situacao !== 'nao_realizada')
      .sort((x, y) => String(y.pedido).localeCompare(String(x.pedido), 'pt-BR', { numeric: true }) || x.numero_parcela - y.numero_parcela);
    const nomes = await base.nomesDosClientes(api, escolhidas.map(p => p.cliente_id));
    const linhas = escolhidas.map(p => ({ ...linhaDaParcela(p), cliente: p.cliente || nomes.get(String(p.cliente_id)) || null }));
    return {
      visao, hoje, linhas, competencia, referencia: mes ? mes.referencia : hoje,
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
  // Fechamento da produção: o que cada pedido tem pendente e a confirmação peça a peça.
  router.get('/producao/pendencias', exigirPermissao(VER), rota('GET /api/financeiro/producao/pendencias', ({ api, req, hoje }) =>
    confirmacao.lerPendencias(api, { competencia: String(req.query?.competencia || ''), hoje })));
  router.post('/producao/confirmar', exigirPermissao(REGISTRAR_PRODUCAO), rota('POST /api/financeiro/producao/confirmar', ({ api, req, usuarioId, hoje }) =>
    confirmacao.confirmar({
      api, usuarioId, hoje,
      competencia: String(req.body?.competencia || ''),
      pedidoId: req.body?.pedido_id,
      decisoes: Array.isArray(req.body?.decisoes) ? req.body.decisoes : [],
      origem: 'fechamento'
    })));

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
