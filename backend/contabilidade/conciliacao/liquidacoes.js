/**
 * O que o app registrou como dinheiro que ENTROU ou SAIU — as "liquidações"
 * que a conciliação (etapa 5) casa com os lançamentos do extrato:
 *
 *   recebimento           recebimento confirmado de parcela de pedido   entrada
 *   titulo_pagamento      pagamento de conta a pagar (etapa 3)          saída
 *   financeiro_pagamento  pagamento de comissão/produção (Financeiro)   saída
 *   reembolso             reembolso pago ao cliente (devolução)         saída
 *
 * Tudo vira a mesma forma (`chave`, data, valor com sinal, quem, forma…).
 * Nada daqui é gravado: as tabelas continuam dos seus módulos; o vínculo com
 * o banco fica em `conciliacao_vinculos` (plano, seção D).
 *
 * - Dinheiro não passa pelo banco: fica fora da conciliação.
 * - Cartão: o dinheiro chega (repasse da operadora) ou sai (fatura) em outro
 *   dia e às vezes com desconto de taxa — entra como candidato, mas não é
 *   cobrado como "sem lançamento no extrato".
 *
 * Fase A (02/10/2026, o caso da NFS-e do Bruno): com `obrigacoes`, entram
 * também as OBRIGAÇÕES — o que ainda não foi pago no app, mas pode ser o
 * débito do banco:
 *
 *   parcela               parcela de conta a pagar em aberto             saída
 *   documento             NF-e/NFS-e/recibo registrado sem conta a pagar saída
 *
 * Elas não viram vínculo: conciliar com uma delas PAGA a parcela (ou lança a
 * conta do documento e a paga) com o dia e o valor do banco, e o vínculo é
 * com esse pagamento (conciliacao.js).
 *
 * Fase H (02/10/2026, o DDA do BB): mais uma obrigação —
 *
 *   dda                   boleto do DDA agendado ou liquidado, sem conta  saída
 *
 * e a parcela em aberto ligada a um boleto que o DDA diz LIQUIDADO leva essa
 * prova (`dda_liquidado`; o motor aceita o automático com ela). O boleto "a
 * pagar" não entra: estar no DDA não prova que a dívida é devida.
 */
const c = require('../../financeiro/comum');
const b = require('../base');

const TIPOS = {
  recebimento: { rotulo: 'Recebimento', sinal: 1 },
  titulo_pagamento: { rotulo: 'Pagamento de conta', sinal: -1 },
  financeiro_pagamento: { rotulo: 'Comissão/produção', sinal: -1 },
  reembolso: { rotulo: 'Reembolso', sinal: -1 },
  parcela: { rotulo: 'Conta a pagar em aberto', sinal: -1, obrigacao: true },
  documento: { rotulo: 'Nota sem conta a pagar', sinal: -1, obrigacao: true },
  dda: { rotulo: 'Boleto do DDA sem conta', sinal: -1, obrigacao: true },
  // Fase C: o que o extrato tem de mostrar para o Rende Fácil e o CDB (o PDF mensal do BB).
  aplicacao: { rotulo: 'Aplicação financeira', sinal: -1 },
  resgate: { rotulo: 'Resgate de aplicação', sinal: 1 },
  // Fase F: o que a empresa pagou em nome de outra (a Artdeco) e o que ela devolveu.
  terceiro_pago: { rotulo: 'Pago em nome de terceiro', sinal: -1 },
  terceiro_devolvido: { rotulo: 'Devolução de terceiro', sinal: 1 },
  // Fase G: o pagamento da fatura do cartão de crédito (o XLSX importado).
  fatura_cartao: { rotulo: 'Fatura do cartão', sinal: -1 }
};
const PRODUTOS_APLICACAO = { rende_facil: 'BB Rende Fácil', cdb: 'BB CDB DI' };
/** Até quantos dias antes ou depois do vencimento (ou da emissão) a obrigação pode ter sido paga. */
const JANELA_OBRIGACAO = 30;
const FORA_DO_BANCO = new Set(['Dinheiro']);
const DATA_INCERTA = new Set(['Cartão', 'Cartão de crédito']);
const TIPOS_FECHAMENTO = { comissao: 'Comissões', producao: 'Produção' };

const chaveDe = (tipo, id) => `${tipo}:${id}`;
const docDe = x => b.digitos(x?.cnpj || x?.cpf || x?.cpf_cnpj || x?.documento) || null;

