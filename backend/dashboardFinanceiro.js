/**
 * Os números do Financeiro no Dashboard (decisão do dono, 24/09/2026) — só a
 * regra, sem rede e sem relógio próprio, como dashboardResumo.js.
 *
 * Três seções, cada uma atrás da permissão do Financeiro de onde o número vem
 * (ver SECOES em dashboardController.js):
 *   - receber (Ver recebimentos): recebido no mês, a receber, em atraso,
 *     contas a receber por vencimento, ordens de pagamento, conciliação com o
 *     BB, o recebido antes da nota (pedidos em produção), a série "Recebido"
 *     do gráfico e o estado de cada parcela para o balão da previsão;
 *   - fiscal (Ver notas fiscais): as NF-e do mês, pedidos enviados sem nota e
 *     as notas com problema (recusadas, paradas na SEFAZ, certificado);
 *   - pagar (Ver comissões e produção): o que falta pagar de comissões e de
 *     produção na competência e as competências fechadas esperando o
 *     pagamento.
 *
 * NENHUMA conta nova: as regras são as do próprio Financeiro
 * (cobranca/contasReceber.js, fiscal/painel.js, financeiro/painel.js), para o
 * painel dizer exatamente o que o módulo diz. Aqui se recorta e se dá a forma
 * do contrato do painel: todo dinheiro sai num campo `valor` (a convenção do
 * painel: `null` = sem permissão, e a tela mostra só a contagem), e cada lista
 * sai cortada com o total junto — nada some calado.
 */

const contasReceber = require('./cobranca/contasReceber');
const { STATUS_A_PAGAR } = require('./cobranca/boletos');
const fiscalPainel = require('./fiscal/painel');
const { paraDecimal } = require('./numeros');
const { contextoDeTempo, deslocarMes, somarDias, diferencaEmDias, situacaoDoPedido } = require('./dashboardResumo');

/** Quantos itens cada lista leva. O total real vai sempre junto. */
const LIMITE_LISTA = {
  atrasos: 6,
  ordens: 6,
  aguardandoNfe: 6,
  aConfirmar: 6
};

/**
 * Faixas das contas a receber por vencimento, da mais grave para a mais
 * tranquila. Os rótulos são da tela (DASH_FAIXAS_VENCIMENTO); os limites do
 * atraso seguem o Financeiro: até 15 dias o BB ainda recebe o boleto
 * (contasReceber.DIAS_ATRASO_CRITICO).
 */
const FAIXAS_VENCIMENTO = ['atraso_30', 'atraso_16_30', 'atraso_1_15', 'vence_7', 'vence_30', 'depois'];

const lista = v => (Array.isArray(v) ? v : []);
const centavos = v => Math.round((Number(v) || 0) * 100) / 100;
const dinheiro = v => paraDecimal(v) ?? 0;
const texto = v => (v === null || v === undefined ? null : (String(v).trim() || null));
const somar = (linhas, campo) => centavos(linhas.reduce((s, l) => s + (Number(l?.[campo]) || 0), 0));

/** 'YYYY-MM-DD' de uma coluna DATE/instante já cortada pelo Financeiro (ou null). */
function dia(valor) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor ?? '').trim());
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// receber
// ---------------------------------------------------------------------------

/** A faixa de vencimento de uma parcela em aberto (ver FAIXAS_VENCIMENTO). */
function faixaDaParcela(linha, hoje) {
  const atraso = Number(linha?.dias_atraso) || 0;
  if (atraso > 30) return 'atraso_30';
  if (atraso > contasReceber.DIAS_ATRASO_CRITICO) return 'atraso_16_30';
  if (atraso > 0) return 'atraso_1_15';
  if (!linha?.vencimento) return null;
  // Venceu no fim de semana e ainda está no prazo sem encargos: em dia.
  const faltam = diferencaEmDias(linha.vencimento, hoje);
  if (faltam <= 7) return 'vence_7';
  if (faltam <= 30) return 'vence_30';
  return 'depois';
}

