/**
 * Motor das comissões (CMS e Royalty) — fase G. Tudo aqui é puro.
 *
 * Por parcela de pedido faturado:
 *   base (valor líquido) = valor da parcela − abatimento do boleto − ajustes ativos
 *   comissão             = base × % de cada beneficiário (regras.taxasDoPedido)
 *
 *   - a receber, sem vencer   → prevista
 *   - a receber, vencida      → atrasada (potencial; aging 1–15/16–30/31–60/61–90/+90)
 *   - recebida                → devida na competência do recebimento (mês em que o
 *                               cliente pagou); recebimento parcial não existe no
 *                               app: a parcela é recebida inteira
 *   - cancelada / pedido cancelado → não realizada
 *
 * Fechar congela. Depois disso nada é reescrito: o que muda na parcela
 * (ajuste, estorno do recebimento, cancelamento) vira um item de AJUSTE =
 * devido hoje − o que já foi fechado, por beneficiário, com os percentuais
 * com que a parcela foi fechada, e entra na próxima competência a fechar.
 * Ex.: fechada sobre R$ 20.000 a 10% + 10%; devolução de R$ 3.000 →
 * −R$ 300 de CMS e −R$ 300 de Royalty no próximo fechamento.
 *
 * Saldo negativo de um beneficiário num fechamento (só houve estornos)
 * não se paga: passa para o fechamento seguinte como item de SALDO.
 */
const c = require('./comum');
const regras = require('./regras');

const FAIXAS = ['1–15', '16–30', '31–60', '61–90', '+90'];
const TIPOS_AJUSTE = { devolucao: 'Devolução', desconto: 'Desconto comercial', abatimento: 'Abatimento', cancelamento: 'Cancelamento parcial', outros: 'Outros' };
const STATUS_FECHADOS = new Set(['fechado']);

const chaveDe = (pedidoId, numero) => `${pedidoId}:${Number(numero)}`;
const chaveBenef = b => `${b.tipo}:${String(b.beneficiario || '').trim().toLowerCase()}`;

function faixaDeAtraso(dias) {
  const d = Number(dias) || 0;
  if (d <= 15) return '1–15';
  if (d <= 30) return '16–30';
  if (d <= 60) return '31–60';
  if (d <= 90) return '61–90';
  return '+90';
}

/** 'YYYY-MM-DD' em Brasília de um instante (TIMESTAMPTZ). */
function diaEmBrasilia(instante) {
  if (!instante) return null;
  const texto = String(instante);
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return c.dia(texto);
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = t => partes.find(p => p.type === t)?.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Soma por beneficiário: Map chave -> { tipo, beneficiario, valor }. */
function somarBeneficiarios(listas) {
  const mapa = new Map();
  for (const l of listas) {
    for (const b of l || []) {
      const k = chaveBenef(b);
      const atual = mapa.get(k) || { tipo: b.tipo, beneficiario: b.beneficiario, valor: 0 };
      atual.valor = c.centavos(atual.valor + Number(b.valor || 0));
      mapa.set(k, atual);
    }
  }
  return mapa;
}

const totaisDe = benefs => ({
  cms: c.centavos(benefs.filter(b => b.tipo === 'cms').reduce((s, b) => s + b.valor, 0)),
  royalty: c.centavos(benefs.filter(b => b.tipo === 'royalty').reduce((s, b) => s + b.valor, 0))
});

/**
 * Os fechamentos de um tipo: quais competências estão fechadas, a próxima a
 * fechar e os itens congelados de cada um (com o pagamento, se houver).
 */
function estadoDosFechamentos({ fechamentos = [], itens = [], pagamentos = [], tipo }) {
  const doTipo = fechamentos.filter(f => f && f.tipo === tipo && STATUS_FECHADOS.has(String(f.status)));
  const porId = new Map(doTipo.map(f => [String(f.id), f]));
  const pagoPor = new Map(pagamentos.filter(Boolean).map(p => [String(p.fechamento_id), p]));
  const congelados = itens.filter(i => i && porId.has(String(i.fechamento_id))).map(i => ({
    ...i, detalhes: c.jsonDe(i.detalhes, {}), competencia: porId.get(String(i.fechamento_id)).competencia,
    pago: pagoPor.has(String(i.fechamento_id))
  }));
  const ordenados = doTipo.slice().sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));
  const ultimo = ordenados[ordenados.length - 1] || null;
  return {
    fechados: new Map(ordenados.map(f => [String(f.competencia).trim(), { ...f, resumo: c.jsonDe(f.por_setor, []), pagamento: pagoPor.get(String(f.id)) || null }])),
    ultimo: ultimo ? { ...ultimo, resumo: c.jsonDe(ultimo.por_setor, []) } : null,
    proxima: ultimo ? c.somarMeses(String(ultimo.competencia).trim(), 1) : null,
    congelados
  };
}