/**
 * `categoria` e `contato_id` (conta a pagar) e `subtipo` (comissao/producao)
 * servem à classificação (etapa 6).
 */
function base(tipo, id, {
  data, dataCredito = null, valor, forma, rotulo, detalhe = null, nome = null, documento = null, referencia = null, estornado = false,
  categoria = null, contatoId = null, subtipo = null
}) {
  const abs = c.centavos(Math.abs(Number(valor) || 0));
  return {
    chave: chaveDe(tipo, id), tipo, tipo_rotulo: TIPOS[tipo].rotulo, id: Number(id),
    data: c.dia(data), data_credito: c.dia(dataCredito), competencia: String(c.dia(data) || '').slice(0, 7),
    valor: c.centavos(abs * TIPOS[tipo].sinal), valor_abs: abs, forma: forma || null,
    rotulo, detalhe, nome, documento, referencia: referencia ? String(referencia) : null,
    estornado: Boolean(estornado), obrigacao: Boolean(TIPOS[tipo].obrigacao),
    no_banco: !FORA_DO_BANCO.has(forma), data_incerta: DATA_INCERTA.has(forma),
    categoria: categoria || null, contato_id: contatoId === null || contatoId === undefined ? null : Number(contatoId), subtipo: subtipo || null
  };
}

// ------------------------------------------------------------ cada fonte (puras)

function deRecebimento(r, { pedidos = new Map(), clientes = new Map() } = {}) {
  const pedido = pedidos.get(String(r.pedido_id)) || null;
  const cliente = pedido ? clientes.get(String(pedido.cliente_id)) || null : null;
  const numero = pedido?.numero ?? r.pedido_id;
  return base('recebimento', r.id, {
    data: r.data_recebimento, dataCredito: r.data_credito, valor: r.valor_recebido,
    forma: r.forma || (r.origem === 'boleto' ? 'Boleto' : null),
    rotulo: `Pedido ${numero} · parcela ${r.numero_parcela}`,
    detalhe: r.origem === 'boleto' ? 'boleto pago' : (r.origem === 'quitado_por_fora' ? 'quitado por fora' : 'registrado à mão'),
    nome: c.nomeDoCliente(cliente), documento: docDe(cliente), referencia: r.boleto_id ?? null,
    estornado: r.status !== 'confirmado'
  });
}

function deTituloPagamento(p, { titulos = new Map(), contatos = new Map(), parcelas = new Map() } = {}) {
  const t = titulos.get(String(p.titulo_id)) || null;
  const contato = t?.contato_id !== null && t?.contato_id !== undefined ? contatos.get(String(t.contato_id)) || null : null;
  const parcela = parcelas.get(String(p.parcela_id)) || null;
  const de = parcela && t ? [...parcelas.values()].filter(x => String(x.titulo_id) === String(t.id)).length : null;
  return base('titulo_pagamento', p.id, {
    data: p.data_pagamento, valor: p.valor_pago, forma: p.forma,
    rotulo: t ? `${t.descricao}${de > 1 ? ` · parcela ${parcela.numero}/${de}` : ''}` : `Pagamento ${p.id}`,
    detalhe: t?.categoria || null, nome: contato?.nome || null, documento: docDe(contato),
    referencia: t?.numero_documento || null, estornado: Boolean(p.estornado_em) || t?.status === 'cancelado',
    categoria: t?.categoria || null, contatoId: t?.contato_id ?? null
  });
}

function deFinanceiroPagamento(p, { fechamentos = new Map() } = {}) {
  const f = fechamentos.get(String(p.fechamento_id)) || null;
  const tipo = TIPOS_FECHAMENTO[p.tipo || f?.tipo] || 'Fechamento';
  const comp = p.competencia || f?.competencia;
  return base('financeiro_pagamento', p.id, {
    data: p.data_pagamento, valor: p.valor, forma: p.forma,
    rotulo: `${tipo} de ${c.rotuloCompetencia(comp)}${p.beneficiario ? ` — ${p.beneficiario}` : ''}`,
    detalhe: p.tipo_comissao ? String(p.tipo_comissao).toUpperCase() : null, nome: p.beneficiario || null,
    subtipo: p.tipo || f?.tipo || null
  });
}