/** O que o Financeiro lê de apoio, das linhas cruas (sem rede). */
function apoioDoReceber({ configuracao_cobranca: cfg, financeiro_feriados: feriados, boletos_eventos: eventos, ordens_pagamento: ordens }, hoje) {
  const config = lista(cfg).find(l => Number(l?.id) === 1) || lista(cfg)[0] || null;
  const doWebhook = lista(eventos).filter(e => e && e.origem === 'webhook');
  return {
    desde: dia(config?.recebimentos_desde),
    feriados: lista(feriados).filter(f => f && f.data).map(f => ({ data: dia(f.data), descricao: f.descricao || 'Feriado' })).filter(f => f.data),
    ordens: lista(ordens).filter(o => o && o.status === 'aberta'),
    fila: doWebhook.filter(e => !e.processado_em).length,
    // O mesmo recorte de contasReceber.lerBase: aviso conciliado com alerta, dos últimos 30 dias.
    alertas: doWebhook
      .filter(e => e.processado_em && e.boleto_id && e.erro_processamento && (contasReceber.diasEntre(hoje, e.criado_em || e.processado_em) ?? 0) <= 30)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map(e => ({ boleto_id: e.boleto_id, mensagem: e.erro_processamento, quando: dia(e.criado_em || e.processado_em) }))
  };
}

/**
 * Contas a receber no mês de hoje, com as regras do Financeiro (a parcela de
 * pedido faturado, o atraso pelo dia útil, o corte "controlar a partir de").
 */
