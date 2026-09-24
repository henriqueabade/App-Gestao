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
const rateios = require('./rateios');
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

/**
 * A situação da competência. Com o pagamento por beneficiário ela pode ficar
 * PARCIAL: parte dos beneficiários já recebeu e parte não.
 */
const situacaoDe = r => {
  const f = r.fechamento;
  if (!f) return r.fechado ? 'fechada' : 'aberta';
  const falta = f.falta_pagar === undefined || f.falta_pagar === null ? (f.pagamento ? 0 : 1) : Number(f.falta_pagar);
  if (falta <= 0) return 'paga';
  return Number(f.pago) > 0 ? 'parcial' : 'fechada';
};

/** O que já foi pago da competência (nada, se ela nem fechou). */
const pagoDe = r => c.centavos(r.fechamento?.pago ?? 0);

/**
 * O que ainda falta pagar. Sem fechamento é tudo; com fechamento é o que o
 * pagamento (ou os pagamentos por beneficiário) ainda não cobriu.
 */
const faltaDe = (r) => {
  const total = c.centavos(r.a_pagar);
  const f = r.fechamento;
  if (!f) return total;
  if (f.falta_pagar !== undefined && f.falta_pagar !== null) return c.centavos(f.falta_pagar);
  return f.pagamento ? 0 : total;
};

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
    lista.push({ nivel: 'normal', chave: 'sem_regras', titulo: 'Regras de CMS e Royalty não cadastradas', descricao: 'Cadastre em "Regras" a CMS de cada dono de cliente e o % do Royalty dos desenhistas: sem regra, a comissão fica zero.', data: hoje, acao: 'Cadastrar', destino: 'regras' });
  } else {
    const semRegra = apuradas.filter(p => p.sem_regra && p.pendentes.some(i => i.tipo_item === 'parcela'));
    if (semRegra.length) {
      lista.push({ nivel: 'normal', chave: 'parcelas_sem_regra', titulo: `${c.plural(semRegra.length, 'parcela recebida', 'parcelas recebidas')} sem regra de comissão`, descricao: `Pedido ${semRegra[0].pedido}${semRegra.length > 1 ? ' e outros' : ''}: cadastre a CMS do dono do cliente e o % do Royalty (para todos, o cliente ou o pedido).`, data: hoje, acao: 'Regras', destino: 'regras' });
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
  // Pago em parte (por beneficiário) continua pendente pelo que falta.
  for (const f of fechamentosLista.filter(x => (x.falta_pagar ?? x.total) > 0 && x.total > 0)) {
    const vencido = f.pagar_ate && hoje > f.pagar_ate;
    const falta = c.centavos(f.falta_pagar ?? f.total);
    lista.push({
      nivel: vencido ? 'critico' : 'normal', chave: `pagar_${f.tipo}_${f.competencia}`,
      titulo: `Pagamento ${f.tipo === 'comissao' ? 'das comissões' : 'da produção'} de ${c.rotuloCompetencia(f.competencia)}${vencido ? ' atrasado' : ''}`,
      descricao: `${c.reais(falta)}${falta !== c.centavos(f.total) ? ` de ${c.reais(f.total)}` : ''} até ${c.impressa(f.pagar_ate)} · confirme quando pagar`,
      data: f.pagar_ate, acao: 'Confirmar', destino: 'confirmar-pagamento', filtro: { tipo: f.tipo, competencia: f.competencia }
    });
  }

  const semValor = pend.filter(l => l.sem_valor);
  if (semValor.length) {
    lista.push({
      nivel: 'critico', chave: 'producao_sem_valor',
      titulo: `${c.plural(semValor.length, 'registro de produção', 'registros de produção')} sem valor`,
      descricao: `${semValor[0].produto} (${semValor[0].setor})${semValor.length > 1 ? ' e outros' : ''}: cadastre a regra do processo em "Regras" (ou o preço da peça na tabela fixa, se a regra é em %).`,
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

/**
 * A pendência do rateio: só existe com colaborador cadastrado e peça por
 * distribuir. Pura.
 */
function pendenciaDoRateio({ visao, competencia, hoje, fechado }) {
  if (!visao || visao.sql_pendente || fechado) return [];
  if (!visao.colaboradores.length || !visao.pendentes) return [];
  return [{
    nivel: 'alto',
    chave: 'rateio_incompleto',
    titulo: `${c.plural(visao.pendentes, 'processo sem rateio completo', 'processos sem rateio completo')}`,
    descricao: `A produção de ${c.rotuloCompetencia(competencia)} só fecha com 100% de cada processo distribuído entre os colaboradores. Abra "Rateio da produção" e complete o que falta.`,
    data: hoje, acao: 'Distribuir', destino: 'rateio-producao'
  }];
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
  // O rateio é da PRODUÇÃO e nunca derruba o painel: sem o SQL da fase,
  // `lerVisao` devolve `sql_pendente` e nada aparece.
  const visaoRateio = prodComp.fechado ? null : await rateios.lerVisao({ api, linhas: prodComp.linhas || [] }).catch(() => null);
  const cfg = b.regras.configuracao;
  const pagarComissao = resumo.fechamento?.pagar_ate || calendario.pagarComissaoAte(comp, cfg);
  const pagarProducao = prodComp.fechamento?.pagar_ate || calendario.pagarProducaoAte(comp, cfg, b.regras.feriados);
  const lista = [...fechamentos.listarDe(b, 'comissao'), ...fechamentos.listarDe(b, 'producao')];

  return {
    competencia: comp,
    configuracao: cfg,
    tem_regras: b.regras.regras.some(r => regras.ativo(r.ativo)),
    // `valor` é o que AINDA FALTA pagar; `total` é o da competência inteira.
    // O card mostra os dois ("R$ 0,00 / R$ 5.400,00" quando já se pagou tudo).
    comissoes: {
      situacao: situacaoDe(resumo), valor: faltaDe(resumo), total: c.centavos(resumo.a_pagar), pago: pagoDe(resumo),
      parcelas: resumo.parcelas, pagar_ate: pagarComissao,
      pago_em: resumo.fechamento?.pagamento ? c.dia(resumo.fechamento.pagamento.data_pagamento) : null
    },
    atrasadas: { valor: comissoes.soma(v.atrasadas, p => p.potencial.total), parcelas: v.atrasadas.length },
    producao: {
      situacao: situacaoDe(prodComp), valor: faltaDe(prodComp), total: c.centavos(prodComp.a_pagar), pago: pagoDe(prodComp),
      pecas: prodComp.pecas, pagar_ate: pagarProducao,
      dia_util: cfg.producao_dia_util,
      pago_em: prodComp.fechamento?.pagamento ? c.dia(prodComp.fechamento.pagamento.data_pagamento) : null
    },
    resumo_comissoes: {
      previstas: comissoes.soma(v.previstas, p => p.potencial.total),
      apuradas: resumo.comissao,
      atrasadas: comissoes.soma(v.atrasadas, p => p.potencial.total),
      ajustes: resumo.ajustes,
      // Ajustes à mão do mês: quantos, quanto saiu da base e quanta comissão
      // isso tirou (o card mostra para o número não mudar sozinho).
      ajustes_manuais: resumo.ajustes_manuais || { quantidade: 0, valor: 0, comissao: 0 },
      proximo_pagamento: pagarComissao,
      situacao: situacaoDe(resumo),
      // Quem recebe o quê (CMS e Royalty, por pessoa): a tela mostra com
      // etiqueta colorida e legenda, e o pagamento pode ser feito por pessoa.
      beneficiarios: resumo.beneficiarios || [],
      beneficiarios_previstos: [...comissoes.somarBeneficiarios(v.previstas.map(p => p.potencial.beneficiarios)).values()]
        .sort((a, b) => Number(b.valor) - Number(a.valor)),
      pago: resumo.fechamento?.pago ?? 0,
      falta_pagar: resumo.fechamento ? resumo.fechamento.falta_pagar : null
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
    // Rateio entre colaboradores: a distribuição por peça precisa fechar 100%
    // para a competência fechar. Aparece aqui como pendência enquanto falta.
    rateio: visaoRateio ? {
      colaboradores: visaoRateio.colaboradores.length, contagem: visaoRateio.contagem,
      pendentes: visaoRateio.pendentes, resumo: visaoRateio.resumo, total: visaoRateio.total
    } : null,
    pendencias: [
      ...pendencias({ hoje, regrasTudo: b.regras, apuradas, estadoC, estadoP: prod.estado, pend: prod.pend, fechamentosLista: lista }),
      ...pendenciaDoRateio({ visao: visaoRateio, competencia: comp, hoje, fechado: Boolean(prodComp.fechado) }),
      ...daDevolucao
    ],
    atividade: recentes.map(e => ({
      quando: instanteBR(e.criado_em), titulo: e.rotulo,
      detalhe: e.descricao
    })).filter(e => e.quando)
  };
}

module.exports = { instanteBR, pedidosParciais, pendencias, carregar };
