/**
 * Relatórios do Financeiro completo (fase G). Cada um devolve as linhas no
 * formato das colunas da tela (src/js/modals/financeiro-modais.js,
 * RELATORIOS); os totais são somados lá. Filtro por competência
 * ('YYYY-MM') ou por período (`inicio`/`fim`, 'YYYY-MM-DD').
 */
const c = require('./comum');
const comissoes = require('./comissoes');
const producao = require('./producao');
const fechamentos = require('./fechamentos');
const base = require('./base');
const calendario = require('./calendario');
const repasses = require('./repasses');

const TITULOS = {
  'resumo-comissoes': 'Comissões do mês',
  'previsao-comissoes': 'Previsão de comissões',
  'comissoes-atrasadas': 'Comissões atrasadas',
  'comissoes-apuradas': 'Comissões apuradas',
  'ajustes-anteriores': 'Ajustes de períodos anteriores',
  'comissoes-nao-realizadas': 'Comissões não realizadas',
  'producao-competencia': 'Produção da competência',
  'pagamento-marcenaria': 'Pagamento marcenaria',
  'pagamento-acabamento': 'Pagamento acabamento',
  'pagamento-montagem': 'Pagamento montagem',
  'pagamento-embalagem': 'Pagamento embalagem',
  'producao-por-pedido': 'Produção por pedido'
};

/** Os relatórios de pagamento por processo (o nome do processo, sem acento). */
const PROCESSOS_DO_RELATORIO = {
  'pagamento-marcenaria': 'marcenaria', 'pagamento-acabamento': 'acabamento',
  'pagamento-montagem': 'montagem', 'pagamento-embalagem': 'embalagem'
};

const semAcento = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Critério de data: competência (mês da data) ou período. Puro. */
function criterio({ competencia, inicio, fim }) {
  if (c.dataValida(inicio) || c.dataValida(fim)) {
    const de = c.dataValida(inicio) ? inicio : '0000-01-01';
    const ate = c.dataValida(fim) ? fim : '9999-12-31';
    return { texto: `Período: ${c.impressa(de === '0000-01-01' ? null : de)} a ${c.impressa(ate === '9999-12-31' ? null : ate)}`, cabe: d => Boolean(d) && d >= de && d <= ate, periodo: true };
  }
  return { texto: `Competência: ${c.rotuloCompetencia(competencia)}`, cabe: d => Boolean(d) && String(d).startsWith(competencia), periodo: false };
}

/**
 * Quem recebe, em duas formas: `benef_lista` (estruturada — a tela usa para as
 * etiquetas coloridas e para o filtro por pessoa/tipo) e `beneficiarios`
 * (texto, que é o que vai para o PDF e para a planilha).
 */
const listaDeBeneficiarios = lista => (Array.isArray(lista) ? lista : [])
  .filter(b => b && b.beneficiario)
  .map(b => ({
    tipo: b.tipo, beneficiario: b.beneficiario, valor: c.centavos(b.valor),
    percentual: b.percentual === null || b.percentual === undefined ? null : Number(b.percentual)
  }));

const textoDosBeneficiarios = lista => lista
  .map(b => `${b.beneficiario}${b.percentual === null ? '' : ` ${String(b.percentual).replace('.', ',')}%`}`)
  .join(' · ');

const linhaDeParcela = (p, extra = {}) => {
  const benef = listaDeBeneficiarios(p.potencial.beneficiarios);
  return {
    pedido_id: p.pedido_id, pedido: p.pedido, cliente: p.cliente, nf: p.nf, parcela: p.parcela, vencimento: p.vencimento,
    numero_parcela: p.numero_parcela, dias: p.dias_atraso, faixa: p.faixa, liquido: p.liquido,
    cms: p.potencial.cms, royalty: p.potencial.royalty, comissao: p.potencial.total,
    benef_lista: benef, beneficiarios: textoDosBeneficiarios(benef),
    ...extra
  };
};