function resumirReceber(tabelas = {}, { agora = new Date() } = {}) {
  const { hoje, mesAtual } = contextoDeTempo(agora);
  const apoio = apoioDoReceber(tabelas, hoje);
  const pedidos = lista(tabelas.pedidos);
  const recebimentos = lista(tabelas.recebimentos);
  const notas = lista(tabelas.notas_fiscais).map(n => ({
    id: n?.id, pedido_id: n?.pedido_id, serie: n?.serie, numero: n?.numero, status_fiscal: n?.status_fiscal,
    data_emissao: n?.data_emissao ?? null, valor_total: n?.valor_total ?? null
  }));
  const clientes = lista(tabelas.clientes);
  const linhas = contasReceber.parcelasDosPedidos({
    pedidos, parcelas: lista(tabelas.pedido_parcelas), recebimentos, boletos: lista(tabelas.boletos), notas, clientes,
    hoje, desde: apoio.desde, feriados: apoio.feriados, ordens: apoio.ordens
  });
  const recebidos = contasReceber.recebidosDaCompetencia({ recebimentos, pedidos, notas, clientes, competencia: mesAtual });
  const resumo = contasReceber.resumir({ linhas, recebidos, competencia: mesAtual, desde: apoio.desde, fila: apoio.fila, alertas: apoio.alertas, hoje });
  const visoes = contasReceber.visoes({ linhas, recebidos, competencia: mesAtual });

  // Recebido no mesmo trecho do mês passado (dias 1..D): o mês corrente pela
  // metade contra o anterior inteiro pareceria sempre uma queda.
  const mesAnterior = deslocarMes(mesAtual, -1);
  const [a, m] = mesAnterior.split('-').map(Number);
  const diaLimite = Math.min(Number(hoje.slice(8, 10)), new Date(Date.UTC(a, m, 0)).getUTCDate());
  const confirmados = lista(recebimentos).filter(r => r && r.status === 'confirmado');
  const doTrechoAnterior = confirmados.filter(r => String(r.competencia || '').trim() === mesAnterior
    && Number(String(dia(r.data_recebimento) || '').slice(8, 10)) <= diaLimite);

  // A receber no mês: como cada parcela é cobrada.
  const aReceber = visoes.a_receber;
  const comBoleto = aReceber.filter(l => l.boleto && STATUS_A_PAGAR.has(String(l.boleto.status))).length;
  const comOrdem = aReceber.filter(l => l.ordem && !(l.boleto && STATUS_A_PAGAR.has(String(l.boleto.status)))).length;

  // Por vencimento: tudo o que está em aberto e é controlado aqui.
  const abertas = linhas.filter(l => l.estado === 'a_receber' && l.controlada);
  const porFaixa = new Map(FAIXAS_VENCIMENTO.map(f => [f, { quantidade: 0, valor: 0 }]));
  let semData = 0;
  for (const l of abertas) {
    const faixa = faixaDaParcela(l, hoje);
    if (!faixa) { semData += 1; continue; }
    const acc = porFaixa.get(faixa);
    acc.quantidade += 1;
    // Vencida com boleto: o que o boleto cobra hoje (cheio + multa + juros).
    acc.valor += Number(l.a_receber_hoje ?? l.a_receber) || 0;
  }
  const emAtraso = visoes.em_atraso;
  const devidoHoje = l => Number(l.a_receber_hoje ?? l.a_receber) || 0;
  const itemDaParcela = l => ({
    pedidoId: l.pedido_id ?? null, pedido: texto(l.pedido), cliente: texto(l.cliente), parcela: texto(l.parcela),
    vencimento: l.vencimento || null, dias: Number(l.dias_atraso) || 0, valor: centavos(devidoHoje(l))
  });
  // As maiores em atraso: o valor manda; empate, a mais atrasada.
  const maiores = [...emAtraso]
    .sort((x, y) => devidoHoje(y) - devidoHoje(x) || (y.dias_atraso - x.dias_atraso))
    .slice(0, LIMITE_LISTA.atrasos)
    .map(itemDaParcela);

  // Ordens de pagamento: as combinadas para os próximos 7 dias e as que
  // passaram da data sem baixa (a ordem é o vencimento da parcela).
  const fimDaSemana = somarDias(hoje, 7);
  const comOrdemAberta = linhas.filter(l => l.estado === 'a_receber' && l.ordem);
  const ordensAtrasadas = comOrdemAberta.filter(l => (Number(l.dias_atraso) || 0) > 0);
  const ordensProximas = comOrdemAberta.filter(l => !(Number(l.dias_atraso) > 0) && l.ordem.data && l.ordem.data <= fimDaSemana);
  const ordensDaLista = [...ordensAtrasadas.sort((x, y) => y.dias_atraso - x.dias_atraso), ...ordensProximas.sort((x, y) => String(x.ordem.data).localeCompare(String(y.ordem.data)))];

  // Conciliação: os textos são os das pendências do próprio Financeiro.
  const boletosComErro = abertas.filter(l => l.boleto?.status === 'erro').length;
  const pendenciasDeConciliacao = resumo.pendencias
    .filter(p => ['conciliar', 'alertas', 'boletos_erro'].includes(p.chave))
    .map(p => ({ chave: p.chave, nivel: p.nivel, titulo: p.titulo, descricao: p.descricao }));

  // Recebido antes da nota: pagamento lançado em pedido que ainda está em produção.
  const emProducao = new Set(pedidos.filter(p => situacaoDoPedido(p?.situacao) === 'Produção').map(p => String(p.id)));
  const antecipados = confirmados.filter(r => emProducao.has(String(r.pedido_id)));

  // A série "Recebido" do gráfico: os mesmos 12 meses das vendas, pela competência do recebimento.
  const meses = Array.from({ length: 12 }, (_, i) => deslocarMes(mesAtual, i - 11));
  const porMes = new Map(meses.map(mes => [mes, { quantidade: 0, valor: 0 }]));
  for (const r of confirmados) {
    const acc = porMes.get(String(r.competencia || '').trim());
    if (!acc) continue;
    acc.quantidade += 1;
    acc.valor += dinheiro(r.valor_recebido);
  }

  // O estado de cada parcela para o balão da previsão ("paga" / "em atraso"),
  // só na janela do gráfico: 12 meses para trás e 12 para a frente.
  const inicio = meses[0];
  const fim = deslocarMes(mesAtual, 12);
  const parcelas = {};
  for (const l of linhas) {
    const mes = String(l.vencimento || '').slice(0, 7);
    if (!mes || mes < inicio || mes > fim) continue;
    if (l.estado === 'recebida') parcelas[`${l.pedido_id}:${l.numero_parcela}`] = 'paga';
    else if (l.estado === 'a_receber' && Number(l.dias_atraso) > 0) parcelas[`${l.pedido_id}:${l.numero_parcela}`] = 'atrasada';
  }

  return {
    recebido: {
      quantidade: resumo.recebido.quantidade,
      valor: resumo.recebido.total,
      encargos: { valor: resumo.recebido.encargos },
      estornados: resumo.recebido.estornados,
      mesAnteriorMesmoPeriodo: { quantidade: doTrechoAnterior.length, valor: somar(doTrechoAnterior, 'valor_recebido') }
    },
    aReceber: {
      quantidade: resumo.a_receber.quantidade,
      valor: resumo.a_receber.total,
      comBoleto,
      comOrdem,
      semCobranca: Math.max(0, aReceber.length - comBoleto - comOrdem)
    },
    emAtraso: {
      quantidade: resumo.em_atraso.quantidade,
      valor: resumo.em_atraso.total,
      maisAntigo: resumo.em_atraso.mais_antigo,
      diasMax: resumo.em_atraso.dias_max,
      criticos: emAtraso.filter(l => l.dias_atraso > contasReceber.DIAS_ATRASO_CRITICO).length,
      limiteCritico: contasReceber.DIAS_ATRASO_CRITICO
    },
    porVencimento: {
      faixas: FAIXAS_VENCIMENTO.map(faixa => ({ faixa, quantidade: porFaixa.get(faixa).quantidade, valor: centavos(porFaixa.get(faixa).valor) })),
      quantidade: abertas.length,
      valor: somar(abertas, 'a_receber'),
      semData,
      maioresAtrasos: { total: emAtraso.length, itens: maiores }
    },
    ordens: {
      abertas: comOrdemAberta.length,
      atrasadas: ordensAtrasadas.length,
      proximas7: ordensProximas.length,
      itens: ordensDaLista.slice(0, LIMITE_LISTA.ordens).map(l => ({
        ...itemDaParcela(l), forma: texto(l.ordem.forma), data: l.ordem.data || null, atrasada: Number(l.dias_atraso) > 0
      }))
    },
    conciliacao: {
      fila: apoio.fila,
      aLancar: resumo.a_conciliar.lancamentos,
      alertas: apoio.alertas.length,
      boletosComErro,
      itens: pendenciasDeConciliacao
    },
    antecipadoEmProducao: {
      pedidos: new Set(antecipados.map(r => String(r.pedido_id))).size,
      valor: somar(antecipados, 'valor_recebido')
    },
    serie12m: meses.map(mes => ({ mes, quantidade: porMes.get(mes).quantidade, valor: centavos(porMes.get(mes).valor) })),
    parcelas,
    desde: apoio.desde
  };
}