function deReembolso(r, { pedidos = new Map(), clientes = new Map() } = {}) {
  const pedido = pedidos.get(String(r.pedido_id)) || null;
  const cliente = pedido ? clientes.get(String(pedido.cliente_id)) || null : null;
  return base('reembolso', r.id, {
    data: r.data_pagamento, valor: r.valor, forma: r.forma,
    rotulo: `Reembolso do pedido ${pedido?.numero ?? r.pedido_id}`, detalhe: 'devolução',
    nome: c.nomeDoCliente(cliente), documento: docDe(cliente), estornado: r.status !== 'pago'
  });
}

/**
 * A parcela em aberto (obrigação). `titulo` e `contato` crus; `de` = quantas
 * parcelas a conta tem; `boleto` = o boleto do DDA ligado a ela (fase H): o
 * liquidado é a prova do pagamento, e o CNPJ do beneficiário vale quando a
 * conta não tem fornecedor.
 */
function deParcela(p, { titulo, contato = null, de = 1, boleto = null }) {
  const liquidado = Boolean(boleto) && Number(boleto.estado_bb) === 3;
  return {
    ...base('parcela', p.id, {
      data: p.vencimento, valor: p.valor, forma: null,
      rotulo: `${titulo.descricao}${de > 1 ? ` · parcela ${p.numero}/${de}` : ''}`,
      detalhe: `vence em ${c.impressa(c.dia(p.vencimento))}${liquidado ? ' · liquidado no DDA' : ''}`, nome: contato?.nome || boleto?.beneficiario_nome || null,
      documento: docDe(contato) || b.digitos(boleto?.beneficiario_documento) || null,
      referencia: titulo.numero_documento || null, categoria: titulo.categoria || null, contatoId: titulo.contato_id ?? null
    }),
    titulo_id: Number(titulo.id), dda_liquidado: liquidado
  };
}

/**
 * O boleto do DDA sem conta, agendado ou liquidado (obrigação, fase H):
 * conciliar com ele lança a conta do boleto e a paga com o banco. Pura.
 */
/** Fase C: um lançamento esperado de uma aplicação (contabil_aplicacao_lancamentos). Pura. */
function deAplicacao(l, { aplicacao = null } = {}) {
  const produto = PRODUTOS_APLICACAO[aplicacao?.produto] || 'Aplicação';
  return base(l.sentido === 'aplicacao' ? 'aplicacao' : 'resgate', l.id, {
    data: l.data, valor: l.valor, forma: 'Aplicação', rotulo: l.descricao || produto,
    detalhe: { liquido: 'soma do dia no PDF', capital: 'capital do resgate', rendimento: 'rendimento líquido do resgate' }[l.parte] || null, nome: produto
  });
}

/** Fase F: um item de terceiro (contabil_terceiros_itens) — o lado pago (débito) ou o devolvido (crédito). Pura. */
function deTerceiro(item, tipo) {
  return base(tipo, item.id, {
    data: item.data, valor: item.valor, forma: 'Reembolso de terceiro', rotulo: item.descricao || `Pago em nome de ${item.terceiro_nome}`,
    detalhe: tipo === 'terceiro_pago' ? `a receber de ${item.terceiro_nome}` : `${item.terceiro_nome} devolve`,
    nome: item.terceiro_nome || null, documento: b.digitos(item.terceiro_documento) || null, subtipo: 'terceiro'
  });
}

/** Fase G: a fatura do cartão (contabil_cartao_faturas) — o valor total, no vencimento. Pura. */
function deFatura(f) {
  return base('fatura_cartao', f.id, {
    data: f.vencimento, valor: f.valor_total, forma: 'Fatura do cartão',
    rotulo: `Fatura do cartão${f.cartao_final ? ` final ${f.cartao_final}` : ''} · venc. ${c.impressa(c.dia(f.vencimento))}`,
    detalhe: `${c.reais(f.valor_total)} (mínimo ${c.reais(f.valor_minimo || 0)})`, nome: 'Banco do Brasil (cartão de crédito)', subtipo: 'cartao'
  });
}

function deBoletoDda(bol) {
  const liquidado = Number(bol.estado_bb) === 3;
  return {
    ...base('dda', bol.id, {
      data: bol.vencimento, valor: bol.valor, forma: 'Boleto',
      rotulo: `Boleto de ${bol.beneficiario_nome || 'beneficiário'}`,
      detalhe: `vence em ${c.impressa(c.dia(bol.vencimento))} · ${liquidado ? 'liquidado' : 'agendado'} no DDA`,
      nome: bol.beneficiario_nome || null, documento: b.digitos(bol.beneficiario_documento) || null, referencia: bol.seu_numero || null
    }),
    dda_boleto_id: Number(bol.id), dda_liquidado: liquidado
  };
}

