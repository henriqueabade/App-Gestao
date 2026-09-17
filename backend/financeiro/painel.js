/**
 * Painel de Comissões e Produção (fase G) para a tela do Financeiro:
 * os cartões (comissões a pagar, comissões atrasadas, produção a pagar),
 * os resumos, as pendências e a atividade recente do módulo.
 */
const c = require('./comum');
const calendario = require('./calendario');
const comissoes = require('./comissoes');
const producao = require('./producao');
const fechamentos = require('./fechamentos');
const auditoria = require('./auditoria');
const regras = require('./regras');
// Reembolso a pagar e devolução por terminar (backend/devolucoes): entram nas pendências do módulo.
const reembolsos = require('../devolucoes/reembolsos');

/** 'YYYY-MM-DDTHH:MM-03:00' de um instante (a atividade fiscal já vem assim). */
function instanteBR(instante) {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  const v = t => partes.find(p => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}-03:00`;
}

const situacaoDe = r => (r.fechamento?.pagamento ? 'paga' : (r.fechado ? 'fechada' : 'aberta'));

/** Pedidos com produção começada e algum item/setor ainda por terminar. Pura. */
function pedidosParciais({ eventos, itensPor }) {
  const acum = producao.acumulados(eventos);
  const porPedido = new Map();
  for (const [chave, feita] of acum) {
    const [itemId] = chave.split(':');
    const item = itensPor.get(itemId);
    if (!item) continue;
    const k = String(item.pedido_id);
    const atual = porPedido.get(k) || { comecou: false, falta: false };
    if (feita > 0) atual.comecou = true;
    if (feita < (Number(item.quantidade) || 0)) atual.falta = true;
    porPedido.set(k, atual);
  }
  return [...porPedido.values()].filter(p => p.comecou && p.falta).length;
}

/**
 * As pendências do módulo. Puras sobre o que já foi calculado.
 */
function pendencias({ hoje, regrasTudo, apuradas, estadoC, estadoP, pend, fechamentosLista }) {
  const lista = [];
  const atual = c.competenciaDe(hoje);
  const anterior = c.somarMeses(atual, -1);
  const ativas = regrasTudo.regras.filter(r => regras.ativo(r.ativo));

  if (!ativas.length) {
    lista.push({ nivel: 'normal', chave: 'sem_regras', titulo: 'Regras de CMS e Royalty não cadastradas', descricao: 'Cadastre quem recebe e o percentual em "Regras": sem regra, a comissão fica zero.', data: hoje, acao: 'Cadastrar', destino: 'regras' });
  } else {
    const semRegra = apuradas.filter(p => p.sem_regra && p.pendentes.some(i => i.tipo_item === 'parcela'));
    if (semRegra.length) {
      lista.push({ nivel: 'normal', chave: 'parcelas_sem_regra', titulo: `${c.plural(semRegra.length, 'parcela recebida', 'parcelas recebidas')} sem regra de comissão`, descricao: `Pedido ${semRegra[0].pedido}${semRegra.length > 1 ? ' e outros' : ''}: cadastre a regra do cliente ou do pedido (ou uma para todos).`, data: hoje, acao: 'Regras', destino: 'regras' });
    }
  }

  // Competências por fechar (a do mês passado, ou as atrasadas se o último fechamento ficou para trás).
  const porFechar = (tipo, estado, montar, pagarAte, rotulo, plural) => {
    const alvo = estado.proxima && estado.proxima < anterior ? estado.proxima : anterior;
    if (estado.fechados.has(alvo) || (estado.proxima && estado.proxima > alvo)) return;
    const r = montar(alvo);
    const temAlgo = tipo === 'comissao' ? r.itens.length > 0 : r.linhas.length > 0;
    if (!temAlgo && !estado.proxima) return;
    const prazo = pagarAte(alvo);
    lista.push({
      nivel: hoje >= (prazo || '9999') || alvo < anterior ? 'critico' : 'normal', chave: `fechar_${tipo}`,
      titulo: `${rotulo} de ${c.rotuloCompetencia(alvo)} ${alvo < anterior ? `ainda não fechada${plural ? 's' : ''}` : `pronta${plural ? 's' : ''} para fechamento`}`,
      descricao: `${tipo === 'comissao' ? 'Comissão apurada' : 'Produção apurada'}: ${c.reais(r.a_pagar)} · pagamento até ${c.impressa(prazo)}`,
      data: prazo, acao: 'Conferir', destino: 'fechar-competencia', filtro: { tipo, competencia: alvo }
    });
  };
  porFechar('comissao', estadoC, comp => comissoes.montarFechamento({ apuradas, estado: estadoC, competencia: comp }),
    comp => calendario.pagarComissaoAte(comp, regrasTudo.configuracao), 'Comissões', true);
  porFechar('producao', estadoP, comp => producao.montarCompetencia({ pend, estado: estadoP, competencia: comp }),
    comp => calendario.pagarProducaoAte(comp, regrasTudo.configuracao, regrasTudo.feriados), 'Produção', false);

  // Fechadas e não pagas.
  for (const f of fechamentosLista.filter(x => !x.pagamento && x.total > 0)) {
    const vencido = f.pagar_ate && hoje > f.pagar_ate;
    lista.push({
      nivel: vencido ? 'critico' : 'normal', chave: `pagar_${f.tipo}_${f.competencia}`,
      titulo: `Pagamento ${f.tipo === 'comissao' ? 'das comissões' : 'da produção'} de ${c.rotuloCompetencia(f.competencia)}${vencido ? ' atrasado' : ''}`,
      descricao: `${c.reais(f.total)} até ${c.impressa(f.pagar_ate)} · confirme quando pagar`,
      data: f.pagar_ate, acao: 'Confirmar', destino: 'confirmar-pagamento', filtro: { tipo: f.tipo, competencia: f.competencia }
    });
  }

  const semValor = pend.filter(l => l.sem_valor);
  if (semValor.length) {
    lista.push({
      nivel: 'critico', chave: 'producao_sem_valor',
      titulo: `${c.plural(semValor.length, 'registro de produção', 'registros de produção')} sem valor por peça`,
      descricao: `${semValor[0].produto} (${semValor[0].setor})${semValor.length > 1 ? ' e outros' : ''}: cadastre o valor em "Regras".`,
      data: semValor[0].data, acao: 'Regras', destino: 'regras'
    });
  }

  const antigas = apuradas.filter(p => p.controlada && p.situacao === 'atrasada' && p.dias_atraso > 30);
  const potencial = comissoes.soma(antigas, p => p.potencial.total);
  if (antigas.length && potencial > 0) {
    lista.push({
      nivel: 'normal', chave: 'atrasadas_30',
      titulo: `${c.plural(antigas.length, 'parcela vencida', 'parcelas vencidas')} há mais de 30 dias`,
      descricao: `Comissão potencial: ${c.reais(potencial)}`,
      data: antigas.map(p => p.vencimento).filter(Boolean).sort()[0] || hoje, acao: 'Ver', destino: 'comissoes-atrasadas'
    });
  }
  return lista;
}

async function carregar({ api, competencia, hoje, desde }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const [dc, prod, recentes, daDevolucao] = await Promise.all([
    fechamentos.dadosComissao(api, { competencia: comp, hoje, desde }),
    producao.lerBase(api),
    auditoria.recentes(api, { limite: 8 }).catch(() => []),
    reembolsos.pendenciasDoPainel({ api, hoje }).catch(() => [])
  ]);
  const { b, estado: estadoC, apuradas, resumo } = dc;
  const v = comissoes.visoes(apuradas);
  const prodComp = producao.montarCompetencia({ pend: prod.pend, estado: prod.estado, competencia: comp });
  const cfg = b.regras.configuracao;
  const pagarComissao = resumo.fechamento?.pagar_ate || calendario.pagarComissaoAte(comp, cfg);
  const pagarProducao = prodComp.fechamento?.pagar_ate || calendario.pagarProducaoAte(comp, cfg, b.regras.feriados);
  const lista = [...fechamentos.listarDe(b, 'comissao'), ...fechamentos.listarDe(b, 'producao')];

  return {
    competencia: comp,
    configuracao: cfg,
    tem_regras: b.regras.regras.some(r => regras.ativo(r.ativo)),
    comissoes: {
      situacao: situacaoDe(resumo), valor: resumo.a_pagar, parcelas: resumo.parcelas, pagar_ate: pagarComissao,
      pago_em: resumo.fechamento?.pagamento ? c.dia(resumo.fechamento.pagamento.data_pagamento) : null
    },
    atrasadas: { valor: comissoes.soma(v.atrasadas, p => p.potencial.total), parcelas: v.atrasadas.length },
    producao: {
      situacao: situacaoDe(prodComp), valor: prodComp.a_pagar, pecas: prodComp.pecas, pagar_ate: pagarProducao,
      dia_util: cfg.producao_dia_util,
      pago_em: prodComp.fechamento?.pagamento ? c.dia(prodComp.fechamento.pagamento.data_pagamento) : null
    },
    resumo_comissoes: {
      previstas: comissoes.soma(v.previstas, p => p.potencial.total),
      apuradas: resumo.comissao,
      atrasadas: comissoes.soma(v.atrasadas, p => p.potencial.total),
      ajustes: resumo.ajustes,
      proximo_pagamento: pagarComissao,
      situacao: situacaoDe(resumo)
    },
    resumo_producao: {
      em_producao: b.receber.pedidos.filter(p => producao.podeProduzir(p) && String(p.situacao || '').toLowerCase().startsWith('produ')).length,
      parciais: pedidosParciais({ eventos: prod.eventos, itensPor: prod.itensPor }),
      pecas_mes: prodComp.pecas,
      valor: prodComp.a_pagar,
      proximo_pagamento: pagarProducao,
      dia_util: cfg.producao_dia_util,
      situacao: situacaoDe(prodComp)
    },
    pendencias: [
      ...pendencias({ hoje, regrasTudo: b.regras, apuradas, estadoC, estadoP: prod.estado, pend: prod.pend, fechamentosLista: lista }),
      ...daDevolucao
    ],
    atividade: recentes.map(e => ({
      quando: instanteBR(e.criado_em), titulo: e.rotulo,
      detalhe: e.descricao
    })).filter(e => e.quando)
  };
}

module.exports = { instanteBR, pedidosParciais, pendencias, carregar };