/** Em que competência cai um item pendente: a natural, ou a próxima a fechar se a natural já foi fechada. */
const competenciaAlvo = (natural, proxima) => (proxima && natural && natural < proxima ? proxima : natural);

/**
 * A situação de comissão de todas as parcelas. `linhas` vem de
 * contasReceber.parcelasDosPedidos; `recebimentos` são todos (com os
 * estornados); `ajustes`, todos; `estado`, de estadoDosFechamentos.
 */
function apurar({ linhas = [], pedidos = [], parcelas = [], recebimentos = [], ajustes = [], regrasLista = [], estado, hoje }) {
  const pedidosPor = new Map(pedidos.filter(Boolean).map(p => [String(p.id), p]));
  const recPor = new Map(recebimentos.filter(Boolean).map(r => [String(r.id), r]));
  const confirmadoPor = new Map(recebimentos.filter(r => r && r.status === 'confirmado').map(r => [chaveDe(r.pedido_id, r.numero_parcela), r]));
  const ajustesPor = new Map();
  for (const a of ajustes.filter(Boolean)) {
    const k = chaveDe(a.pedido_id, a.numero_parcela);
    if (!ajustesPor.has(k)) ajustesPor.set(k, []);
    ajustesPor.get(k).push(a);
  }
  const congeladosPor = new Map();
  for (const i of estado.congelados) {
    // Itens de saldo não são de parcela nenhuma.
    if (i.pedido_id === null || i.pedido_id === undefined || i.tipo_item === 'saldo') continue;
    const k = chaveDe(i.pedido_id, i.numero_parcela);
    if (!congeladosPor.has(k)) congeladosPor.set(k, []);
    congeladosPor.get(k).push(i);
  }
  const linhaPor = new Map(linhas.map(l => [chaveDe(l.pedido_id, l.numero_parcela), l]));
  const chaves = new Set([...linhaPor.keys(), ...confirmadoPor.keys(), ...congeladosPor.keys()]);
  const parcelaPor = new Map(parcelas.filter(Boolean).map(p => [chaveDe(p.pedido_id, p.numero_parcela), p]));
  const saida = [];

  for (const chave of chaves) {
    const [pedidoId, numero] = chave.split(':');
    const pedido = pedidosPor.get(pedidoId) || null;
    const cancelado = !pedido || String(pedido.situacao || '').trim().toLowerCase() === 'cancelado';
    let linha = linhaPor.get(chave) || null;
    const confirmado = cancelado ? null : (confirmadoPor.get(chave) || null);
    if (!linha) {
      // Parcela fora das contas a receber (pedido não faturado com recebimento à mão, cancelado ou apagado).
      const parcela = parcelaPor.get(chave);
      linha = {
        pedido_id: Number(pedidoId), pedido: pedido?.numero ?? pedidoId, cliente_id: pedido?.cliente_id ?? null, cliente: null, nf: null,
        numero_parcela: Number(numero), parcela: String(numero), vencimento: c.dia(parcela?.data_vencimento), valor: c.centavos(parcela?.valor ?? confirmado?.valor_parcela ?? 0),
        abatimento: 0, estado: confirmado ? 'recebida' : (cancelado ? 'cancelada' : 'a_receber'), dias_atraso: 0, controlada: false, lancamento_pendente: false, boleto: null,
        recebimento: null
      };
    }
    const daParcela = (ajustesPor.get(chave) || []).slice().sort((a, b) => String(a.data_ajuste).localeCompare(String(b.data_ajuste)) || Number(a.id) - Number(b.id));
    const ativos = daParcela.filter(a => a.status === 'ativo');
    const congelados = (congeladosPor.get(chave) || []).slice().sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)) || Number(a.id) - Number(b.id));
    const itensParcela = congelados.filter(i => i.tipo_item === 'parcela');
    const ultimoParcela = itensParcela[itensParcela.length - 1] || null;

    // Percentuais: os do fechamento, se a parcela já foi fechada; senão, as regras de hoje.
    const taxas = ultimoParcela?.detalhes?.taxas
      ? { ...ultimoParcela.detalhes.taxas, congeladas: true }
      : { ...regras.taxasDoPedido(regrasLista, pedido || { id: pedidoId, cliente_id: linha.cliente_id }), congeladas: false };

    const valorOriginal = c.centavos(confirmado ? (confirmado.valor_parcela ?? linha.valor) : linha.valor);
    const abatimentoBoleto = c.centavos(confirmado ? (confirmado.valor_abatimento || 0) : (linha.abatimento || 0));
    const ajustesTotal = c.centavos(ativos.reduce((s, a) => s + Number(a.valor || 0), 0));
    const liquido = c.centavos(Math.max(0, valorOriginal - abatimentoBoleto - ajustesTotal));
    const potencial = regras.valoresSobre(liquido, taxas);
    const recebida = Boolean(confirmado) && !cancelado;
    const devidoBenef = recebida ? potencial.beneficiarios : [];

    // O que já foi fechado, por beneficiário.
    const congeladoMapa = somarBeneficiarios(congelados.map(i => i.detalhes?.beneficiarios || []));
    const congeladoLista = [...congeladoMapa.values()];
    const congeladoTot = totaisDe(congeladoLista);
    const idsNoFechamento = new Set(congelados.flatMap(i => (i.detalhes?.ajustes || []).map(String)));
    const recebimentosFechados = new Set(itensParcela.map(i => String(i.recebimento_id)));

    const base = {
      chave, pedido_id: linha.pedido_id, pedido: linha.pedido, cliente_id: linha.cliente_id, cliente: linha.cliente, nf: linha.nf,
      numero_parcela: linha.numero_parcela, parcela: linha.parcela
    };
    const pendentes = [];
    const delta = (alvoBenef, motivo, dataRef, extra = {}) => {
      const alvo = somarBeneficiarios([alvoBenef]);
      const chavesB = new Set([...alvo.keys(), ...congeladoMapa.keys()]);
      const benefs = [];
      for (const k of chavesB) {
        const a = alvo.get(k) || { ...(congeladoMapa.get(k)), valor: 0 };
        const valor = c.centavos((alvo.get(k)?.valor || 0) - (congeladoMapa.get(k)?.valor || 0));
        if (Math.abs(valor) >= 0.01) benefs.push({ tipo: a.tipo, beneficiario: a.beneficiario, percentual: null, valor });
      }
      if (!benefs.length) return;
      const t = totaisDe(benefs);
      const natural = c.competenciaDe(dataRef || hoje);
      pendentes.push({
        ...base, tipo_item: 'ajuste', recebimento_id: confirmado?.id ?? null, data_referencia: dataRef || hoje,
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado.proxima),
        valor_parcela: valorOriginal, ajustes: ajustesTotal, base: liquido, pct_cms: taxas.pct_cms, pct_royalty: taxas.pct_royalty,
        cms: t.cms, royalty: t.royalty, total: c.centavos(t.cms + t.royalty), motivo,
        detalhes: { beneficiarios: benefs, ajustes: ativos.map(a => a.id), motivo, ...extra }
      });
    };

    if (recebida && !recebimentosFechados.has(String(confirmado.id))) {
      // Um recebimento anterior foi fechado e depois estornado: desfaz aquele primeiro.
      if (congelados.length) {
        const estornado = itensParcela.map(i => recPor.get(String(i.recebimento_id))).filter(Boolean).pop();
        delta([], 'Recebimento anterior estornado', diaEmBrasilia(estornado?.estornado_em) || c.dia(confirmado.data_recebimento));
        congeladoMapa.clear();
      }
      const natural = c.competenciaDe(confirmado.data_recebimento) || String(confirmado.competencia || '').trim();
      pendentes.push({
        ...base, tipo_item: 'parcela', recebimento_id: confirmado.id, data_referencia: c.dia(confirmado.data_recebimento),
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado.proxima),
        valor_parcela: valorOriginal, ajustes: c.centavos(abatimentoBoleto + ajustesTotal), base: liquido, pct_cms: taxas.pct_cms, pct_royalty: taxas.pct_royalty,
        cms: potencial.cms, royalty: potencial.royalty, total: potencial.total, motivo: null,
        detalhes: { beneficiarios: potencial.beneficiarios, ajustes: ativos.map(a => a.id), abatimento_boleto: abatimentoBoleto, taxas: { cms: taxas.cms, royalty: taxas.royalty, pct_cms: taxas.pct_cms, pct_royalty: taxas.pct_royalty } }
      });
    } else if (congelados.length) {
      // Já fechada: o que mudou depois vira ajuste.
      const novos = ativos.filter(a => !idsNoFechamento.has(String(a.id)));
      const desfeitos = daParcela.filter(a => a.status !== 'ativo' && idsNoFechamento.has(String(a.id)));
      let motivo;
      let dataRef;
      if (!recebida) {
        const estornado = itensParcela.map(i => recPor.get(String(i.recebimento_id))).filter(Boolean).pop();
        motivo = cancelado ? 'Pedido cancelado depois do fechamento' : 'Recebimento estornado depois do fechamento';
        dataRef = diaEmBrasilia(estornado?.estornado_em) || hoje;
      } else {
        const partes = [
          ...novos.map(a => `${TIPOS_AJUSTE[a.tipo] || a.tipo} de ${c.reais(a.valor)} em ${c.impressa(a.data_ajuste)}`),
          ...desfeitos.map(a => `${TIPOS_AJUSTE[a.tipo] || a.tipo} de ${c.reais(a.valor)} cancelado`)
        ];
        motivo = partes.length ? partes.join('; ') : 'Correção do valor já fechado';
        const datas = [...novos.map(a => c.dia(a.data_ajuste)), ...desfeitos.map(a => diaEmBrasilia(a.cancelado_em))].filter(Boolean).sort();
        dataRef = datas[datas.length - 1] || hoje;
      }
      delta(devidoBenef, motivo, dataRef, { ajustes_novos: novos.map(a => a.id), ajustes_desfeitos: desfeitos.map(a => a.id) });
    }

    const vencida = linha.estado === 'a_receber' && Number(linha.dias_atraso) > 0;
    let situacao = 'prevista';
    if (linha.estado === 'cancelada' || cancelado) situacao = 'nao_realizada';
    else if (recebida && pendentes.some(p => p.tipo_item === 'parcela')) situacao = 'apurada';
    else if (recebida && itensParcela.length) situacao = itensParcela.some(i => i.pago) ? 'paga' : 'fechada';
    else if (linha.lancamento_pendente) situacao = 'a_lancar';
    else if (vencida) situacao = 'atrasada';

    saida.push({
      ...base,
      vencimento: linha.vencimento, dias_atraso: Number(linha.dias_atraso) || 0, faixa: vencida ? faixaDeAtraso(linha.dias_atraso) : null,
      controlada: linha.controlada !== false, estado_parcela: cancelado ? 'cancelada' : linha.estado, lancamento_pendente: Boolean(linha.lancamento_pendente),
      boleto: linha.boleto || null,
      recebimento: confirmado ? { id: confirmado.id, data: c.dia(confirmado.data_recebimento), valor: c.centavos(confirmado.valor_recebido), competencia: String(confirmado.competencia || '').trim(), forma: confirmado.forma || null } : null,
      valor_original: valorOriginal, abatimento_boleto: abatimentoBoleto, ajustes_total: ajustesTotal, liquido,
      ajustes: daParcela.map(a => ({ ...a, data_ajuste: c.dia(a.data_ajuste), valor: c.centavos(a.valor), rotulo: TIPOS_AJUSTE[a.tipo] || a.tipo, no_fechamento: idsNoFechamento.has(String(a.id)) })),
      taxas, sem_regra: !taxas.congeladas && taxas.sem_regra,
      potencial, congelado: { ...congeladoTot, total: c.centavos(congeladoTot.cms + congeladoTot.royalty), itens: congelados },
      comissao_fechada: congelados.length > 0,
      pendentes, situacao
    });
  }
  return saida;
}