/**
 * O valor que sai do banco por um documento: o total menos as retenções (o
 * ISS retido fica para a guia da prefeitura). Pura.
 */
function valorAPagar(d) {
  const total = c.centavos(d.valor_total);
  const retido = d.valor_retencoes !== null && d.valor_retencoes !== undefined && d.valor_retencoes !== ''
    ? c.centavos(d.valor_retencoes)
    : ((d.iss_retido === true || d.iss_retido === 'true') ? c.centavos(d.valor_iss) : 0);
  return c.centavos(Math.max(0, total - (retido > 0 && retido < total ? retido : 0)));
}

const ROTULO_DOC = { nfe: 'NF-e', nfse: 'NFS-e' };

/** O documento sem conta (obrigação). `contato` cru ou null. */
function deDocumento(d, { contato = null } = {}) {
  const valor = valorAPagar(d);
  const rotulo = `${ROTULO_DOC[d.tipo] || 'Documento'} ${d.numero || ''}`.trim();
  return {
    ...base('documento', d.id, {
      data: d.data_emissao, valor, forma: null, rotulo,
      detalhe: `emitida em ${c.impressa(c.dia(d.data_emissao))}${valor !== c.centavos(d.valor_total) ? ` · ${c.reais(d.valor_total)} menos as retenções` : ''}`,
      nome: contato?.nome || d.emitente_nome || null, documento: b.digitos(d.emitente_documento) || docDe(contato),
      contatoId: d.contato_id ?? null
    }),
    documento_recebido_id: Number(d.id), competencia_documento: d.competencia || String(c.dia(d.data_emissao) || '').slice(0, 7)
  };
}

/** O documento está sem conta e sem pagamento ligado (como em documentosRecebidos.linhaDoDocumento)? Pura. */
function documentoSemConta(d, contasPorDocumento) {
  if (!d || d.excluido_em || d.financeiro_pagamento_id || d.sem_pagamento === true || d.sem_pagamento === 'true') return false;
  if (!(c.centavos(d.valor_total) > 0)) return false;
  return !(contasPorDocumento.get(String(d.id)) || []).some(t => t.status !== 'cancelado');
}

// ------------------------------------------------------------ leitura

const lerSePuder = (api, tabela) => api.get(`/api/${tabela}`).then(c.lista).catch(() => []);
// Sem janela nenhuma (só `incluir`), nada entra pela data.
const naJanela = (data, de, ate) => Boolean(data) && Boolean(de || ate) && (!de || data >= de) && (!ate || data <= ate);

async function porId(api, tabela, ids) {
  const unicos = [...new Set([...ids].map(String).filter(x => x && x !== 'null' && x !== 'undefined'))];
  const linhas = await Promise.all(unicos.map(id => api.get(`/api/${tabela}/${id}`).catch(() => null)));
  return new Map(linhas.filter(x => x && !x.error && x.id !== undefined).map(x => [String(x.id), x]));
}

/**
 * As liquidações cuja data (ou a de crédito) cai em [de, ate], mais as de
 * `incluir` (chaves já ligadas a lançamentos, em qualquer data). Sem o SQL de
 * alguma fonte, ela só não aparece. Com `obrigacoes`, também as parcelas em
 * aberto e os documentos sem conta com vencimento/emissão até 30 dias fora
 * de [de, ate] (fase A).
 */
