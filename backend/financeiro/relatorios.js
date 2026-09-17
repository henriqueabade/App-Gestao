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

const TITULOS = {
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

const linhaDeParcela = (p, extra = {}) => ({
  pedido_id: p.pedido_id, pedido: p.pedido, cliente: p.cliente, nf: p.nf, parcela: p.parcela, vencimento: p.vencimento,
  numero_parcela: p.numero_parcela, dias: p.dias_atraso, faixa: p.faixa, liquido: p.liquido,
  cms: p.potencial.cms, royalty: p.potencial.royalty, comissao: p.potencial.total,
  beneficiarios: p.potencial.beneficiarios.map(b => `${b.beneficiario} ${String(b.percentual).replace('.', ',')}%`).join(' · '),
  ...extra
});

const linhaDeItem = i => ({
  pedido_id: i.pedido_id, pedido: i.pedido, cliente: i.cliente, nf: i.nf, parcela: i.parcela, numero_parcela: i.numero_parcela,
  liquidacao: i.data_referencia, data: i.data_referencia, liquido: i.base, cms: i.cms, royalty: i.royalty, comissao: i.total, valor: i.total,
  motivo: i.motivo || (i.tipo_item === 'saldo' ? 'Saldo anterior' : ''), origem: i.tipo_item === 'saldo' ? 'Saldo' : c.rotuloCompetencia(i.competencia_natural),
  tipo: i.tipo_item === 'saldo' ? 'Saldo' : 'Ajuste'
});

async function comissoesDe(api, { hoje, desde, competencia, inicio, fim, chave }) {
  const comp = c.competenciaValida(competencia) ? competencia : c.competenciaDe(hoje);
  const { b, estado, apuradas, resumo } = await fechamentos.dadosComissao(api, { competencia: comp, hoje, desde });
  const crit = criterio({ competencia: comp, inicio, fim });
  const v = comissoes.visoes(apuradas);
  let linhas = [];

  if (chave === 'previsao-comissoes') {
    linhas = v.previstas.filter(p => crit.cabe(p.vencimento)).map(p => linhaDeParcela(p));
  } else if (chave === 'comissoes-atrasadas') {
    // Atraso é de hoje: o filtro só vale quando é por período (vencimento).
    linhas = v.atrasadas.filter(p => !crit.periodo || crit.cabe(p.vencimento)).map(p => linhaDeParcela(p));
    if (!crit.periodo) crit.texto = `Posição em ${c.impressa(hoje)}`;
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
