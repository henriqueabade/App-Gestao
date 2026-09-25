/**
 * Contas a receber do módulo Financeiro — fase E.
 *
 * Cada parcela de pedido faturado (Enviado/Entregue, ou com NF-e ou boleto)
 * fica num destes estados:
 *   - recebida   tem recebimento confirmado (ou boleto pago / quitado por fora
 *                ainda sem lançamento: a conciliação lança);
 *   - cancelada  o boleto foi baixado como cobrança cancelada;
 *   - a_receber  o resto; em atraso quando passou do último dia para pagar
 *                sem encargos — o vencimento (o do boleto que vale, se
 *                prorrogado) ou, se ele cai em fim de semana ou feriado, o
 *                próximo dia útil. O atraso conta desde o vencimento do papel
 *                (`vencimento.js`).
 * Parcela de pedido em produção é só previsão e não entra — a menos que já
 * tenha pagamento registrado (Pix, cartão… antes da nota). Parcela que
 * venceu antes de `recebimentos_desde` fica fora de "a receber" e "em
 * atraso" (era controlada por fora), mas ainda pode ser recebida à mão.
 *
 * As contas são puras sobre listas já lidas; só `carregar` fala com a API.
 */
const boletos = require('./boletos');
const recebimentos = require('./recebimentos');
const execucoes = require('./execucoes');
const webhookEstado = require('./webhookEstado');
const vencimentos = require('./vencimento');
const descontoCondicional = require('./descontoCondicional');

const SITUACOES_FATURADAS = new Set(['enviado', 'entregue']);
/** Dias depois do vencimento em que o BB ainda recebe o boleto (configuração padrão). */
const DIAS_ATRASO_CRITICO = 15;

const lista = r => (Array.isArray(r) ? r : (r && typeof r === 'object' && !r.error ? [r] : []));
const centavos = v => Math.round(Number(v || 0) * 100) / 100;
const dia = recebimentos.dia;
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const impressa = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

function diasEntre(a, b) {
  const pa = dia(a);
  const pb = dia(b);
  if (!pa || !pb) return null;
  const [ya, ma, da] = pa.split('-').map(Number);
  const [yb, mb, db] = pb.split('-').map(Number);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86400000);
}