async function carregar(api, { de = null, ate = null, incluir = [], obrigacoes = false } = {}) {
  const extras = new Set(incluir);
  const quer = (tipo, id, ...datas) => extras.has(chaveDe(tipo, id)) || datas.some(d => naJanela(c.dia(d), de, ate));
  const [recebimentos, reembolsos, finPags, fechamentos, titPags, titulosLidos, parcelasLidas, docsLidos, boletosLidos, aplicacoesLidas, aplicLancsLidos, terceirosLidos, faturasLidas, comprasCartao, notasFechamento] = await Promise.all([
    lerSePuder(api, 'recebimentos'), lerSePuder(api, 'reembolsos'),
    lerSePuder(api, 'financeiro_pagamentos'), lerSePuder(api, 'financeiro_fechamentos'),
    b.lerOpcional(api, 'titulo_pagar_pagamentos').then(x => x || []), b.lerOpcional(api, 'titulos_pagar').then(x => x || []),
    b.lerOpcional(api, 'titulo_pagar_parcelas').then(x => x || []),
    obrigacoes || [...extras].some(k => k.startsWith('documento:')) ? b.lerOpcional(api, 'documentos_recebidos').then(x => x || []) : Promise.resolve([]),
    // Fase H: os boletos do DDA (sem o SQL dela, nenhum).
    obrigacoes || [...extras].some(k => k.startsWith('dda:')) ? b.lerOpcional(api, 'contabil_dda_boletos').then(x => x || []).catch(() => []) : Promise.resolve([]),
    // Fase C: as aplicações (sem o SQL dela, nenhuma).
    b.lerOpcional(api, 'contabil_aplicacoes').then(x => x || []).catch(() => []),
    b.lerOpcional(api, 'contabil_aplicacao_lancamentos').then(x => x || []).catch(() => []),
    // Fase F: os itens de terceiros (sem o SQL dela, nenhum).
    b.lerOpcional(api, 'contabil_terceiros_itens').then(x => x || []).catch(() => []),
    // Fase G: as faturas do cartão e as compras (a nota de compra no cartão não é obrigação no extrato).
    b.lerOpcional(api, 'contabil_cartao_faturas').then(x => x || []).catch(() => []),
    obrigacoes || [...extras].some(k => k.startsWith('documento:')) ? b.lerOpcional(api, 'contabil_cartao_compras').then(x => x || []).catch(() => []) : Promise.resolve([]),
    // Fase E: a nota de quem recebe, ligada ao fechamento, é paga pelo Financeiro (não é obrigação no extrato).
    obrigacoes || [...extras].some(k => k.startsWith('documento:')) ? b.lerOpcional(api, 'contabil_notas_fechamento').then(x => x || []).catch(() => []) : Promise.resolve([])
  ]);
  // O pagamento cai perto do vencimento (fim de semana, feriado: dias depois).
  const faturas = faturasLidas.filter(f => f && !f.substituida_em && quer('fatura_cartao', f.id, f.vencimento, somarDias(c.dia(f.vencimento), 6), somarDias(c.dia(f.vencimento), -10)));
  const foraDasObrigacoes = new Set(comprasCartao.filter(x => x && x.documento_id !== null && x.documento_id !== undefined).map(x => String(x.documento_id)));
  for (const n of notasFechamento) if (n && !n.desfeito_em) foraDasObrigacoes.add(String(n.documento_id));
  const terceiros = terceirosLidos.filter(i => i && i.situacao !== 'cancelado');
  // O lado pago pela data; a devolução pode vir semanas depois: entra todo item até o fim da janela.
  const terceirosPagos = terceiros.filter(i => quer('terceiro_pago', i.id, i.data));
  const terceirosDevolvidos = terceiros.filter(i => quer('terceiro_devolvido', i.id, i.data) || (ate && c.dia(i.data) && c.dia(i.data) <= ate));
  const aplicacoesValendo = new Map(aplicacoesLidas.filter(a => a && !a.substituida_em).map(a => [String(a.id), a]));
  const aplicLancs = aplicLancsLidos.filter(l => l && aplicacoesValendo.has(String(l.aplicacao_id))
    && quer(l.sentido === 'aplicacao' ? 'aplicacao' : 'resgate', l.id, l.data));
  const recs = recebimentos.filter(r => r && quer('recebimento', r.id, r.data_recebimento, r.data_credito));
  const reems = reembolsos.filter(r => r && r.data_pagamento && quer('reembolso', r.id, r.data_pagamento));
  const fins = finPags.filter(p => p && quer('financeiro_pagamento', p.id, p.data_pagamento));
  const tits = titPags.filter(p => p && quer('titulo_pagamento', p.id, p.data_pagamento));

  // As obrigações: só com vencimento/emissão perto do período (ou pedidas pela chave).
  const largo = {
    de: de ? somarDias(de, -JANELA_OBRIGACAO) : null, ate: ate ? somarDias(ate, JANELA_OBRIGACAO) : null
  };
  const querObrigacao = (tipo, id, data) => extras.has(chaveDe(tipo, id)) || (obrigacoes && naJanela(c.dia(data), largo.de, largo.ate));
  const titulos = new Map(titulosLidos.map(t => [String(t.id), t]));
  const pagas = new Set(titPags.filter(p => p && !p.estornado_em).map(p => String(p.parcela_id)));
  const abertas = parcelasLidas.filter(p => p && !pagas.has(String(p.id)) && titulos.get(String(p.titulo_id))?.status !== 'cancelado'
    && titulos.has(String(p.titulo_id)) && querObrigacao('parcela', p.id, p.vencimento));
  const contasPorDocumento = new Map();
  for (const t of titulosLidos) {
    if (t?.documento_recebido_id === null || t?.documento_recebido_id === undefined) continue;
    const k = String(t.documento_recebido_id);
    contasPorDocumento.set(k, [...(contasPorDocumento.get(k) || []), t]);
  }
  const docs = docsLidos.filter(d => documentoSemConta(d, contasPorDocumento) && !foraDasObrigacoes.has(String(d.id)) && querObrigacao('documento', d.id, d.data_emissao));
  // Fase H: o boleto ligado a cada parcela e os agendados/liquidados ainda sem conta.
  const boletoDaParcela = new Map(boletosLidos.filter(x => x && x.situacao === 'vinculado' && x.parcela_id).map(x => [String(x.parcela_id), x]));
  const boletos = boletosLidos.filter(x => x && x.situacao === 'novo' && [2, 3].includes(Number(x.estado_bb)) && querObrigacao('dda', x.id, x.vencimento));

  const pedidos = await porId(api, 'pedidos', [...recs, ...reems].map(r => r.pedido_id));
  const clientes = await porId(api, 'clientes', [...pedidos.values()].map(p => p.cliente_id));
  const contatos = await porId(api, 'contatos', [
    ...tits.map(p => titulos.get(String(p.titulo_id))?.contato_id),
    ...abertas.map(p => titulos.get(String(p.titulo_id))?.contato_id),
    ...docs.map(d => d.contato_id)
  ]);
  const parcelas = new Map(parcelasLidas.map(p => [String(p.id), p]));
  const fechs = new Map(fechamentos.map(f => [String(f.id), f]));
  const quantas = id => parcelasLidas.filter(x => String(x.titulo_id) === String(id)).length;
  const contatoDe = id => (id === null || id === undefined ? null : contatos.get(String(id)) || null);
  return [
    ...recs.map(r => deRecebimento(r, { pedidos, clientes })),
    ...tits.map(p => deTituloPagamento(p, { titulos, contatos, parcelas })),
    ...fins.map(p => deFinanceiroPagamento(p, { fechamentos: fechs })),
    ...reems.map(r => deReembolso(r, { pedidos, clientes })),
    ...abertas.map(p => {
      const t = titulos.get(String(p.titulo_id));
      return deParcela(p, { titulo: t, contato: contatoDe(t.contato_id), de: quantas(t.id), boleto: boletoDaParcela.get(String(p.id)) || null });
    }),
    ...docs.map(d => deDocumento(d, { contato: contatoDe(d.contato_id) })),
    ...boletos.map(deBoletoDda),
    ...aplicLancs.map(l => deAplicacao(l, { aplicacao: aplicacoesValendo.get(String(l.aplicacao_id)) })),
    ...terceirosPagos.map(i => deTerceiro(i, 'terceiro_pago')),
    ...terceirosDevolvidos.map(i => deTerceiro(i, 'terceiro_devolvido')),
    ...faturas.map(deFatura)
  ].filter(l => l.data).sort((x, y) => x.data.localeCompare(y.data) || x.chave.localeCompare(y.chave));
}

/** A data + n dias ('YYYY-MM-DD'). */
function somarDias(iso, n) {
  const [a, m, d] = String(iso).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Quanto de cada liquidação ainda não está ligado a um lançamento (vínculos valendo). Pura. */
function restantes(liquidacoes, vinculos) {
  const usado = new Map();
  for (const v of c.lista(vinculos)) {
    if (!v || v.desfeito_em) continue;
    const k = chaveDe(v.alvo_tipo, v.alvo_id);
    usado.set(k, c.centavos((usado.get(k) || 0) + Number(v.valor || 0)));
  }
  return new Map(c.lista(liquidacoes).map(l => [l.chave, c.centavos(Math.max(0, l.valor_abs - (usado.get(l.chave) || 0)))]));
}

module.exports = {
  TIPOS, FORA_DO_BANCO, DATA_INCERTA, JANELA_OBRIGACAO, chaveDe,
  deRecebimento, deTituloPagamento, deFinanceiroPagamento, deReembolso, deParcela, deDocumento, deBoletoDda, deAplicacao, deTerceiro, deFatura, valorAPagar, documentoSemConta,
  carregar, restantes
};
