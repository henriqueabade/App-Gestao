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
 */
const c = require('../../financeiro/comum');
const b = require('../base');

const TIPOS = {
  recebimento: { rotulo: 'Recebimento', sinal: 1 },
  titulo_pagamento: { rotulo: 'Pagamento de conta', sinal: -1 },
  financeiro_pagamento: { rotulo: 'Comissão/produção', sinal: -1 },
  reembolso: { rotulo: 'Reembolso', sinal: -1 }
};
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
    estornado: Boolean(estornado),
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
 * alguma fonte, ela só não aparece.
 */
async function carregar(api, { de = null, ate = null, incluir = [] } = {}) {
  const extras = new Set(incluir);
  const quer = (tipo, id, ...datas) => extras.has(chaveDe(tipo, id)) || datas.some(d => naJanela(c.dia(d), de, ate));
  const [recebimentos, reembolsos, finPags, fechamentos, titPags, titulosLidos, parcelasLidas] = await Promise.all([
    lerSePuder(api, 'recebimentos'), lerSePuder(api, 'reembolsos'),
    lerSePuder(api, 'financeiro_pagamentos'), lerSePuder(api, 'financeiro_fechamentos'),
    b.lerOpcional(api, 'titulo_pagar_pagamentos').then(x => x || []), b.lerOpcional(api, 'titulos_pagar').then(x => x || []),
    b.lerOpcional(api, 'titulo_pagar_parcelas').then(x => x || [])
  ]);
  const recs = recebimentos.filter(r => r && quer('recebimento', r.id, r.data_recebimento, r.data_credito));
  const reems = reembolsos.filter(r => r && r.data_pagamento && quer('reembolso', r.id, r.data_pagamento));
  const fins = finPags.filter(p => p && quer('financeiro_pagamento', p.id, p.data_pagamento));
  const tits = titPags.filter(p => p && quer('titulo_pagamento', p.id, p.data_pagamento));

  const pedidos = await porId(api, 'pedidos', [...recs, ...reems].map(r => r.pedido_id));
  const clientes = await porId(api, 'clientes', [...pedidos.values()].map(p => p.cliente_id));
  const titulos = new Map(titulosLidos.map(t => [String(t.id), t]));
  const contatos = await porId(api, 'contatos', tits.map(p => titulos.get(String(p.titulo_id))?.contato_id));
  const parcelas = new Map(parcelasLidas.map(p => [String(p.id), p]));
  const fechs = new Map(fechamentos.map(f => [String(f.id), f]));
  return [
    ...recs.map(r => deRecebimento(r, { pedidos, clientes })),
    ...tits.map(p => deTituloPagamento(p, { titulos, contatos, parcelas })),
    ...fins.map(p => deFinanceiroPagamento(p, { fechamentos: fechs })),
    ...reems.map(r => deReembolso(r, { pedidos, clientes }))
  ].filter(l => l.data).sort((x, y) => x.data.localeCompare(y.data) || x.chave.localeCompare(y.chave));
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
  TIPOS, FORA_DO_BANCO, DATA_INCERTA, chaveDe,
  deRecebimento, deTituloPagamento, deFinanceiroPagamento, deReembolso, carregar, restantes
};