/** 'YYYY-MM' válido, senão o mês de `hoje`. */
function competenciaValida(texto, hoje) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(texto || ''));
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}`;
  return String(dia(hoje) || '').slice(0, 7);
}

const nomeDoCliente = c => (c ? (c.nome_fantasia || c.razao_social || c.nome || null) : null);
const agrupar = (linhas, campo) => {
  const mapa = new Map();
  for (const l of lista(linhas)) {
    if (!l || l[campo] === null || l[campo] === undefined) continue;
    const chave = String(l[campo]);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(l);
  }
  return mapa;
};

/** Todas as parcelas dos pedidos faturados, cada uma com o seu estado. Pura. */
function parcelasDosPedidos({ pedidos = [], parcelas = [], recebimentos: recs = [], boletos: bols = [], notas = [], clientes = [], hoje, desde = null, feriados = [], ordens = [] }) {
  // Ordens de pagamento abertas (ordens.js): valem como o vencimento da parcela.
  const ordensPor = agrupar(lista(ordens).filter(o => o && o.status === 'aberta'), 'pedido_id');
  const parcelasPor = agrupar(parcelas, 'pedido_id');
  const boletosPor = agrupar(bols, 'pedido_id');
  const notasPor = agrupar(notas, 'pedido_id');
  const recebPor = agrupar(lista(recs).filter(r => r && r.status === 'confirmado'), 'pedido_id');
  const nomes = new Map(lista(clientes).filter(Boolean).map(c => [String(c.id), nomeDoCliente(c)]));
  const hojeDia = dia(hoje);
  const corte = dia(desde);
  const linhas = [];

  for (const p of lista(pedidos)) {
    if (!p) continue;
    const situacao = String(p.situacao || '').trim().toLowerCase();
    if (situacao === 'cancelado') continue;
    const chave = String(p.id);
    const doPedido = (parcelasPor.get(chave) || []).slice().sort((a, b) => Number(a.numero_parcela) - Number(b.numero_parcela));
    if (!doPedido.length) continue;
    const bolsDoPedido = (boletosPor.get(chave) || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
    const notasDoPedido = (notasPor.get(chave) || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
    const nota = notasDoPedido.find(n => n.status_fiscal === 'autorizada') || null;
    // Quem tentou gerar boleto (até o recusado) já está cobrando o pedido.
    const temBoleto = bolsDoPedido.some(b => String(b.status) !== 'reservado');
    const recsDoPedido = recebPor.get(chave) || [];
    // Pagamento registrado (Pix, cartão… no pedido ainda em produção) também
    // fatura: o dinheiro entrou e a comissão tem de contar (decisão do dono, 24/09/2026).
    const ordensDoPedido = ordensPor.get(chave) || [];
    // Ordem de pagamento aberta também: a cobrança já foi combinada, como um boleto.
    const faturado = SITUACOES_FATURADAS.has(situacao) || Boolean(nota) || temBoleto || recsDoPedido.length > 0 || ordensDoPedido.length > 0;
    if (!faturado) continue;

    for (const parcela of doPedido) {
      const numero = Number(parcela.numero_parcela);
      const boleto = boletos.boletoDaParcela(bolsDoPedido, parcela)
        || bolsDoPedido.find(b => Number(b.parcela_id) === Number(parcela.id) || Number(b.numero_parcela) === numero)
        || null;
      const recebimento = recsDoPedido.find(r => Number(r.numero_parcela) === numero) || null;
      const aPagar = boleto && boletos.STATUS_A_PAGAR.has(String(boleto.status));
      const ordem = ordensDoPedido.find(o => Number(o.parcela_id) === Number(parcela.id) || Number(o.numero_parcela) === numero) || null;
      // O boleto a pagar manda no vencimento; sem ele, a ordem de pagamento aberta.
      const vencimento = (aPagar && dia(boleto.data_vencimento)) || (ordem && dia(ordem.data_prevista)) || dia(parcela.data_vencimento);
      const valor = centavos(parcela.valor);
      const abatimento = aPagar ? centavos(boleto.valor_abatimento || 0) : 0;

      let estado = 'a_receber';
      if (recebimento) estado = 'recebida';
      else if (boleto && boleto.status === 'pago') estado = 'recebida';
      else if (boleto && boleto.status === 'baixado' && boleto.motivo_baixa === 'quitado_por_fora') estado = 'recebida';
      else if (boleto && boleto.status === 'baixado' && boleto.motivo_baixa === 'cancelado') estado = 'cancelada';
      // Parcela zerada por devolução do pedido (sem boleto para baixar): nada a receber.
      else if (!(valor > 0)) estado = 'cancelada';

      // Vencimento em fim de semana ou feriado: em dia até o próximo dia útil.
      const atraso = estado === 'a_receber' && vencimento && hojeDia ? vencimentos.diasDeAtraso(vencimento, hojeDia, feriados) : 0;
      // O que o boleto cobra HOJE (decisões do dono, 25/09/2026): em dia, o
      // valor com desconto; vencido, o cheio (sem o desconto) mais a multa e
      // os juros sobre ele. `a_receber` continua sendo o valor em dia — é a
      // base da comissão, da devolução e da sugestão de encargos.
      const devido = estado === 'a_receber' && aPagar && atraso > 0
        ? descontoCondicional.devidoHoje({ boleto, vencimento, hoje: hojeDia, feriados })
        : null;
      const desconto = aPagar ? centavos(boleto.valor_desconto || 0) : 0;
      linhas.push({
        pedido_id: p.id,
        pedido: p.numero ?? String(p.id),
        cliente_id: p.cliente_id ?? null,
        cliente: nomes.get(String(p.cliente_id)) || null,
        nf: nota ? `${nota.serie}/${nota.numero}` : null,
        parcela_id: parcela.id ?? null,
        numero_parcela: numero,
        parcela: `${numero}/${doPedido.length}`,
        vencimento,
        valor,
        abatimento,
        a_receber: centavos(valor - abatimento),
        // O desconto até o vencimento do boleto (0 sem ele) e o valor do boleto.
        desconto_condicional: desconto,
        valor_boleto: aPagar ? centavos(boleto.valor) : null,
        a_receber_hoje: devido ? devido.total : centavos(valor - abatimento),
        encargos_hoje: devido ? { dias: devido.dias, desconto_perdido: devido.desconto_perdido, multa: devido.multa, juros: devido.juros, total: devido.encargos } : null,
        estado,
        dias_atraso: atraso,
        controlada: !corte || !vencimento || vencimento >= corte,
        lancamento_pendente: estado === 'recebida' && !recebimento,
        boleto: boleto ? {
          id: boleto.id, status: boleto.status, nosso_numero: boleto.nosso_numero, ambiente: boleto.ambiente,
          motivo_baixa: boleto.motivo_baixa || null, erro: boleto.status === 'erro' ? (boleto.erro || null) : null
        } : null,
        recebimento: recebimento ? {
          id: recebimento.id, data: dia(recebimento.data_recebimento), valor: centavos(recebimento.valor_recebido),
          forma: recebimento.forma || null, origem: recebimento.origem, competencia: recebimento.competencia
        } : null,
        ordem: ordem && estado === 'a_receber' ? { id: ordem.id, data: dia(ordem.data_prevista), valor: centavos(ordem.valor), forma: ordem.forma || null } : null
      });
    }
  }
  return linhas;
}

/** Os recebimentos da competência (confirmados e estornados), com pedido e cliente. Pura. */
function recebidosDaCompetencia({ recebimentos: recs = [], pedidos = [], notas = [], clientes = [], competencia }) {
  const pedidosPor = new Map(lista(pedidos).filter(Boolean).map(p => [String(p.id), p]));
  const nomes = new Map(lista(clientes).filter(Boolean).map(c => [String(c.id), nomeDoCliente(c)]));
  const notasPorId = new Map(lista(notas).filter(Boolean).map(n => [String(n.id), n]));
  return lista(recs)
    .filter(r => r && String(r.competencia || '').trim() === competencia)
    .map(r => {
      const p = pedidosPor.get(String(r.pedido_id)) || {};
      const nota = r.nota_fiscal_id ? notasPorId.get(String(r.nota_fiscal_id)) : null;
      return {
        id: r.id,
        pedido_id: r.pedido_id,
        pedido: p.numero ?? String(r.pedido_id),
        cliente_id: p.cliente_id ?? null,
        cliente: nomes.get(String(p.cliente_id)) || null,
        nf: nota ? `${nota.serie}/${nota.numero}` : null,
        numero_parcela: Number(r.numero_parcela),
        data: dia(r.data_recebimento),
        data_credito: dia(r.data_credito),
        valor_parcela: centavos(r.valor_parcela),
        abatimento: centavos(r.valor_abatimento),
        valor: centavos(r.valor_recebido),
        encargos: centavos(r.valor_encargos),
        forma: r.forma || null,
        canal: r.canal || null,
        origem: r.origem,
        status: r.status,
        boleto_id: r.boleto_id ?? null,
        observacao: r.observacao || null,
        motivo_estorno: r.motivo_estorno || null
      };
    })
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || Number(b.id) - Number(a.id));
}

const somar = (linhas, campo) => centavos(linhas.reduce((s, l) => s + Number(l[campo] || 0), 0));

/** As visões da tela a partir das parcelas. Pura. */
function visoes({ linhas, recebidos, competencia }) {
  const abertas = linhas.filter(l => l.estado === 'a_receber');
  const controladas = abertas.filter(l => l.controlada);
  return {
    recebidos,
    a_receber: controladas.filter(l => String(l.vencimento || '').startsWith(competencia)).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento))),
    em_atraso: controladas.filter(l => l.dias_atraso > 0).sort((a, b) => b.dias_atraso - a.dias_atraso),
    abertas: abertas.slice().sort((a, b) => Number(b.controlada) - Number(a.controlada) || String(a.vencimento).localeCompare(String(b.vencimento)))
  };
}

/**
 * O resumo e as pendências de cobrança para o painel. `fila` é o número de
 * avisos do BB esperando conciliação; `alertas`, os conciliados com alerta
 * ({ mensagem, quando }), mais novos primeiro.
 */
function resumir({ linhas, recebidos, competencia, desde, fila = 0, alertas = [], sqlPendente = false, hoje, ultimaConciliacao = null }) {
  const v = visoes({ linhas, recebidos, competencia });
  const confirmados = recebidos.filter(r => r.status === 'confirmado');
  const atrasadas = v.em_atraso;
  const maisAntigo = atrasadas.map(l => l.vencimento).filter(Boolean).sort()[0] || null;
  const diasMax = atrasadas.reduce((m, l) => Math.max(m, l.dias_atraso), 0);
  const comBoletoAberto = linhas.filter(l => l.estado === 'a_receber' && l.controlada && l.boleto && boletos.STATUS_A_PAGAR.has(String(l.boleto.status)));
  const aLancar = linhas.filter(l => l.lancamento_pendente);
  const comErro = linhas.filter(l => l.estado === 'a_receber' && l.controlada && l.boleto?.status === 'erro');

  const pendencias = [];
  if (sqlPendente) {
    pendencias.push({ nivel: 'critico', chave: 'recebimentos_sql', titulo: 'Recebimentos ainda não ativados', descricao: recebimentos.SQL_FALTANDO, data: dia(hoje), acao: 'Ver', destino: 'configuracao-cobranca' });
  }
  if (atrasadas.length) {
    pendencias.push({
      nivel: diasMax > DIAS_ATRASO_CRITICO ? 'critico' : 'normal', chave: 'em_atraso',
      titulo: `${plural(atrasadas.length, 'parcela vencida', 'parcelas vencidas')} sem recebimento`,
      descricao: `Total: ${moeda.format(somar(atrasadas, 'a_receber_hoje'))} · mais antiga venceu em ${impressa(maisAntigo)}${diasMax > DIAS_ATRASO_CRITICO ? ` (há ${diasMax} dias: o boleto já não é aceito, reemita)` : ''}`,
      data: maisAntigo, acao: 'Ver', destino: 'recebimentos-atraso'
    });
  }
  if (fila || aLancar.length) {
    const partes = [];
    if (fila) partes.push(plural(fila, 'aviso de pagamento do BB na fila', 'avisos de pagamento do BB na fila'));
    if (aLancar.length) partes.push(plural(aLancar.length, 'boleto pago ainda não lançado', 'boletos pagos ainda não lançados'));
    pendencias.push({ nivel: 'normal', chave: 'conciliar', titulo: 'Pagamentos a conciliar', descricao: partes.join(' · '), data: dia(hoje), acao: 'Conciliar', destino: 'conciliar' });
  }
  if (alertas.length) {
    pendencias.push({ nivel: 'critico', chave: 'alertas', titulo: `${plural(alertas.length, 'aviso do BB precisa', 'avisos do BB precisam')} de conferência`, descricao: alertas[0].mensagem, data: alertas[0].quando || dia(hoje), acao: 'Ver', destino: 'recebimentos-recebidos' });
  }
  if (comErro.length) {
    pendencias.push({ nivel: 'critico', chave: 'boletos_erro', titulo: `${plural(comErro.length, 'boleto recusado', 'boletos recusados')} pelo BB`, descricao: `Pedido ${comErro[0].pedido}, parcela ${comErro[0].numero_parcela}: ${comErro[0].boleto.erro || 'gere de novo pelo pedido'}`, data: comErro[0].vencimento, acao: 'Ver', destino: 'recebimentos-a-receber' });
  }

  return {
    competencia,
    desde: dia(desde),
    recebido: { quantidade: confirmados.length, total: somar(confirmados, 'valor'), encargos: somar(confirmados, 'encargos'), estornados: recebidos.length - confirmados.length },
    // Vencido com boleto conta o que o boleto cobra hoje (cheio + multa +
    // juros); em dia, o valor com desconto (decisões do dono, 25/09/2026).
    a_receber: { quantidade: v.a_receber.length, total: somar(v.a_receber, 'a_receber_hoje') },
    em_atraso: {
      quantidade: atrasadas.length, total: somar(atrasadas, 'a_receber_hoje'), mais_antigo: maisAntigo, dias_max: diasMax,
      em_dia: somar(atrasadas, 'a_receber'), encargos: centavos(somar(atrasadas, 'a_receber_hoje') - somar(atrasadas, 'a_receber'))
    },
    boletos_abertos: { quantidade: comBoletoAberto.length, total: somar(comBoletoAberto, 'a_receber_hoje') },
    a_conciliar: { fila, lancamentos: aLancar.length, alertas: alertas.length },
    sql_pendente: sqlPendente,
    // A conciliação mais recente (automática ou pelo botão), já no horário de Brasília.
    ultima_conciliacao: ultimaConciliacao ? {
      quando: webhookEstado.momentoBR(ultimaConciliacao.iniciado_em),
      como: ultimaConciliacao.tipo_rotulo || ultimaConciliacao.tipo,
      resumo: ultimaConciliacao.resumo || ''
    } : null,
    pendencias
  };
}

/** Por quantos dias um alerta de conciliação fica nas pendências. */
const DIAS_ALERTA = 30;

/**
 * Os feriados cadastrados no Financeiro (`[{ data, descricao }]`), para o
 * vencimento em dia não útil. Sem a tabela (SQL da fase G), só os nacionais.
 */
async function lerFeriados(api) {
  const linhas = await api.get('/api/financeiro_feriados').then(lista).catch(() => []);
  return linhas.filter(f => f && f.data).map(f => ({ data: dia(f.data), descricao: f.descricao || 'Feriado' })).filter(f => f.data);
}

/** Lê tudo o que as contas precisam. Clientes só dos pedidos que aparecem. */
async function lerBase(api, hoje) {
  const [pedidos, parcelas, bols, notas, eventos, feriados, ordens] = await Promise.all([
    api.get('/api/pedidos').then(lista).catch(() => []),
    api.get('/api/pedido_parcelas').then(lista).catch(() => []),
    api.get('/api/boletos').then(lista).catch(() => []),
    api.get('/api/notas_fiscais').then(lista).catch(() => []),
    api.get('/api/boletos_eventos', { query: { origem: 'webhook' } }).then(lista).catch(() => []),
    lerFeriados(api),
    // Ordens de pagamento abertas (sql/ordens_pagamento.sql); sem a tabela, nenhuma.
    api.get('/api/ordens_pagamento', { query: { status: 'aberta' } }).then(lista).catch(() => [])
  ]);
  let recs = [];
  let sqlPendente = false;
  try {
    recs = await recebimentos.lerTodos(api);
  } catch (e) {
    if (!e?.extra?.sql_pendente) throw e;
    sqlPendente = true;
  }
  // Os XMLs das notas não servem aqui.
  const notasLeves = notas.map(n => ({ id: n.id, pedido_id: n.pedido_id, serie: n.serie, numero: n.numero, status_fiscal: n.status_fiscal, data_emissao: n.data_emissao ?? null, valor_total: n.valor_total ?? null }));
  const doWebhook = eventos.filter(e => e && e.origem === 'webhook');
  // Sem a tabela da fase F, simplesmente não há "última conciliação".
  const execs = await execucoes.recentes(api, 1).catch(() => ({ linhas: [] }));
  return {
    pedidos, parcelas, boletos: bols, notas: notasLeves, recebimentos: recs, sqlPendente, feriados,
    ordens: ordens.filter(o => o && o.status === 'aberta'),
    ultimaConciliacao: execs.linhas[0] || null,
    fila: doWebhook.filter(e => !e.processado_em).length,
    // Aviso conciliado com alerta (pagamento de boleto já baixado aqui), dos últimos dias.
    alertas: doWebhook
      .filter(e => e.processado_em && e.boleto_id && e.erro_processamento && (diasEntre(hoje, e.criado_em || e.processado_em) ?? 0) <= DIAS_ALERTA)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map(e => ({ boleto_id: e.boleto_id, mensagem: e.erro_processamento, quando: dia(e.criado_em || e.processado_em) }))
  };
}

async function clientesDe(api, ids) {
  const unicos = [...new Set(ids.filter(v => v !== null && v !== undefined).map(String))];
  const achados = await Promise.all(unicos.map(id => api.get('/api/clientes', { query: { id } }).then(r => lista(r).find(c => String(c?.id) === id) || null).catch(() => null)));
  return achados.filter(Boolean);
}

/** O painel (resumo + pendências) da competência. */
async function carregarPainel({ api, competencia, hoje, desde }) {
  const base = await lerBase(api, hoje);
  const comp = competenciaValida(competencia, hoje);
  const linhas = parcelasDosPedidos({ ...base, hoje, desde });
  const recebidos = recebidosDaCompetencia({ ...base, competencia: comp });
  return resumir({ linhas, recebidos, competencia: comp, desde, fila: base.fila, alertas: base.alertas, sqlPendente: base.sqlPendente, hoje, ultimaConciliacao: base.ultimaConciliacao });
}

const VISOES = ['recebidos', 'a_receber', 'em_atraso', 'abertas'];

/** Uma visão com os nomes dos clientes. */
async function carregarVisao({ api, competencia, visao, hoje, desde }) {
  if (!VISOES.includes(visao)) {
    const e = new Error(`Visão desconhecida: ${visao}`);
    e.status = 400;
    throw e;
  }
  const base = await lerBase(api, hoje);
  const comp = competenciaValida(competencia, hoje);
  const linhas = parcelasDosPedidos({ ...base, hoje, desde });
  const recebidos = recebidosDaCompetencia({ ...base, competencia: comp });
  const escolhidas = visoes({ linhas, recebidos, competencia: comp })[visao];
  const clientes = await clientesDe(api, escolhidas.map(l => l.cliente_id));
  const nomes = new Map(clientes.map(c => [String(c.id), nomeDoCliente(c)]));
  return {
    competencia: comp,
    visao,
    desde: dia(desde),
    sql_pendente: base.sqlPendente,
    linhas: escolhidas.map(l => ({ ...l, cliente: l.cliente || nomes.get(String(l.cliente_id)) || null })),
    resumo: resumir({ linhas, recebidos, competencia: comp, desde, fila: base.fila, alertas: base.alertas, sqlPendente: base.sqlPendente, hoje, ultimaConciliacao: base.ultimaConciliacao })
  };
}

module.exports = {
  SITUACOES_FATURADAS, DIAS_ATRASO_CRITICO, VISOES,
  diasEntre, competenciaValida, parcelasDosPedidos, recebidosDaCompetencia, visoes, resumir, lerFeriados, lerBase, carregarPainel, carregarVisao
};