// ---------------------------------------------------------------------------
// fiscal
// ---------------------------------------------------------------------------

/** A nota sem os XMLs: nenhuma conta daqui precisa deles. */
function notaLeve(n) {
  if (!n || typeof n !== 'object') return null;
  const { xml_envio, xml_autorizado, xml_cancelamento, ...resto } = n;
  return resto;
}

/**
 * As NF-e com as regras do painel fiscal do Financeiro. "Sem NF-e" olha os
 * pedidos enviados desde o 1º dia do MÊS PASSADO: o Financeiro olha só a
 * competência escolhida (antes do sistema fiscal as notas saíam por fora), e
 * no painel, no começo do mês, isso esconderia o pedido do fim do mês
 * anterior que continua sem nota. O certificado e a configuração vêm do
 * `complemento` (lidos à parte pelo controller); sem ele, nada se afirma
 * sobre o certificado.
 */
function resumirFiscal(tabelas = {}, { agora = new Date(), complemento = null } = {}) {
  const { hoje, mesAtual } = contextoDeTempo(agora);
  const desde = `${deslocarMes(mesAtual, -1)}-01`;
  const notas = lista(tabelas.notas_fiscais).map(notaLeve).filter(Boolean);
  const aguardando = fiscalPainel.pedidosAguardandoNfe({
    pedidos: lista(tabelas.pedidos), notas, clientes: lista(tabelas.clientes), desde, hoje,
    externas: lista(tabelas.notas_fiscais_externas)
  });
  const doMes = fiscalPainel.resumoDasNotas(notas, mesAtual);
  // As NF-e emitidas fora e informadas nos pedidos contam como autorizadas do
  // mês (a lista de Notas fiscais do Financeiro também as mostra desde
  // 24/09/2026). Sem o dia (informada pela chave), vale o mês da chave.
  const deForaDoMes = lista(tabelas.notas_fiscais_externas)
    .filter(n => n && n.ativo !== false && n.ativo !== 'false')
    .filter(n => String(dia(n.data_emissao) || n.mes_emissao || '').startsWith(mesAtual));
  const valorDeFora = somar(deForaDoMes, 'valor_total');
  const certificado = complemento?.certificado || null;
  const problemas = fiscalPainel.pendenciasFiscais({
    aguardando, notas,
    // Sem o complemento (não deu para ler agora) o certificado não é assunto:
    // dizer "não configurado" seria mentira.
    certificado: certificado || { configurado: true },
    pendenciasConfiguracao: lista(complemento?.pendenciasConfiguracao),
    hoje
  }).filter(p => p.chave !== 'aguardando_nf');
  const contadas = aguardando.pedidos.filter(l => !l.dispensada);

  return {
    notasMes: {
      emitidas: doMes.emitidas + deForaDoMes.length,
      autorizadas: { quantidade: doMes.autorizadas + deForaDoMes.length, valor: centavos(doMes.valor_autorizado + valorDeFora) },
      canceladas: doMes.canceladas,
      processando: doMes.processando,
      rejeitadas: doMes.rejeitadas,
      deFora: deForaDoMes.length
    },
    aguardandoNfe: {
      desde,
      quantidade: aguardando.quantidade,
      valor: aguardando.total,
      dispensados: aguardando.dispensados,
      itens: contadas.slice(0, LIMITE_LISTA.aguardandoNfe).map(l => ({
        pedidoId: l.pedido_id ?? null, numero: texto(l.numero), cliente: texto(l.cliente),
        enviadoEm: l.enviado_em || null, dias: Number(l.dias_sem_nfe) || 0, valor: centavos(l.valor)
      }))
    },
    problemas: {
      quantidade: problemas.length,
      criticos: problemas.filter(p => p.nivel === 'critico').length,
      itens: problemas.map(p => ({ chave: p.chave, nivel: p.nivel, titulo: p.titulo, descricao: p.descricao || '' }))
    },
    certificado: certificado && certificado.configurado ? {
      vencido: Boolean(certificado.vencido),
      venceEmBreve: Boolean(certificado.venceEmBreve),
      diasRestantes: Number.isFinite(Number(certificado.diasRestantes)) ? Number(certificado.diasRestantes) : null,
      validoAte: dia(certificado.validoAte)
    } : null
  };
}