/** Todos os itens pendentes (ainda não fechados). */
const pendentesDe = apuradas => apuradas.flatMap(p => p.pendentes);

/**
 * Itens de SALDO: beneficiários que terminaram o último fechamento no
 * negativo levam o valor para o próximo.
 */
function saldosAnteriores(estado) {
  const ultimo = estado.ultimo;
  if (!ultimo) return [];
  return (ultimo.resumo || [])
    .filter(b => Number(b.valor) < 0)
    .map(b => ({
      chave: `saldo:${ultimo.id}:${chaveBenef(b)}`, tipo_item: 'saldo', pedido_id: null, numero_parcela: null,
      competencia_natural: estado.proxima, competencia: estado.proxima, data_referencia: null,
      cms: b.tipo === 'cms' ? c.centavos(b.valor) : 0, royalty: b.tipo === 'royalty' ? c.centavos(b.valor) : 0, total: c.centavos(b.valor),
      motivo: `Saldo negativo de ${b.beneficiario} em ${c.rotuloCompetencia(String(ultimo.competencia).trim())}`,
      detalhes: { beneficiarios: [{ tipo: b.tipo, beneficiario: b.beneficiario, percentual: null, valor: c.centavos(b.valor) }], fechamento_id: ultimo.id }
    }));
}

