/**
 * "Desconto na parcela" (dono, 09/10/2026 — a volta do ajuste antigo de
 * parcela, agora como um botão nos Detalhes da parcela).
 *
 * O caso: pedido já faturado, a parcela ainda em aberto, sem boleto, e a
 * empresa dá um desconto ao cliente. O desconto muda o VALOR DA PARCELA — e
 * não só a base da comissão, como fazia o ajuste antigo (ajustes.js) — para
 * valer em todo lugar: Contas a receber, previsão, comissão (a parcela em
 * aberto vale o valor dela; recebida, o que entrou) e o total do pedido.
 * Com o ajuste antigo, o cliente pagando o valor com desconto contava o
 * desconto duas vezes: a parcela recebida já vale o que entrou (06/10/2026).
 *
 * É a mesma conta do "Gerar boletos com data/valor" (cobranca/boletos.js):
 * o total do pedido passa a ser a soma das parcelas, a diferença para os
 * itens vira o "Desconto" do pedido, e o histórico do pedido guarda quem,
 * quando, de quanto para quanto e por quê (justificativa de ao menos 10
 * letras, pedidoParcelas.MINIMO_JUSTIFICATIVA).
 *
 * Só parcela LIVRE: com boleto do BB, boleto de fora, pagamento registrado ou
 * ordem de pagamento aberta, a parcela está travada (pedidoParcelas) — o
 * desconto vai no próprio boleto (abatimento), na ordem, ou, se já foi paga,
 * é devolução.
 */
const c = require('./comum');
const auditoria = require('./auditoria');
const pedidoParcelas = require('../pedidoParcelas');

/** Por que a parcela travada não aceita o desconto aqui. */
const RECUSA_DA_TRAVA = {
  boleto: (n, t) => `A ${n}ª parcela tem boleto do BB${t.permitido !== null ? ` de ${c.reais(t.permitido)}` : ''}: o desconto vai no próprio boleto, como abatimento (Detalhes do boleto).`,
  boleto_fora: n => `A ${n}ª parcela tem boleto de fora: o desconto vai nesse boleto, no banco que o emitiu.`,
  pagamento: n => `A ${n}ª parcela já foi paga: dinheiro devolvido ao cliente é a Devolução do pedido.`,
  ordem: (n, t) => `A ${n}ª parcela tem ordem de pagamento aberta${t.permitido !== null ? ` de ${c.reais(t.permitido)}` : ''}: cancele a ordem antes de dar o desconto.`
};

function validar(entrada) {
  const desconto = c.centavos(entrada?.valor);
  if (!(desconto > 0)) throw c.erro('Informe o valor do desconto.', 422);
  const justificativa = c.texto(entrada?.justificativa, 500);
  if (justificativa.length < pedidoParcelas.MINIMO_JUSTIFICATIVA) {
    throw c.erro(`Escreva a justificativa do desconto (ao menos ${pedidoParcelas.MINIMO_JUSTIFICATIVA} letras).`, 422, { code: 'JUSTIFICATIVA_OBRIGATORIA' });
  }
  return { desconto, justificativa };
}

async function aplicar({ api, pedidoId, numero, entrada, usuarioId = null }) {
  const id = Number(pedidoId);
  const n = Number(numero);
  if (!(Number.isInteger(id) && id > 0) || !(Number.isInteger(n) && n > 0)) throw c.erro('Parcela não informada.', 400);
  const { desconto, justificativa } = validar(entrada);

  const lerLista = (tabela, query) => c.ler(api, tabela, query).catch(() => []);
  const [pedidos, parcelas, boletos, recebimentos, externos, ordens] = await Promise.all([
    c.ler(api, 'pedidos', { id }),
    c.ler(api, 'pedido_parcelas', { pedido_id: id }),
    lerLista('boletos', { pedido_id: id }),
    lerLista('recebimentos', { pedido_id: id }),
    lerLista('boletos_externos', { pedido_id: id }),
    lerLista('ordens_pagamento', { pedido_id: id, status: 'aberta' })
  ]);
  const pedido = pedidos[0];
  if (!pedido) throw c.erro('Pedido não encontrado.', 404);
  if (String(pedido.situacao || '').trim().toLowerCase() === 'cancelado') throw c.erro('O pedido foi cancelado: não há parcela para dar desconto.', 409);
  const parcela = parcelas.find(p => Number(p.numero_parcela) === n);
  if (!parcela) throw c.erro(`A ${n}ª parcela não existe neste pedido.`, 404);

  const trava = pedidoParcelas.travasDasParcelas({ parcelas, boletos, recebimentos, externos, ordens }).get(n);
  if (trava) throw c.erro(RECUSA_DA_TRAVA[trava.origem](n, trava), 409, { code: 'PARCELA_TRAVADA', origem: trava.origem });

  const antes = c.centavos(parcela.valor);
  if (desconto >= antes) throw c.erro(`O desconto (${c.reais(desconto)}) precisa ser menor que a parcela (${c.reais(antes)}).`, 422);
  const depois = c.centavos(antes - desconto);

  await c.atualizar(api, 'pedido_parcelas', parcela.id, { valor: depois });

  // O total do pedido acompanha a soma das parcelas (a conta do Gerar boletos).
  const totalAntes = c.centavos(pedido.valor_final);
  const ajusteAnterior = c.centavos(pedido.ajuste_valor || 0);
  const valorItens = c.centavos(totalAntes - ajusteAnterior);
  const soma = c.centavos(parcelas.reduce((s, p) => s + (Number(p.numero_parcela) === n ? depois : c.centavos(p.valor)), 0));
  const ajuste = pedidoParcelas.ajusteDaSoma(soma, valorItens);
  const totalDepois = ajuste ? soma : valorItens;
  const motivo = `Desconto de ${c.reais(desconto)} na ${n}ª parcela: ${justificativa}`;
  const usuario = usuarioId ? await api.get(`/api/usuarios/${usuarioId}`, { query: { select: 'id,nome' } }).catch(() => null) : null;
  const quando = c.agora();
  await c.atualizar(api, 'pedidos', id, {
    valor_final: totalDepois,
    ajuste_valor: ajuste,
    ajuste_motivo: ajuste ? motivo : null,
    ajuste_em: ajuste ? quando : null,
    ajuste_por: ajuste ? usuarioId : null,
    ajuste_historico: pedidoParcelas.historicoComMais(pedido.ajuste_historico, {
      em: quando, por: usuarioId, por_nome: usuario && !usuario.error ? (usuario.nome || null) : null,
      total_antes: totalAntes, total_depois: totalDepois, valor_itens: valorItens, ajuste,
      motivo, origem: 'desconto_parcela'
    })
  });

  await auditoria.registrar(api, {
    tipo: 'desconto_parcela', pedidoId: id, numeroParcela: n, referenciaId: parcela.id, valor: -desconto, usuarioId,
    descricao: `Desconto de ${c.reais(desconto)} na parcela ${n} do pedido ${pedido.numero || id}: ${c.reais(antes)} → ${c.reais(depois)}. ${justificativa}`,
    dados: { antes, depois, desconto, total_antes: totalAntes, total_depois: totalDepois }
  });

  return {
    parcela: { numero: n, antes, depois, desconto },
    pedido: { id, numero: pedido.numero || null, total_antes: totalAntes, total_depois: totalDepois, ajuste }
  };
}

module.exports = { RECUSA_DA_TRAVA, validar, aplicar };
