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
 * Saldo negativo de um beneficiário num fechamento (estornos, ou um ajuste
 * por pessoa maior que o mês dele) não se paga: passa para o fechamento
 * seguinte como item de SALDO — o "Ajuste restante do mês anterior".
 *
 * A base é o VALOR REAL do que se cobra (pedido do dono, 06/10/2026): a
 * parcela recebida vale o que o recebimento cobriu dela; a parcela em aberto,
 * o boleto vivo (o valor em dia) ou a ordem de pagamento aberta; sem nenhum
 * dos dois, a parcela do pedido — que já leva o Adicional ou o Desconto do
 * "Pagamento do pedido" e do "Gerar boletos".
 *
 * Os ajustes POR PESSOA (ajustesPessoa.js: bonificação, adiantamento,
 * correção… na CMS ou no Royalty de alguém) entram como itens de ajuste do
 * mês escolhido, numa entrada própria de `apurar` (tipo_entrada
 * 'ajuste_pessoa', sem pedido nem parcela).
 */
const c = require('./comum');
const regras = require('./regras');
const vencimentos = require('../cobranca/vencimento');
const ajustesPessoa = require('./ajustesPessoa');

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
/**
 * O que foi pago de um fechamento: a lista, o total e o que falta. `pagamento`
 * continua existindo (o pagamento "de tudo", ou o primeiro) para quem só
 * pergunta "já foi pago?".
 */
function pagamentosDoFechamento(fechamento, lista) {
  const pagos = (lista || []).slice().sort((a, b) => String(a.data_pagamento).localeCompare(String(b.data_pagamento)));
  const pago = c.centavos(pagos.reduce((s, p) => s + (Number(p.valor) || 0), 0));
  const total = c.centavos(fechamento?.total);
  return {
    pagamentos: pagos,
    pagamento: pagos.find(p => !p.beneficiario && !p.tipo_comissao) || pagos[0] || null,
    pago,
    falta_pagar: c.centavos(Math.max(0, total - pago))
  };
}

function estadoDosFechamentos({ fechamentos = [], itens = [], pagamentos = [], tipo }) {
  const doTipo = fechamentos.filter(f => f && f.tipo === tipo && STATUS_FECHADOS.has(String(f.status)));
  const porId = new Map(doTipo.map(f => [String(f.id), f]));
  // Um fechamento pode ter VÁRIOS pagamentos: dá para pagar só a CMS, só o
  // Royalty ou só uma pessoa (financeiro_pagamentos.beneficiario/tipo_comissao).
  const pagoPor = new Map();
  for (const p of pagamentos.filter(Boolean)) {
    const chave = String(p.fechamento_id);
    if (!pagoPor.has(chave)) pagoPor.set(chave, []);
    pagoPor.get(chave).push(p);
  }
  const congelados = itens.filter(i => i && porId.has(String(i.fechamento_id))).map(i => ({
    ...i, detalhes: c.jsonDe(i.detalhes, {}), competencia: porId.get(String(i.fechamento_id)).competencia,
    pago: pagoPor.has(String(i.fechamento_id))
  }));
  const ordenados = doTipo.slice().sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));
  const ultimo = ordenados[ordenados.length - 1] || null;
  return {
    fechados: new Map(ordenados.map(f => [String(f.competencia).trim(), { ...f, resumo: c.jsonDe(f.por_setor, []), ...pagamentosDoFechamento(f, pagoPor.get(String(f.id)) || []) }])),
    ultimo: ultimo ? { ...ultimo, resumo: c.jsonDe(ultimo.por_setor, []) } : null,
    proxima: ultimo ? c.somarMeses(String(ultimo.competencia).trim(), 1) : null,
    congelados
  };
}

/** Em que competência cai um item pendente: a natural, ou a próxima a fechar se a natural já foi fechada. */
const competenciaAlvo = (natural, proxima) => (proxima && natural && natural < proxima ? proxima : natural);

/**
 * O valor real da parcela, que é a base da comissão (pedido do dono,
 * 06/10/2026).
 *
 * Recebida: o que o cliente pagou dela, sem passar do valor da parcela. O
 * valor da parcela é o maior entre o que o recebimento registrou (o boleto em
 * dia, ou a parcela do dia do pagamento) e o que a parcela vale HOJE — o
 * Adicional lançado no "Pagamento do pedido" depois do pagamento conta (o
 * PED105: Pix de R$ 12.800,25 numa parcela de R$ 12.774,28 que depois virou
 * R$ 12.800,25; a comissão ficava nos R$ 12.774,28 e tratava a diferença como
 * juros). Multa e juros do atraso continuam fora: passam do valor da parcela.
 *
 * Em aberto: o boleto vivo pelo valor em dia (o cheio menos o desconto até o
 * vencimento — o abatimento sai à parte), ou a ordem de pagamento aberta; sem
 * nenhum dos dois, a parcela do pedido. Pura.
 */