/**
 * O que um fechamento de comissões da competência teria (prévia) ou tem
 * (fechado). Itens pendentes entram quando a competência-alvo é ≤ a pedida
 * (o primeiro fechamento leva também o que ficou de meses anteriores).
 */
/** Um item congelado (linha do banco) no mesmo formato dos pendentes. Pura. */
function itemCongelado(i) {
  const d = i.detalhes || {};
  const num = v => (v === null || v === undefined || v === '' ? null : c.centavos(v));
  return {
    chave: i.pedido_id ? chaveDe(i.pedido_id, i.numero_parcela) : `saldo:${i.id}`,
    id: i.id, fechamento_id: i.fechamento_id, tipo_item: i.tipo_item,
    pedido_id: i.pedido_id ?? null, pedido: d.pedido ?? (i.pedido_id ? String(i.pedido_id) : null), cliente_id: d.cliente_id ?? null, cliente: null,
    nf: d.nf ?? null, numero_parcela: i.numero_parcela === null || i.numero_parcela === undefined ? null : Number(i.numero_parcela), parcela: d.parcela ?? null,
    recebimento_id: i.recebimento_id ?? null, data_referencia: c.dia(i.data_referencia),
    competencia_natural: String(i.competencia_origem || '').trim() || i.competencia, competencia: i.competencia,
    valor_parcela: num(i.valor_parcela), ajustes: num(i.ajustes), base: num(i.base),
    pct_cms: i.pct_cms === null || i.pct_cms === undefined ? null : Number(i.pct_cms),
    pct_royalty: i.pct_royalty === null || i.pct_royalty === undefined ? null : Number(i.pct_royalty),
    cms: c.centavos(i.cms), royalty: c.centavos(i.royalty), total: c.centavos(i.total),
    motivo: d.motivo || null, pago: Boolean(i.pago), detalhes: d
  };
}

