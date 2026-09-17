/**
 * Leitura do que as contas do Financeiro completo (fase G) precisam.
 * Tudo numa ida por tabela; as contas ficam em comissoes.js / producao.js.
 */
const c = require('./comum');
const regras = require('./regras');
const contasReceber = require('../cobranca/contasReceber');

async function lerFechamentos(api) {
  const [fechamentos, itens, pagamentos] = await Promise.all([
    c.ler(api, 'financeiro_fechamentos'),
    c.ler(api, 'financeiro_fechamento_itens'),
    c.ler(api, 'financeiro_pagamentos')
  ]);
  return {
    fechamentos: fechamentos.map(f => ({ ...f, competencia: String(f.competencia || '').trim() })),
    itens,
    pagamentos: pagamentos.map(p => ({ ...p, competencia: String(p.competencia || '').trim(), data_pagamento: c.dia(p.data_pagamento) }))
  };
}

/**
 * Quem recebe em cada pedido: o dono do cliente (CMS) e o valor vendido das
 * peças de cada desenhista (Royalty). Pura.
 *
 * O valor de cada linha é o do pedido (`valor_total`, já com o desconto), só
 * das peças que continuam com o cliente — as devolvidas saem da conta.
 */
function contextoDosPedidos({ pedidos = [], itens = [], produtos = [], clientes = [] }) {
  const donoDoCliente = new Map(clientes.filter(Boolean).map(x => [String(x.id), String(x.dono_cliente || '').trim() || null]));
  const desenhistaDe = new Map(produtos.filter(Boolean).map(p => [String(p.id), String(p.desenhado_por || '').trim()]));
  const itensPor = new Map();
  for (const i of itens.filter(Boolean)) {
    const k = String(i.pedido_id);
    if (!itensPor.has(k)) itensPor.set(k, []);
    itensPor.get(k).push(i);
  }
  const porPedido = new Map();
  for (const p of pedidos.filter(Boolean)) {
    const doPedido = itensPor.get(String(p.id)) || [];
    const quantidades = doPedido.map(i => {
      const q = Number(i.quantidade) || 0;
      const devolvida = Math.min(q, Math.max(0, Number(i.quantidade_devolvida) || 0));
      return { i, q, fica: q - devolvida };
    });
    // Tudo devolvido: a divisão fica pelas peças vendidas (a base da parcela já vai a zero).
    const usar = quantidades.some(x => x.fica > 0) ? quantidades : quantidades.map(x => ({ ...x, fica: x.q }));
    const desenhistas = usar.map(({ i, q, fica }) => ({
      nome: desenhistaDe.get(String(i.produto_id)) || '',
      valor: q > 0 ? (Number(i.valor_total) || 0) * fica / q : 0
    }));
    porPedido.set(String(p.id), {
      dono_cliente: p.cliente_id === null || p.cliente_id === undefined ? null : (donoDoCliente.get(String(p.cliente_id)) || null),
      desenhistas
    });
  }
  return porPedido;
}

/**
 * A base das comissões: as contas a receber (fase E), os ajustes, as regras,
 * os fechamentos e quem recebe em cada pedido. `desde` é o corte
 * "controlar a partir de" da cobrança.
 */
async function lerComissoes(api, { hoje, desde = null }) {
  const [receber, ajustes, tudo, fech, itens, produtos, clientes] = await Promise.all([
    contasReceber.lerBase(api, hoje),
    c.ler(api, 'ajustes_financeiros'),
    regras.lerTudo(api),
    lerFechamentos(api),
    api.get('/api/pedidos_itens').then(c.lista).catch(() => []),
    api.get('/api/produtos', { query: { select: 'id,desenhado_por' } }).then(c.lista).catch(() => []),
    api.get('/api/clientes', { query: { select: 'id,dono_cliente' } }).then(c.lista).catch(() => [])
  ]);
  const linhas = contasReceber.parcelasDosPedidos({ ...receber, hoje, desde });
  const contexto = contextoDosPedidos({ pedidos: receber.pedidos, itens, produtos, clientes });
  return { receber, linhas, ajustes, regras: tudo, contexto, ...fech };
}

/** Nomes dos clientes que aparecem (um GET por cliente, como as contas a receber). */
async function nomesDosClientes(api, ids) {
  const unicos = [...new Set(ids.filter(v => v !== null && v !== undefined).map(String))];
  const achados = await Promise.all(unicos.map(id => api.get('/api/clientes', { query: { id, select: 'id,nome_fantasia,razao_social' } })
    .then(r => c.lista(r).find(x => String(x?.id) === id) || null).catch(() => null)));
  return new Map(achados.filter(Boolean).map(x => [String(x.id), c.nomeDoCliente(x)]));
}

module.exports = { lerFechamentos, contextoDosPedidos, lerComissoes, nomesDosClientes };