function valorRealDaParcela(linha, confirmado) {
  if (confirmado) {
    const registrado = c.centavos(confirmado.valor_parcela ?? linha?.valor);
    const hoje = linha?.valor === null || linha?.valor === undefined ? registrado : c.centavos(linha.valor);
    const teto = Math.max(registrado, hoje);
    // O abatimento do boleto conta como coberto (ele sai da base à parte, em apurar).
    const cobriu = c.centavos(Number(confirmado.valor_recebido || 0) + Number(confirmado.valor_abatimento || 0));
    return { valor: cobriu > 0 ? c.centavos(Math.min(cobriu, teto)) : teto, origem: 'recebimento' };
  }
  if (Number(linha?.valor_boleto) > 0) {
    return { valor: c.centavos(Number(linha.valor_boleto) - Number(linha.desconto_condicional || 0)), origem: 'boleto' };
  }
  if (linha?.ordem && Number(linha.ordem.valor) > 0) return { valor: c.centavos(linha.ordem.valor), origem: 'ordem' };
  return { valor: c.centavos(linha?.valor), origem: 'parcela' };
}

/**
 * A entrada de `apurar` de um ajuste por pessoa: não é parcela de ninguém
 * (sem pedido, sem vencimento, fora das visões de parcela) e leva o item do
 * fechamento em `pendentes`, como as parcelas. Pura.
 */
function entradaDoAjustePessoa(item) {
  return {
    chave: item.chave, tipo_entrada: 'ajuste_pessoa', ajuste_pessoa: item.detalhes.ajuste_pessoa,
    pedido_id: null, pedido: null, cliente_id: null, cliente: null, nf: null, numero_parcela: null, parcela: null,
    vencimento: null, dias_atraso: 0, faixa: null, controlada: false, estado_parcela: 'ajuste', lancamento_pendente: false,
    boleto: null, recebimento: null, valor_original: 0, base_origem: null, abatimento_boleto: 0, ajustes_total: 0, liquido: 0, ajustes: [],
    taxas: { cms: [], royalty: [], pct_cms: 0, pct_royalty: 0, congeladas: false }, sem_regra: false,
    potencial: { cms: 0, royalty: 0, total: 0, beneficiarios: [] }, congelado: { cms: 0, royalty: 0, total: 0, itens: [] },
    comissao_fechada: false, pendentes: [item], situacao: 'ajuste_pessoa'
  };
}

/**
 * A situação de comissão de todas as parcelas. `linhas` vem de
 * contasReceber.parcelasDosPedidos; `recebimentos` são todos (com os
 * estornados); `ajustes`, todos; `estado`, de estadoDosFechamentos.
 * `contexto` (base.contextoDosPedidos): o dono do cliente e os desenhistas de
 * cada pedido — é com ele que a CMS vai para o dono do cliente e o Royalty
 * para os desenhistas. Sem ele, a conta antiga (quem recebe vem da regra).
 * `ajustesPessoa`: as linhas de financeiro_ajustes_pessoa (as de CMS e
 * Royalty fora de fechamento viram entradas próprias, no fim da lista).
 */