function montarFechamento({ apuradas, estado, competencia }) {
  const fechado = estado.fechados.get(competencia) || null;
  const itens = fechado
    ? estado.congelados.filter(i => String(i.fechamento_id) === String(fechado.id)).map(itemCongelado)
    : [
      ...pendentesDe(apuradas).filter(p => p.competencia && p.competencia <= competencia),
      ...(estado.proxima === competencia ? saldosAnteriores(estado) : [])
    ];
  return resumirItens(itens, { fechado, competencia });
}

function resumirItens(itens, { fechado = null, competencia }) {
  const num = v => c.centavos(v);
  const parcelasI = itens.filter(i => i.tipo_item === 'parcela');
  const ajustesI = itens.filter(i => i.tipo_item !== 'parcela');
  const porBenef = [...somarBeneficiarios(itens.map(i => (i.detalhes?.beneficiarios) || [])).values()]
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
  const aPagar = num(porBenef.filter(b => b.valor > 0).reduce((s, b) => s + b.valor, 0));
  const aCompensar = num(porBenef.filter(b => b.valor < 0).reduce((s, b) => s + b.valor, 0));
  return {
    competencia,
    fechado: Boolean(fechado),
    fechamento: fechado ? { id: fechado.id, fechado_em: fechado.fechado_em, fechado_por: fechado.fechado_por, pagar_ate: c.dia(fechado.pagar_ate), pagamento: fechado.pagamento || null } : null,
    parcelas: parcelasI.length,
    base: num(parcelasI.reduce((s, i) => s + Number(i.base || 0), 0)),
    cms: num(parcelasI.reduce((s, i) => s + Number(i.cms || 0), 0)),
    royalty: num(parcelasI.reduce((s, i) => s + Number(i.royalty || 0), 0)),
    comissao: num(parcelasI.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
    ajustes: num(ajustesI.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
    liquido: num(itens.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
    a_pagar: fechado ? num(fechado.total) : aPagar,
    a_compensar: aCompensar,
    beneficiarios: porBenef,
    itens
  };
}

/** Aging das parcelas atrasadas (as 5 faixas, mesmo vazias). */
function aging(atrasadas) {
  return FAIXAS.map(faixa => {
    const da = atrasadas.filter(p => p.faixa === faixa);
    return {
      faixa, parcelas: da.length,
      liquido: c.centavos(da.reduce((s, p) => s + p.liquido, 0)),
      comissao: c.centavos(da.reduce((s, p) => s + p.potencial.total, 0))
    };
  });
}

const soma = (l, f) => c.centavos(l.reduce((s, x) => s + Number(f(x) || 0), 0));

/** As visões de comissão para a tela e os relatórios. */
function visoes(apuradas) {
  const controladas = apuradas.filter(p => p.controlada);
  const atrasadas = controladas.filter(p => p.situacao === 'atrasada').sort((a, b) => b.dias_atraso - a.dias_atraso);
  const previstas = controladas.filter(p => p.situacao === 'prevista').sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const naoRealizadas = apuradas.filter(p => p.situacao === 'nao_realizada' || p.ajustes_total > 0);
  return { atrasadas, previstas, naoRealizadas };
}

module.exports = {
  FAIXAS, TIPOS_AJUSTE, chaveDe, chaveBenef, faixaDeAtraso, diaEmBrasilia, somarBeneficiarios, totaisDe,
  estadoDosFechamentos, competenciaAlvo, apurar, pendentesDe, saldosAnteriores, itemCongelado, montarFechamento, resumirItens, aging, visoes, soma
};