// ---------------------------------------------------------------------------
// pagar
// ---------------------------------------------------------------------------

/**
 * Comissões e produção a pagar, a partir do painel do Financeiro do mês
 * (financeiro/painel.js, carregado pelo controller). `valor` é o que AINDA
 * falta pagar; o total da competência vai em `total.valor`.
 */
function resumirPagar(painel = {}, { agora = new Date() } = {}) {
  const { hoje } = contextoDeTempo(agora);
  const bloco = b => ({
    valor: centavos(b?.valor),
    total: { valor: centavos(b?.total) },
    pago: { valor: centavos(b?.pago) },
    situacao: b?.situacao || 'aberta',
    pagarAte: dia(b?.pagar_ate)
  });
  const comissoes = { ...bloco(painel.comissoes), parcelas: Number(painel.comissoes?.parcelas) || 0 };
  const producao = { ...bloco(painel.producao), pecas: Number(painel.producao?.pecas) || 0 };
  const aConfirmar = lista(painel.a_confirmar)
    .map(f => ({
      tipo: f.tipo === 'producao' ? 'producao' : 'comissao',
      competencia: String(f.competencia || ''),
      valor: centavos(f.falta_pagar ?? f.total),
      total: { valor: centavos(f.total) },
      pagarAte: dia(f.pagar_ate),
      atrasado: Boolean(dia(f.pagar_ate) && hoje > dia(f.pagar_ate))
    }))
    .filter(f => f.valor > 0)
    .sort((a, b) => Number(b.atrasado) - Number(a.atrasado) || String(a.pagarAte || '9999').localeCompare(String(b.pagarAte || '9999')));
  // O que o cliente já pagou e não foi repassado no prazo (financeiro/repasses.js):
  // comissões e produção de competências anteriores. Também é "a pagar".
  const repasseComissao = centavos(painel.atrasadas?.repasse?.valor);
  const repasseProducao = centavos(painel.producao?.atrasada?.valor);
  const competenciasEmAtraso = [...new Set([
    ...lista(painel.atrasadas?.repasse?.competencias), ...lista(painel.producao?.atrasada?.competencias)
  ])].sort();
  return {
    competencia: painel.competencia || null,
    aPagar: { valor: centavos(comissoes.valor + producao.valor + repasseComissao + repasseProducao) },
    comissoes,
    producao,
    // As atrasadas porque o CLIENTE não pagou (o painel manda a soma dos dois atrasos em `valor`).
    atrasadas: {
      quantidade: Number(painel.atrasadas?.cliente?.parcelas ?? painel.atrasadas?.parcelas) || 0,
      valor: centavos(painel.atrasadas?.cliente ? painel.atrasadas.cliente.valor : painel.atrasadas?.valor)
    },
    repasse: { valor: centavos(repasseComissao + repasseProducao), competencias: competenciasEmAtraso },
    aConfirmar: {
      quantidade: aConfirmar.length,
      atrasados: aConfirmar.filter(f => f.atrasado).length,
      valor: centavos(aConfirmar.reduce((s, f) => s + f.valor, 0)),
      itens: aConfirmar.slice(0, LIMITE_LISTA.aConfirmar)
    }
  };
}

module.exports = {
  LIMITE_LISTA, FAIXAS_VENCIMENTO,
  faixaDaParcela, resumirReceber, resumirFiscal, resumirPagar
};