function apurar({ linhas = [], pedidos = [], parcelas = [], recebimentos = [], ajustes = [], regrasLista = [], estado, hoje, contexto = null, ajustesPessoa: porPessoa = [] }) {
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
      : {
        ...regras.taxasDoPedido(regrasLista, pedido || { id: pedidoId, cliente_id: linha.cliente_id },
          contexto ? (contexto.get(String(pedidoId)) || { dono_cliente: null, desenhistas: [] }) : undefined),
        congeladas: false
      };

    const real = valorRealDaParcela(linha, confirmado);
    const valorOriginal = real.valor;
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
        // `ajuste_manual` é o que os ajustes à mão tiraram da base desta
        // parcela: é com ele que o card mostra que houve ajuste (sem ele,
        // a comissão só aparece menor, sem dizer por quê).
        detalhes: { beneficiarios: potencial.beneficiarios, ajustes: ativos.map(a => a.id), ajuste_manual: ajustesTotal, abatimento_boleto: abatimentoBoleto, taxas: { cms: taxas.cms, royalty: taxas.royalty, pct_cms: taxas.pct_cms, pct_royalty: taxas.pct_royalty } }
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
        // A parcela mudou de valor depois do fechamento (Adicional ou Desconto
        // lançado no pedido): a diferença vem com o motivo dito (06/10/2026).
        const fechadaCom = ultimoParcela && ultimoParcela.valor_parcela !== null && ultimoParcela.valor_parcela !== undefined
          ? c.centavos(ultimoParcela.valor_parcela) : null;
        const mudouValor = fechadaCom !== null && Math.abs(valorOriginal - fechadaCom) >= 0.01;
        const partes = [
          ...(mudouValor ? [`${valorOriginal > fechadaCom ? 'Adicional' : 'Desconto'} no pedido: a parcela foi de ${c.reais(fechadaCom)} para ${c.reais(valorOriginal)}`] : []),
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
      // `base_origem`: de onde veio o valor (recebimento, boleto, ordem ou parcela).
      valor_original: valorOriginal, base_origem: real.origem, valor_parcela_pedido: c.centavos(linha.valor),
      abatimento_boleto: abatimentoBoleto, ajustes_total: ajustesTotal, liquido,
      ajustes: daParcela.map(a => ({ ...a, data_ajuste: c.dia(a.data_ajuste), valor: c.centavos(a.valor), rotulo: TIPOS_AJUSTE[a.tipo] || a.tipo, no_fechamento: idsNoFechamento.has(String(a.id)) })),
      taxas, sem_regra: !taxas.congeladas && taxas.sem_regra,
      potencial, congelado: { ...congeladoTot, total: c.centavos(congeladoTot.cms + congeladoTot.royalty), itens: congelados },
      comissao_fechada: congelados.length > 0,
      pendentes, situacao
    });
  }
  for (const item of ajustesPessoa.itensDeComissao({ ajustes: porPessoa, estado, competenciaAlvo })) {
    saida.push(entradaDoAjustePessoa(item));
  }
  return saida;
}

/** Todos os itens pendentes (ainda não fechados). */
const pendentesDe = apuradas => apuradas.flatMap(p => p.pendentes);

/**
 * Um item de SALDO — o "Ajuste restante do mês anterior": o que `b` ficou
 * devendo no fim de `origem` e abate em `destino`. Pura.
 */
function itemDeRestante(b, { origem, destino, fechamentoId = null, projetado = false }) {
  const valor = c.centavos(b.valor);
  const rotulo = c.rotuloCompetencia(String(origem).trim());
  return {
    chave: `saldo:${fechamentoId ?? `proj:${origem}`}:${chaveBenef(b)}`, tipo_item: 'saldo', pedido_id: null, numero_parcela: null,
    competencia_natural: String(origem).trim(), competencia: destino, data_referencia: null,
    cms: b.tipo === 'cms' ? valor : 0, royalty: b.tipo === 'royalty' ? valor : 0, total: valor,
    motivo: `Ajuste restante do mês anterior (${rotulo}): ${b.beneficiario} terminou ${rotulo} com ${c.reais(valor)}`,
    projetado,
    detalhes: { beneficiarios: [{ tipo: b.tipo, beneficiario: b.beneficiario, percentual: null, valor }], fechamento_id: fechamentoId, origem: String(origem).trim(), projetado }
  };
}

/**
 * Itens de SALDO: beneficiários que terminaram o último fechamento no
 * negativo levam o valor para o próximo.
 */
function saldosAnteriores(estado) {
  const ultimo = estado.ultimo;
  if (!ultimo) return [];
  return (ultimo.resumo || [])
    .filter(b => Number(b.valor) < 0)
    .map(b => itemDeRestante(b, { origem: ultimo.competencia, destino: estado.proxima, fechamentoId: ultimo.id }));
}

/**
 * O restante negativo que um mês AINDA ABERTO deixa para o seguinte, mês a
 * mês, até `competencia` (pedido do dono, 06/10/2026: "se o ajuste deixar o
 * valor negativo, a diferença vai para o próximo mês, abatendo, e aparece
 * como ajuste restante do mês anterior"). Começa no saldo do último
 * fechamento; cada mês aberto soma os seus itens, e quem termina negativo
 * leva a diferença. É uma PROJEÇÃO: o mês de origem ainda pode mudar até
 * fechar — quando fechar, o saldo dele vira o de `saldosAnteriores`. Pura.
 */
