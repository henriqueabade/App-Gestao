/**
 * "Como chegamos a este valor": os detalhes de uma parcela e a visão
 * consolidada de um pedido (fase G). Pedido → NF → parcela → ajustes →
 * recebimento → percentuais → fechamento → pagamento; e, na produção,
 * pedido → item → registro → setor → valor → fechamento → pagamento.
 */
const c = require('./comum');
const comissoes = require('./comissoes');
const producao = require('./producao');
const ajustes = require('./ajustes');
const auditoria = require('./auditoria');
const base = require('./base');

const ROTULO_SITUACAO = {
  prevista: 'Aberta', atrasada: 'Atrasada', apurada: 'Liquidada', fechada: 'Fechada', paga: 'Paga',
  nao_realizada: 'Cancelada', a_lancar: 'A lançar'
};

async function nomesDosUsuarios(api, ids) {
  const unicos = [...new Set(ids.filter(v => v !== null && v !== undefined && v !== '').map(String))];
  const achados = await Promise.all(unicos.map(id => api.get(`/api/usuarios/${id}`).then(u => [id, u?.nome || null]).catch(() => [id, null])));
  return new Map(achados);
}

const quandoCurto = iso => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}` : '—');

/** Os fechamentos (e pagamentos) em que a parcela entrou. Pura. */
function fechamentosDaParcela(p, estado) {
  return p.congelado.itens.map(i => {
    const f = estado.fechados.get(i.competencia);
    return {
      competencia: i.competencia, tipo_item: i.tipo_item, total: c.centavos(i.total), cms: c.centavos(i.cms), royalty: c.centavos(i.royalty),
      motivo: i.detalhes?.motivo || null, pagar_ate: c.dia(f?.pagar_ate), pagamento: f?.pagamento ? { data: c.dia(f.pagamento.data_pagamento), forma: f.pagamento.forma } : null
    };
  });
}

async function parcela({ api, pedidoId, numero, hoje, desde }) {
  const { alvo: p, base: b, estado } = await ajustes.parcela(api, { pedidoId, numero, hoje, desde });
  if (!p) throw c.erro('Parcela não encontrada nas contas do Financeiro.', 404);
  const [nomesCli, eventos, nf] = await Promise.all([
    base.nomesDosClientes(api, [p.cliente_id]),
    auditoria.recentes(api, { limite: 200, pedidoId }).catch(() => []),
    Promise.resolve(b.receber.notas.filter(n => Number(n.pedido_id) === Number(pedidoId) && n.status_fiscal === 'autorizada').sort((x, y) => Number(y.id) - Number(x.id))[0] || null)
  ]);
  const usuarios = await nomesDosUsuarios(api, p.ajustes.map(a => a.criado_por));
  const recebimentos = b.receber.recebimentos.filter(r => Number(r.pedido_id) === Number(pedidoId) && Number(r.numero_parcela) === Number(numero));
  const somaTipo = tipos => c.centavos(p.ajustes.filter(a => a.status === 'ativo' && tipos.includes(a.tipo)).reduce((s, a) => s + a.valor, 0));
  const fechs = fechamentosDaParcela(p, estado);

  // Linha do tempo: NF, parcela, boleto, ajustes, recebimentos, fechamentos, pagamentos e o histórico do módulo.
  const tempo = [];
  if (nf) tempo.push({ data: null, quando: '—', titulo: `NF-e ${nf.serie}/${nf.numero} autorizada`, detalhe: 'Parcelas contadas a partir da emissão' });
  tempo.push({ data: p.vencimento, quando: quandoCurto(p.vencimento), titulo: `Parcela ${p.parcela} vence`, detalhe: `${c.reais(p.valor_original)}${p.boleto ? ` · boleto ${p.boleto.nosso_numero || ''} (${p.boleto.status})` : ''}` });
  for (const a of p.ajustes) {
    tempo.push({ data: a.data_ajuste, quando: quandoCurto(a.data_ajuste), titulo: `${a.rotulo}${a.status !== 'ativo' ? ' (cancelado)' : ''}`, detalhe: `- ${c.reais(a.valor)} · ${a.motivo}${usuarios.get(String(a.criado_por)) ? ` · ${usuarios.get(String(a.criado_por))}` : ''}` });
  }
  for (const r of recebimentos) {
    const d = c.dia(r.data_recebimento);
    tempo.push({ data: d, quando: quandoCurto(d), titulo: r.status === 'confirmado' ? 'Recebimento registrado' : 'Recebimento estornado', detalhe: `${c.reais(r.valor_recebido)} · competência ${c.rotuloCompetencia(String(r.competencia || '').trim())}${r.motivo_estorno ? ` · ${r.motivo_estorno}` : ''}` });
  }
  for (const f of fechs) {
    tempo.push({ data: f.pagar_ate, quando: quandoCurto(f.pagar_ate), titulo: f.tipo_item === 'parcela' ? `Comissão fechada em ${c.rotuloCompetencia(f.competencia)}` : `Ajuste fechado em ${c.rotuloCompetencia(f.competencia)}`, detalhe: `${c.reais(f.total)}${f.motivo ? ` · ${f.motivo}` : ''} · pagar até ${c.impressa(f.pagar_ate)}` });
    if (f.pagamento) tempo.push({ data: f.pagamento.data, quando: quandoCurto(f.pagamento.data), titulo: 'Pagamento efetuado', detalhe: `Competência ${c.rotuloCompetencia(f.competencia)} · ${f.pagamento.forma || ''}` });
  }
  for (const i of p.pendentes) {
    tempo.push({ data: i.data_referencia, quando: quandoCurto(i.data_referencia), titulo: i.tipo_item === 'parcela' ? 'Comissão apurada (a fechar)' : 'Ajuste de comissão (a fechar)', detalhe: `${c.reais(i.total)} · entra em ${c.rotuloCompetencia(i.competencia)}${i.motivo ? ` · ${i.motivo}` : ''}` });
  }
  const doModulo = eventos.filter(e => Number(e.numero_parcela) === Number(numero) && !['ajuste_registrado'].includes(e.tipo));
  for (const e of doModulo) {
    const d = comissoes.diaEmBrasilia(e.criado_em);
    tempo.push({ data: d, quando: quandoCurto(d), titulo: e.rotulo, detalhe: e.descricao });
  }
  tempo.sort((x, y) => String(x.data || '').localeCompare(String(y.data || '')));

  return {
    pedido_id: p.pedido_id, pedido: p.pedido, cliente: nomesCli.get(String(p.cliente_id)) || null,
    nf: p.nf, parcela: p.parcela, numero_parcela: p.numero_parcela,
    situacao: p.situacao, situacao_rotulo: ROTULO_SITUACAO[p.situacao] || p.situacao,
    vencimento: p.vencimento, dias_atraso: p.dias_atraso, recebimento: p.recebimento, boleto: p.boleto,
    valor_original: p.valor_original, abatimento_boleto: p.abatimento_boleto,
    devolucoes: somaTipo(['devolucao']), descontos: somaTipo(['desconto', 'abatimento', 'cancelamento', 'outros']),
    ajustes_total: p.ajustes_total, liquido: p.liquido,
    taxas: p.taxas, sem_regra: p.sem_regra, potencial: p.potencial, comissao_fechada: p.comissao_fechada,
    congelado: { cms: p.congelado.cms, royalty: p.congelado.royalty, total: p.congelado.total },
    pendentes: p.pendentes.map(i => ({ tipo_item: i.tipo_item, competencia: i.competencia, total: i.total, cms: i.cms, royalty: i.royalty, motivo: i.motivo })),
    fechamentos: fechs,
    ajustes: p.ajustes.map(a => ({ id: a.id, data: a.data_ajuste, tipo: a.tipo, rotulo: a.rotulo, motivo: a.motivo, observacao: a.observacao || null, valor: a.valor, status: a.status, no_fechamento: a.no_fechamento, usuario: usuarios.get(String(a.criado_por)) || null, motivo_cancelamento: a.motivo_cancelamento || null })),
    historico: tempo
  };
}

async function pedido({ api, pedidoId, hoje, desde }) {
  const id = Number(pedidoId);
  const pedidoLinha = c.lista(await api.get('/api/pedidos', { query: { id } }).catch(() => [])).find(p => Number(p?.id) === id);
  if (!pedidoLinha) throw c.erro('Pedido não encontrado.', 404);
  const [{ doPedido: parcelas, base: b, estado }, prod, nomesCli, eventos] = await Promise.all([
    ajustes.parcela(api, { pedidoId: id, numero: 0, hoje, desde }),
    producao.doPedido(api, id),
    base.nomesDosClientes(api, [pedidoLinha.cliente_id]),
    auditoria.recentes(api, { limite: 50, pedidoId: id }).catch(() => [])
  ]);
  const notas = b.receber.notas.filter(n => Number(n.pedido_id) === id).sort((x, y) => Number(x.id) - Number(y.id));
  const soma = (l, f) => c.centavos(l.reduce((s, x) => s + Number(f(x) || 0), 0));
  const setoresUsados = prod.setores.filter(s => prod.eventos.some(e => String(e.setor_id) === String(s.id)));

  return {
    pedido: {
      id, numero: pedidoLinha.numero ?? String(id), cliente: nomesCli.get(String(pedidoLinha.cliente_id)) || null,
      situacao: pedidoLinha.situacao, data: c.dia(pedidoLinha.data_aprovacao || pedidoLinha.data_emissao),
      valor: c.centavos(pedidoLinha.valor_final), condicao: [pedidoLinha.prazo, pedidoLinha.forma_pagamento].filter(Boolean).join(' · ') || null,
      observacoes: pedidoLinha.observacoes || null
    },
    itens: prod.itens.map(i => {
      const usados = setoresUsados.length ? i.setores.filter(s => setoresUsados.some(u => String(u.id) === String(s.setor_id))) : [];
      const produzida = usados.length ? Math.min(...usados.map(s => s.finalizada)) : 0;
      return {
        codigo: i.codigo, descricao: i.nome, quantidade: i.quantidade, produzida, saldo: Math.max(0, i.quantidade - produzida),
        por_setor: i.setores.map(s => ({ setor: (prod.setores.find(x => String(x.id) === String(s.setor_id)) || {}).nome, finalizada: s.finalizada, status: s.status })),
        situacao: producao.statusDoItem(i.quantidade, produzida)
      };
    }),
    notas: notas.map(n => ({
      id: n.id, nf: `${n.serie}/${n.numero}`, status: n.status_fiscal, data: c.dia(n.data_emissao), valor: n.valor_total === null || n.valor_total === undefined ? null : c.centavos(n.valor_total),
      parcelas: parcelas.filter(p => p.nf === `${n.serie}/${n.numero}`).length
    })),
    parcelas: parcelas.sort((x, y) => x.numero_parcela - y.numero_parcela).map(p => ({
      pedido_id: p.pedido_id, numero_parcela: p.numero_parcela, parcela: p.parcela, vencimento: p.vencimento, liquido: p.liquido,
      situacao: p.situacao, situacao_rotulo: ROTULO_SITUACAO[p.situacao] || p.situacao, comissao: p.potencial.total,
      // Quem recebe a comissão desta parcela (CMS do dono do cliente, Royalty do desenhista).
      benef_lista: (p.potencial.beneficiarios || []).map(x => ({ tipo: x.tipo, beneficiario: x.beneficiario, valor: x.valor, percentual: x.percentual == null ? null : Number(x.percentual) }))
    })),
    producao: prod.eventos.map(e => ({
      id: e.id, data: e.data_finalizacao, quantidade: Number(e.quantidade), setor: e.setor, status: e.status, estornado: Boolean(e.estornado_em),
      produto: (() => { const it = prod.itens.find(i => String(i.id) === String(e.pedido_item_id)); return it ? [it.codigo, it.nome].filter(Boolean).join(' — ') : `item ${e.pedido_item_id}`; })(),
      produto_codigo: prod.itens.find(i => String(i.id) === String(e.pedido_item_id))?.codigo || null,
      observacao: e.observacao || null
    })),
    comissoes: {
      prevista: soma(parcelas.filter(p => ['prevista', 'atrasada'].includes(p.situacao)), p => p.potencial.total),
      realizada: soma(parcelas.filter(p => ['apurada', 'fechada', 'paga'].includes(p.situacao)), p => p.potencial.total),
      atrasada: soma(parcelas.filter(p => p.situacao === 'atrasada'), p => p.potencial.total),
      fechada: soma(parcelas, p => p.congelado.total),
      paga: soma(parcelas.flatMap(p => p.congelado.itens.filter(i => i.pago)), i => i.total),
      ajustes: soma(parcelas, p => -p.ajustes_total * ((Number(p.taxas.pct_cms) || 0) + (Number(p.taxas.pct_royalty) || 0)) / 100),
      taxas: parcelas[0]?.taxas || null,
      sem_regra: parcelas.some(p => p.sem_regra),
      proxima_competencia: estado.proxima
    },
    historico: eventos.map(e => ({ quando: comissoes.diaEmBrasilia(e.criado_em), titulo: e.rotulo, detalhe: e.descricao }))
  };
}

module.exports = { ROTULO_SITUACAO, fechamentosDaParcela, parcela, pedido, nomesDosUsuarios };
