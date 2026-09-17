/**
 * O que a devolução precisa saber de UM pedido: as peças (e quantas já
 * voltaram), as parcelas com o estado de cada uma (em aberto, paga,
 * cancelada), o boleto que vale, a nota fiscal e as devoluções anteriores.
 *
 * O estado das parcelas é o mesmo das Contas a receber
 * (cobranca/contasReceber.js): recebimento confirmado ou boleto pago = paga.
 */
const c = require('./comum');
const calculo = require('./calculo');
const contasReceber = require('../cobranca/contasReceber');
const boletos = require('../cobranca/boletos');
const recebimentos = require('../cobranca/recebimentos');
const parcelaMinima = require('../cobranca/parcelaMinima');

const SITUACOES_ENTREGUES = new Set(['enviado', 'entregue']);
const situacaoDe = p => String(p?.situacao || '').trim().toLowerCase();

/**
 * Pode devolver? Pedido Enviado/Entregue, ou com NF-e autorizada; nunca o
 * cancelado nem o já devolvido por inteiro. Devolve o motivo quando não pode.
 */
function bloqueioDaDevolucao(pedido, notaViva) {
  const situacao = situacaoDe(pedido);
  if (situacao === 'cancelado') return 'Este pedido está cancelado.';
  if (pedido?.devolucao === 'total') return 'Este pedido já foi devolvido por inteiro.';
  if (!SITUACOES_ENTREGUES.has(situacao) && !notaViva) {
    return 'A devolução vale para pedido enviado, entregue ou com NF-e autorizada. Antes disso, use "Cancelar".';
  }
  return null;
}

/**
 * As parcelas no formato de `calculo.planejar`. Pura. `prazoDaPrimeira` (dias)
 * marca a entrada à vista: a 1ª parcela com prazo 0 fica fora da parcela mínima.
 */
function parcelasParaOPlano({ linhas = [], recebimentos: recs = [], boletos: bols = [], reembolsadas = new Map(), prazoDaPrimeira = null }) {
  const recebimentoDe = numero => recs.find(r => r && r.status === 'confirmado' && Number(r.numero_parcela) === Number(numero)) || null;
  return linhas.map(l => {
    const numero = Number(l.numero_parcela);
    const boleto = l.boleto ? bols.find(b => Number(b.id) === Number(l.boleto.id)) || l.boleto : null;
    const rec = recebimentoDe(numero);
    const estado = l.estado === 'recebida' ? 'paga' : (l.estado === 'cancelada' ? 'cancelada' : 'aberta');
    // Principal pago: o que era devido (valor − abatimento); juros e multa ficam de fora.
    const pago = rec
      ? c.centavos(Number(rec.valor_parcela || l.valor) - Number(rec.valor_abatimento || 0))
      : c.centavos(Number(l.valor) - Number(boleto?.valor_abatimento || 0));
    return {
      numero, parcela_id: l.parcela_id ?? null, vencimento: l.vencimento || null, estado,
      valor: c.centavos(l.valor), abatimento: c.centavos(l.abatimento),
      saldo: estado === 'aberta' ? c.centavos(l.a_receber) : 0,
      pago: estado === 'paga' ? pago : 0,
      reembolsado: c.centavos(reembolsadas.get(numero) || 0),
      recebimento_id: rec?.id ?? null,
      isenta: numero === 1 && prazoDaPrimeira !== null && Number(prazoDaPrimeira) === 0,
      boleto: boleto ? {
        id: boleto.id, nosso_numero: boleto.nosso_numero || null, status: boleto.status,
        a_pagar: boletos.STATUS_A_PAGAR.has(String(boleto.status))
      } : null
    };
  });
}

/** Pedido faturado para as Contas a receber mesmo sem nota nem boleto: a devolução só chega aqui com ele liberado. */
const comoFaturado = pedido => (SITUACOES_ENTREGUES.has(situacaoDe(pedido)) ? pedido : { ...pedido, situacao: 'Enviado' });

async function lerPedido(api, pedidoId, hoje) {
  const id = Number(pedidoId);
  if (!Number.isInteger(id) || id <= 0) throw c.erro('Pedido inválido.');
  const pedido = await api.get(`/api/pedidos/${id}`).catch(() => null);
  if (!pedido || pedido.error) throw c.erro('Pedido não encontrado.', 404);

  const lista = r => c.lista(r).filter(l => l && Number(l.pedido_id) === id);
  const [itens, parcelas, bols, notas, recs, devolucoes, devParcelas, cliente] = await Promise.all([
    api.get('/api/pedidos_itens', { query: { pedido_id: id } }).then(lista),
    api.get('/api/pedido_parcelas', { query: { pedido_id: id } }).then(lista).catch(() => []),
    api.get('/api/boletos', { query: { pedido_id: id } }).then(lista).catch(() => []),
    api.get('/api/notas_fiscais', { query: { pedido_id: id } }).then(lista).catch(() => []),
    recebimentos.lerTodos(api, { pedido_id: id }).then(lista).catch(() => []),
    c.ler(api, 'devolucoes', { pedido_id: id }),
    c.ler(api, 'devolucao_parcelas', { pedido_id: id }),
    pedido.cliente_id != null ? api.get(`/api/clientes/${pedido.cliente_id}`).catch(() => null) : Promise.resolve(null)
  ]);

  const notaViva = notas.filter(n => n.status_fiscal === 'autorizada').sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  const notasLeves = notas.map(n => ({ id: n.id, pedido_id: n.pedido_id, serie: n.serie, numero: n.numero, status_fiscal: n.status_fiscal, chave_acesso: n.chave_acesso }));
  const linhas = contasReceber.parcelasDosPedidos({
    pedidos: [comoFaturado(pedido)], parcelas, recebimentos: recs, boletos: bols, notas: notasLeves,
    clientes: cliente && !cliente.error ? [cliente] : [], hoje
  });
  const reembolsadas = new Map();
  for (const l of devParcelas.filter(d => d.modo === 'reembolso')) {
    reembolsadas.set(Number(l.numero_parcela), c.centavos((reembolsadas.get(Number(l.numero_parcela)) || 0) + Number(l.desconto || 0)));
  }

  return {
    pedido, itens, parcelasCruas: parcelas, boletos: bols, recebimentos: recs,
    cliente: cliente && !cliente.error ? cliente : null,
    notaViva: notaViva ? { id: notaViva.id, serie: notaViva.serie, numero: notaViva.numero, chave_acesso: notaViva.chave_acesso } : null,
    devolucoes: devolucoes.slice().sort((a, b) => Number(a.sequencia) - Number(b.sequencia)),
    devolucaoParcelas: devParcelas,
    parcelas: parcelasParaOPlano({ linhas, recebimentos: recs, boletos: bols, reembolsadas, prazoDaPrimeira: parcelaMinima.prazosDoTexto(pedido.prazo)[0] ?? null }),
    pecas: calculo.itensParaDevolver(itens)
  };
}

module.exports = { SITUACOES_ENTREGUES, bloqueioDaDevolucao, parcelasParaOPlano, lerPedido };