function restantesProjetados({ apuradas, estado, competencia }) {
  if (!c.competenciaValida(competencia) || estado.fechados.has(competencia)) return [];
  const pendentes = pendentesDe(apuradas || []);
  const inicio = estado.proxima || pendentes.map(p => String(p.competencia || '')).filter(c.competenciaValida).sort()[0] || null;
  if (!inicio || !(inicio < competencia)) return [];
  let levados = estado.proxima ? saldosAnteriores(estado) : [];
  let mes = inicio;
  for (let voltas = 0; mes < competencia && voltas < 240; voltas++) {
    const doMes = [...pendentes.filter(p => p.competencia === mes), ...levados];
    const seguinte = c.somarMeses(mes, 1);
    levados = [...somarBeneficiarios(doMes.map(i => i.detalhes?.beneficiarios || [])).values()]
      .filter(b => b.valor <= -0.01)
      .map(b => itemDeRestante(b, { origem: mes, destino: seguinte, projetado: true }));
    mes = seguinte;
  }
  return levados;
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

/**
 * `propria` (painel, decisão do dono de 24/09/2026): só os itens que caem NESTA
 * competência. Sem ela — a prévia do fechamento — entra também o que ficou de
 * meses ainda não fechados, porque é isso que o fechamento leva. No painel o
 * que ficou de antes é "a repassar" (repasses.js), e contar lá e aqui seria
 * contar duas vezes. O que ficou NEGATIVO num mês anterior ainda aberto,
 * porém, abate aqui — como o fechamento faria (`restantesProjetados`).
 */
function montarFechamento({ apuradas, estado, competencia, propria = false }) {
  const fechado = estado.fechados.get(competencia) || null;
  const cabe = p => p.competencia && (propria ? p.competencia === competencia : p.competencia <= competencia);
  const itens = fechado
    ? estado.congelados.filter(i => String(i.fechamento_id) === String(fechado.id)).map(itemCongelado)
    : [
      ...pendentesDe(apuradas).filter(cabe),
      ...restantesDoMes({ apuradas, estado, competencia, propria })
    ];
  return resumirItens(itens, { fechado, competencia });
}

/**
 * O "Ajuste restante do mês anterior" que cai em `competencia` (aberta): o
 * saldo do último fechamento, se ela é a próxima a fechar; senão, na visão
 * do próprio mês, o projetado dos meses abertos antes dela. A prévia que
 * junta tudo até o mês (`propria` falso) já soma os negativos dos meses
 * anteriores nos próprios itens e não precisa da projeção. Pura.
 */
function restantesDoMes({ apuradas, estado, competencia, propria = false }) {
  if (estado.proxima === competencia) return saldosAnteriores(estado);
  return propria ? restantesProjetados({ apuradas, estado, competencia }) : [];
}

function resumirItens(itens, { fechado = null, competencia }) {
  const num = v => c.centavos(v);
  const parcelasI = itens.filter(i => i.tipo_item === 'parcela');
  const ajustesI = itens.filter(i => i.tipo_item !== 'parcela');
  const porBenef = [...somarBeneficiarios(itens.map(i => (i.detalhes?.beneficiarios) || [])).values()]
    .sort((a, b) => a.tipo.localeCompare(b.tipo) || String(a.beneficiario).localeCompare(String(b.beneficiario), 'pt-BR'));
  const aPagar = num(porBenef.filter(b => b.valor > 0).reduce((s, b) => s + b.valor, 0));
  const aCompensar = num(porBenef.filter(b => b.valor < 0).reduce((s, b) => s + b.valor, 0));
  // Ajustes à mão: quantos são, quanto saiu da base e quanta comissão isso
  // tirou das parcelas apuradas no mês. Sem isso o card só mostrava a
  // comissão menor, sem dizer que houve ajuste.
  const pctDe = i => (Number(i.pct_cms) || 0) + (Number(i.pct_royalty) || 0);
  const ajustesManuais = {
    quantidade: new Set(itens.flatMap(i => (i.detalhes?.ajustes || []).map(String))).size,
    valor: num(parcelasI.reduce((s, i) => s + Number(i.detalhes?.ajuste_manual || 0), 0)),
    comissao: num(parcelasI.reduce((s, i) => s + (Number(i.detalhes?.ajuste_manual || 0) * pctDe(i)) / 100, 0))
  };
  // Os ajustes por pessoa do mês (ajustesPessoa.js) e o que veio negativo do
  // mês anterior: cada um com a sua linha no resumo (pedido do dono, 06/10/2026).
  const porPessoa = itens.filter(i => i.detalhes?.ajuste_pessoa_id);
  const restantes = itens.filter(i => i.tipo_item === 'saldo');
  const totalDe = l => num(l.reduce((s, i) => s + Number(i.total || 0), 0));
  return {
    competencia,
    fechado: Boolean(fechado),
    fechamento: fechado ? {
      id: fechado.id, fechado_em: fechado.fechado_em, fechado_por: fechado.fechado_por, pagar_ate: c.dia(fechado.pagar_ate),
      pagamento: fechado.pagamento || null, pagamentos: fechado.pagamentos || [],
      pago: c.centavos(fechado.pago), falta_pagar: c.centavos(fechado.falta_pagar)
    } : null,
    parcelas: parcelasI.length,
    base: num(parcelasI.reduce((s, i) => s + Number(i.base || 0), 0)),
    cms: num(parcelasI.reduce((s, i) => s + Number(i.cms || 0), 0)),
    royalty: num(parcelasI.reduce((s, i) => s + Number(i.royalty || 0), 0)),
    comissao: num(parcelasI.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
    ajustes: num(ajustesI.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
    ajustes_manuais: ajustesManuais,
    ajustes_pessoa: {
      quantidade: porPessoa.length, valor: totalDe(porPessoa),
      somam: totalDe(porPessoa.filter(i => Number(i.total) > 0)), descontam: totalDe(porPessoa.filter(i => Number(i.total) < 0))
    },
    restante_anterior: totalDe(restantes),
    liquido:num(itens.reduce((s, i) => s + Number(i.cms || 0) + Number(i.royalty || 0), 0)),
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

/** 'YYYY-MM' → o último dia do mês ('YYYY-MM-DD'). */
function ultimoDiaDoMes(competencia) {
  const [a, m] = String(competencia).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia}-${String(dia).padStart(2, '0')}`;
}

/**
 * Previstas e atrasadas de UMA competência (decisões do dono, 24/09/2026):
 *
 *   - a referência é o fim do mês escolhido — ou hoje, se o mês ainda não
 *     acabou. O mês passado mostra a foto do fim daquele mês: o que foi pago
 *     depois aparece lá como atrasado;
 *   - ATRASADA: venceu até a referência, passou do último dia sem encargos
 *     (vencimento em fim de semana ou feriado vale até o próximo dia útil —
 *     cobranca/vencimento.js) e não estava paga nela. Passa para os meses
 *     seguintes até alguém registrar o pagamento (boleto ou o modal
 *     "Pagamentos"); aí vira apurada no mês em que o cliente pagou;
 *   - PREVISTA: vence no mês e, na referência, não estava paga nem atrasada.
 *
 * "Previsto no mês" = previstas + atrasadas. Só as parcelas controladas: o
 * corte "controlar a partir de" continua valendo. Pura.
 */
function visaoDoMes(apuradas, { competencia, hoje, feriados = [] }) {
  const fim = ultimoDiaDoMes(competencia);
  const referencia = hoje && hoje < fim ? hoje : fim;
  const previstas = [];
  const atrasadas = [];
  for (const p of apuradas || []) {
    if (!p || !p.controlada || !p.vencimento || p.situacao === 'nao_realizada') continue;
    const pagaEm = p.recebimento?.data || null;
    // Boleto pago no banco ainda sem lançamento (a_lancar): pago, sem data certa.
    const paga = pagaEm ? pagaEm <= referencia : p.situacao === 'a_lancar';
    if (paga) continue;
    const dias = vencimentos.diasDeAtraso(p.vencimento, referencia, feriados);
    if (dias > 0) atrasadas.push({ ...p, situacao_mes: 'atrasada', dias_atraso: dias, faixa: faixaDeAtraso(dias) });
    else if (String(p.vencimento).startsWith(competencia)) previstas.push({ ...p, situacao_mes: 'prevista', dias_atraso: 0, faixa: null });
  }
  previstas.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  atrasadas.sort((a, b) => b.dias_atraso - a.dias_atraso);
  return { referencia, previstas, atrasadas };
}

module.exports = {
  FAIXAS, TIPOS_AJUSTE, chaveDe, chaveBenef, faixaDeAtraso, diaEmBrasilia, somarBeneficiarios, totaisDe,
  estadoDosFechamentos, competenciaAlvo, valorRealDaParcela, apurar, pendentesDe, itemDeRestante, saldosAnteriores, restantesProjetados, restantesDoMes,
  itemCongelado, montarFechamento, resumirItens, aging, visoes, soma,
  ultimoDiaDoMes, visaoDoMes
};
