/**
 * Reembolsos: o dinheiro que volta para o cliente numa devolução. Nasce
 * pendente no registro da devolução (devolucoes/registro.js) e o Financeiro
 * confirma quando pagar — do mesmo jeito que confirma o pagamento de uma
 * competência fechada. O app não paga nada: só registra que foi pago.
 */
const c = require('./comum');
const auditoria = require('../financeiro/auditoria');
const recebimentos = require('../cobranca/recebimentos');

const FORMAS = recebimentos.FORMAS.filter(f => f !== 'Cartão de crédito');

async function nomesDe(api, reembolsos) {
  const pedidoIds = [...new Set(reembolsos.map(r => Number(r.pedido_id)))];
  const pedidos = await Promise.all(pedidoIds.map(id => api.get(`/api/pedidos/${id}`).catch(() => null)));
  const porPedido = new Map(pedidos.filter(p => p && !p.error).map(p => [Number(p.id), p]));
  const clienteIds = [...new Set([...porPedido.values()].map(p => p.cliente_id).filter(v => v !== null && v !== undefined))];
  const clientes = await Promise.all(clienteIds.map(id => api.get(`/api/clientes/${id}`).catch(() => null)));
  const porCliente = new Map(clientes.filter(x => x && !x.error).map(x => [Number(x.id), c.nomeDoCliente(x)]));
  return { porPedido, porCliente };
}

/** Os reembolsos (todos, ou só os de um status), com o pedido e o cliente por extenso. */
async function listar({ api, status = null }) {
  const linhas = await c.ler(api, 'reembolsos', status ? { status } : {});
  const { porPedido, porCliente } = await nomesDe(api, linhas);
  return linhas
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) || Number(a.id) - Number(b.id))
    .map(r => {
      const pedido = porPedido.get(Number(r.pedido_id));
      return {
        id: r.id, devolucao_id: r.devolucao_id, pedido_id: r.pedido_id, pedido: pedido?.numero ?? String(r.pedido_id),
        cliente: porCliente.get(Number(pedido?.cliente_id ?? r.cliente_id)) || null,
        valor: c.centavos(r.valor), status: r.status, criado_em: r.criado_em, data_pagamento: c.dia(r.data_pagamento),
        forma: r.forma || null, observacao: r.observacao || null
      };
    });
}

async function confirmar({ api, id, entrada, usuarioId = null, hoje }) {
  const data = String(entrada?.data_pagamento || '').slice(0, 10);
  if (!c.dataValida(data)) throw c.erro('Informe a data em que o reembolso foi pago.');
  if (data > hoje) throw c.erro('A data do reembolso não pode ser futura.');
  const forma = String(entrada?.forma || '');
  if (!FORMAS.includes(forma)) throw c.erro(`Informe como o reembolso foi pago (${FORMAS.join(', ')}).`);
  const reembolso = (await c.ler(api, 'reembolsos', { id: Number(id) }))[0];
  if (!reembolso) throw c.erro('Reembolso não encontrado.', 404);
  if (reembolso.status !== 'pendente') throw c.erro('Este reembolso já foi confirmado.', 409);

  const campos = {
    status: 'pago', data_pagamento: data, forma, observacao: c.texto(entrada?.observacao, 500) || null,
    confirmado_por: usuarioId, confirmado_em: c.agora()
  };
  await c.atualizar(api, 'reembolsos', reembolso.id, campos);
  const pedido = await api.get(`/api/pedidos/${reembolso.pedido_id}`).catch(() => null);
  await auditoria.registrar(api, {
    tipo: 'reembolso_confirmado', pedidoId: Number(reembolso.pedido_id), referenciaId: reembolso.id, valor: -Number(reembolso.valor), usuarioId,
    descricao: `Reembolso de ${c.reais(reembolso.valor)} do pedido ${pedido?.numero ?? reembolso.pedido_id} pago em ${c.impressa(data)} (${forma})`
  });
  return { ...reembolso, ...campos };
}

/**
 * As pendências que a devolução deixa no painel do Financeiro: reembolso a
 * pagar e devolução com algo por terminar (estoque, abatimento ou baixa no
 * BB). Sem o SQL da devolução, nenhuma.
 */
async function pendenciasDoPainel({ api, hoje }) {
  const [reembolsos, devolucoes] = await Promise.all([
    c.lerSePuder(api, 'reembolsos', { status: 'pendente' }),
    c.lerSePuder(api, 'devolucoes', { status: 'pendencias' })
  ]);
  if (!reembolsos.length && !devolucoes.length) return [];
  const { porPedido } = await nomesDe(api, [...reembolsos, ...devolucoes]);
  const numeroDe = id => porPedido.get(Number(id))?.numero ?? id;
  const lista = [];
  for (const r of reembolsos) {
    lista.push({
      nivel: 'normal', chave: `reembolso_${r.id}`,
      titulo: `Reembolso a pagar — pedido ${numeroDe(r.pedido_id)}`,
      descricao: `${c.reais(r.valor)} por devolução · confirme quando pagar ao cliente`,
      data: c.dia(r.criado_em) || hoje, acao: 'Confirmar', destino: 'confirmar-reembolso', filtro: { reembolso_id: r.id }
    });
  }
  for (const d of devolucoes) {
    lista.push({
      nivel: 'critico', chave: `devolucao_${d.id}`,
      titulo: `Devolução do pedido ${numeroDe(d.pedido_id)} com pendência`,
      descricao: 'Algo não terminou (volta ao estoque, abatimento ou baixa do boleto no BB).',
      data: c.dia(d.data_devolucao) || hoje, acao: 'Tentar de novo', destino: 'reaplicar-devolucao', filtro: { devolucao_id: d.id }
    });
  }
  return lista;
}

module.exports = { FORMAS, listar, confirmar, pendenciasDoPainel };