const linhaDeItem = i => {
  const benef = listaDeBeneficiarios(i.detalhes?.beneficiarios);
  return {
    pedido_id: i.pedido_id, pedido: i.pedido, cliente: i.cliente, nf: i.nf, parcela: i.parcela, numero_parcela: i.numero_parcela,
    liquidacao: i.data_referencia, data: i.data_referencia, liquido: i.base, cms: i.cms, royalty: i.royalty, comissao: i.total, valor: i.total,
    benef_lista: benef, beneficiarios: textoDosBeneficiarios(benef),
    motivo: i.motivo || (i.tipo_item === 'saldo' ? 'Saldo anterior' : ''), origem: i.tipo_item === 'saldo' ? 'Saldo' : c.rotuloCompetencia(i.competencia_natural),
    tipo: i.tipo_item === 'saldo' ? 'Saldo' : 'Ajuste'
  };
};

async function comissoesDe(api, { hoje, desde, competencia, inicio, fim, chave }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const { b, estado, apuradas, resumo } = await fechamentos.dadosComissao(api, { competencia: comp, hoje, desde });
  const crit = criterio({ competencia: comp, inicio, fim });
  const v = comissoes.visoes(apuradas);
  let linhas = [];

  // Previstas e atrasadas DO MÊS (decisões do dono, 24/09/2026): a atrasada
  // passa para os meses seguintes até ser paga; o mês passado mostra a foto
  // do fim dele (comissoes.visaoDoMes). Por período, a posição de hoje.
  const mes = crit.periodo ? null : comissoes.visaoDoMes(apuradas, { competencia: comp, hoje, feriados: b.receber?.feriados || [] });
  const posicao = mes ? (mes.referencia < hoje ? `foto do fim do mês (${c.impressa(mes.referencia)})` : `posição em ${c.impressa(mes.referencia)}`) : '';
  const comSituacao = p => linhaDeParcela(p, {
    situacao: p.situacao_mes === 'atrasada' || p.situacao === 'atrasada' ? `Atrasada · ${c.plural(p.dias_atraso, 'dia', 'dias')}` : 'Prevista'
  });
  if (chave === 'resumo-comissoes') {
    // O "Ver detalhes" do Resumo de Comissões (decisão do dono, 24/09/2026):
    // TUDO do mês numa tabela, com a Situação dizendo o que é cada linha —
    // previstas, atrasadas porque o cliente não pagou, apuradas (e os
    // ajustes) da competência e o que o cliente já pagou e nós não
    // repassamos no prazo. Por período, a posição de hoje.
    const referencia = mes ? mes.referencia : hoje;
    const proprio = comissoes.montarFechamento({ apuradas, estado, competencia: comp, propria: true });
    const pagarAte = proprio.fechamento?.pagar_ate || calendario.pagarComissaoAte(comp, b.regras.configuracao);
    const situacaoDoProprio = proprio.fechado
      ? (Number(proprio.fechamento?.falta_pagar) > 0 ? `Fechada · pagar até ${c.impressa(pagarAte)}` : 'Paga')
      : `Apurada · pagar até ${c.impressa(pagarAte)}`;
    const previstas = mes ? mes.previstas : v.previstas.filter(p => crit.cabe(p.vencimento));
    const atrasadas = mes ? mes.atrasadas : v.atrasadas.filter(p => crit.cabe(p.vencimento));
    const repasse = repasses.deComissao({ estado, apuradas, configuracao: b.regras.configuracao, referencia });
    const linhasDoRepasse = repasse.flatMap(r => {
      const rotulo = `Atrasada · a repassar · ${c.rotuloCompetencia(r.competencia)} (${r.situacao_texto})`;
      // Não fechada: os itens que o fechamento dela levaria. Fechada: uma
      // linha com o que ainda falta pagar e para quem.
      if (r.itens && r.itens.length) return r.itens.map(i => ({ ...linhaDeItem(i), situacao: rotulo }));
      const benef = listaDeBeneficiarios(r.beneficiarios);
      return [{
        pedido: null, cliente: `${r.rotulo} — ${r.situacao_texto}`, nf: null, parcela: null, data: r.pagar_ate,
        situacao: `${rotulo} · ${c.plural(r.dias_atraso, 'dia', 'dias')}`, liquido: null,
        cms: c.centavos(benef.filter(x => x.tipo === 'cms').reduce((s, x) => s + x.valor, 0)),
        royalty: c.centavos(benef.filter(x => x.tipo === 'royalty').reduce((s, x) => s + x.valor, 0)),
        comissao: r.valor, benef_lista: benef, beneficiarios: textoDosBeneficiarios(benef)
      }];
    });
    const doProprio = proprio.itens.map(i => ({ ...linhaDeItem(i), situacao: i.tipo_item === 'parcela' ? situacaoDoProprio : (i.tipo_item === 'saldo' ? 'Saldo anterior' : 'Ajuste') }));
    linhas = [
      ...previstas.map(p => linhaDeParcela(p, { situacao: 'Prevista', data: p.vencimento })),
      ...atrasadas.map(p => linhaDeParcela(p, { situacao: `Atrasada · cliente não pagou · ${c.plural(p.dias_atraso, 'dia', 'dias')}`, data: p.vencimento })),
      ...doProprio,
      ...linhasDoRepasse
    ];
    const total = l => c.centavos(l.reduce((s, x) => s + (Number(x.comissao) || 0), 0));
    const partes = [
      ['Previstas', total(previstas.map(p => ({ comissao: p.potencial.total })))],
      ['Apuradas', proprio.comissao],
      ['Atrasadas (cliente não pagou)', total(atrasadas.map(p => ({ comissao: p.potencial.total })))],
      ['Atrasadas (a repassar)', repasses.resumir(repasse).valor],
      ['Ajustes', proprio.ajustes]
    ];
    crit.texto += ` · ${partes.map(([rotulo, valor]) => `${rotulo} ${c.reais(valor)}`).join(' · ')}${mes ? ` — ${posicao}` : ''}`;
  } else if (chave === 'previsao-comissoes') {
    // Previsto no mês = previstas + atrasadas (a atrasada ainda não foi paga).
    linhas = mes
      ? [...mes.previstas, ...mes.atrasadas].map(comSituacao)
      : [...v.previstas, ...v.atrasadas].filter(p => crit.cabe(p.vencimento)).map(comSituacao);
    if (mes) crit.texto += ` · previstas e atrasadas — ${posicao}`;
  } else if (chave === 'comissoes-atrasadas') {
    linhas = (mes ? mes.atrasadas : v.atrasadas.filter(p => crit.cabe(p.vencimento))).map(p => linhaDeParcela(p));
    if (mes) crit.texto += ` · ${posicao}`;
  } else if (chave === 'comissoes-apuradas' || chave === 'ajustes-anteriores') {
    const tipoItem = chave === 'comissoes-apuradas' ? (i => i.tipo_item === 'parcela') : (i => i.tipo_item !== 'parcela');
    let itens;
    if (crit.periodo) {
      const congelados = estado.congelados.map(comissoes.itemCongelado);
      itens = [...congelados, ...comissoes.pendentesDe(apuradas)].filter(i => crit.cabe(i.data_referencia));
    } else {
      itens = resumo.itens;
      crit.texto += resumo.fechado ? ' (fechada)' : ' (em aberto — prévia)';
    }
    linhas = itens.filter(tipoItem).map(linhaDeItem);
  } else if (chave === 'comissoes-nao-realizadas') {
    for (const p of apuradas) {
      for (const a of p.ajustes.filter(x => x.status === 'ativo' && crit.cabe(x.data_ajuste))) {
        const perdida = c.centavos(Number(a.valor) * ((Number(p.taxas.pct_cms) || 0) + (Number(p.taxas.pct_royalty) || 0)) / 100);
        linhas.push({ pedido_id: p.pedido_id, pedido: p.pedido, cliente: p.cliente, nf: p.nf, parcela: p.parcela, motivo: `${a.rotulo}: ${a.motivo}`, data: a.data_ajuste, liquido: a.valor, comissao: perdida });
      }
      if (p.situacao === 'nao_realizada' && crit.cabe(p.vencimento)) {
        linhas.push({ pedido_id: p.pedido_id, pedido: p.pedido, cliente: p.cliente, nf: p.nf, parcela: p.parcela, motivo: 'Parcela cancelada', data: p.vencimento, liquido: p.liquido, comissao: p.potencial.total });
      }
    }
    linhas.sort((a, b2) => String(a.data).localeCompare(String(b2.data)));
  }

  const nomes = await base.nomesDosClientes(api, linhas.filter(l => !l.cliente).map(l => {
    const p = b.receber.pedidos.find(x => String(x.id) === String(l.pedido_id));
    return p?.cliente_id;
  }));
  const clienteDe = l => l.cliente || nomes.get(String(b.receber.pedidos.find(x => String(x.id) === String(l.pedido_id))?.cliente_id)) || null;
  return { filtro: crit.texto, linhas: linhas.map(l => ({ ...l, cliente: clienteDe(l) })) };
}

async function producaoDe(api, { hoje, competencia, inicio, fim, chave }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const p = await producao.lerBase(api);
  const crit = criterio({ competencia: comp, inicio, fim });
  let linhas;
  if (crit.periodo) {
    const fechadas = [...p.estado.fechados.values()].flatMap(f => producao.congeladas(p.estado, f.id));
    linhas = [...fechadas, ...p.pend].filter(l => l.tipo_item === 'producao' && crit.cabe(l.data));
  } else {
    const r = producao.montarCompetencia({ pend: p.pend, estado: p.estado, competencia: comp });
    linhas = r.linhas;
    crit.texto += r.fechado ? ' (fechada)' : ' (em aberto — prévia)';
  }
  const nomes = await base.nomesDosClientes(api, linhas.map(l => p.pedidosPor.get(String(l.pedido_id))?.cliente_id));
  const comCliente = linhas.map(l => ({
    ...l, cliente: nomes.get(String(p.pedidosPor.get(String(l.pedido_id))?.cliente_id)) || null,
    unitario: l.valor_unitario, status: l.status_item || (l.tipo_item === 'saldo' ? 'Saldo' : ''), produtoCompleto: l.produto
  }));
  if (PROCESSOS_DO_RELATORIO[chave]) {
    const alvo = PROCESSOS_DO_RELATORIO[chave];
    return { filtro: crit.texto, linhas: comCliente.filter(l => semAcento(l.setor) === alvo) };
  }
  if (chave === 'producao-por-pedido') {
    const porPedido = new Map();
    for (const l of comCliente.filter(x => x.pedido_id)) {
      const g = porPedido.get(String(l.pedido_id)) || { pedido_id: l.pedido_id, pedido: l.pedido, cliente: l.cliente, pecas: 0, marcenaria: 0, acabamento: 0, montagem: 0, embalagem: 0, outros: 0, total: 0 };
      const setor = semAcento(l.setor);
      const campo = Object.values(PROCESSOS_DO_RELATORIO).includes(setor) ? setor : 'outros';
      g.pecas += Number(l.quantidade) || 0;
      g[campo] = c.centavos(g[campo] + Number(l.total || 0));
      g.total = c.centavos(g.total + Number(l.total || 0));
      porPedido.set(String(l.pedido_id), g);
    }
    return { filtro: crit.texto, linhas: [...porPedido.values()].sort((a, b) => String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true })) };
  }
  return { filtro: crit.texto, linhas: comCliente };
}

async function gerar({ api, chave, competencia, inicio, fim, hoje, desde }) {
  if (!TITULOS[chave]) throw c.erro('Relatório desconhecido.', 404);
  const r = chave.startsWith('producao') || chave.startsWith('pagamento')
    ? await producaoDe(api, { hoje, competencia, inicio, fim, chave })
    : await comissoesDe(api, { hoje, desde, competencia, inicio, fim, chave });
  return { chave, titulo: TITULOS[chave], ...r };
}

module.exports = { TITULOS, criterio, gerar };
