/**
 * As contas da devolução (backend/devolucoes/calculo.js): o valor das peças,
 * parcial x total, o desconto proporcional nas parcelas em aberto, o
 * reembolso e o valor novo do pedido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const calculo = require('./calculo');

const item = (id, quantidade, valorTotal, extra = {}) => ({
  id, pedido_id: 1, produto_id: id * 10, codigo: `P-${id}`, nome: `Peça ${id}`, quantidade,
  valor_unitario: valorTotal / quantidade, valor_unitario_desc: valorTotal / quantidade, valor_total: valorTotal, ...extra
});
const aberta = (numero, saldo, boleto = null) => ({ numero, parcela_id: numero, vencimento: `2026-1${numero}-10`, estado: 'aberta', saldo, boleto });
const paga = (numero, pago, reembolsado = 0) => ({ numero, parcela_id: numero, vencimento: `2026-0${numero}-10`, estado: 'paga', pago, reembolsado, recebimento_id: 100 + numero });
const soma = (linhas, campo) => calculo.centavos(linhas.reduce((s, l) => s + l[campo], 0));

test('o valor da peça devolvida é o que o cliente pagou por ela, e a linha que fecha leva os centavos', () => {
  const tres = item(1, 3, 100); // 33,333... cada
  assert.equal(calculo.valorDaDevolucaoDoItem(tres, 1), 33.33);
  assert.equal(calculo.valorDaDevolucaoDoItem({ ...tres, quantidade_devolvida: 1 }, 1), 33.33);
  // A última fecha a linha: 100 − 66,67 (o que já voltou, arredondado) = 33,33.
  assert.equal(calculo.valorDaDevolucaoDoItem({ ...tres, quantidade_devolvida: 2 }, 1), 33.33);
  assert.equal(calculo.valorDaDevolucaoDoItem(tres, 3), 100);

  const telas = calculo.itensParaDevolver([{ ...tres, quantidade_devolvida: 2 }]);
  assert.deepEqual({ quantidade: telas[0].quantidade, devolvida: telas[0].devolvida, disponivel: telas[0].disponivel }, { quantidade: 3, devolvida: 2, disponivel: 1 });
});

test('repartir: proporcional, em centavos, o resto na última e sem passar do teto de cada parte', () => {
  assert.deepEqual(calculo.repartir(100, [1000, 1000, 1000]), [33.33, 33.33, 33.34]);
  assert.deepEqual(calculo.repartir(900, [600, 300]), [600, 300]);
  assert.deepEqual(calculo.repartir(300, [2000, 1000]), [200, 100]);
  assert.deepEqual(calculo.repartir(0, [10, 20]), [0, 0]);
  assert.deepEqual(calculo.repartir(50, []), []);
  // Valores grandes: centavos × centavos passa de 2^53.
  const grande = calculo.repartir(1234567.89, [9999999.99, 8888888.88]);
  assert.equal(calculo.centavos(grande[0] + grande[1]), 1234567.89);
});

test('parcial com parcelas em aberto: o desconto vai para todas, proporcional, e ninguém é reembolsado', () => {
  const plano = calculo.planejar({
    pedido: { valor_final: 4000 },
    itens: [item(1, 2, 1000), item(2, 1, 3000)],
    escolhas: [{ pedido_item_id: 1, quantidade: 1 }],
    parcelas: [paga(1, 1000), aberta(2, 1000), aberta(3, 2000, { id: 9, nosso_numero: '000123', status: 'registrado', a_pagar: true })]
  });
  assert.equal(plano.tipo, 'parcial');
  assert.equal(plano.valor, 500);
  assert.equal(plano.valor_reembolso, 0);
  assert.equal(plano.valor_parcelas, 500);
  assert.deepEqual(plano.parcelas.map(p => [p.numero_parcela, p.modo, p.valor_antes, p.desconto, p.valor_depois]), [
    [2, 'valor_parcela', 1000, 166.66, 833.34],
    [3, 'abatimento_boleto', 2000, 333.34, 1666.66]
  ]);
  assert.equal(plano.parcelas[1].boleto_id, 9);
  assert.deepEqual(plano.pedido, { valor_original: 4000, valor_devolvido: 500, valor_final: 3500 });
});

test('parcial maior que o que está em aberto: zera as abertas e reembolsa a diferença', () => {
  const plano = calculo.planejar({
    pedido: { valor_final: 4000 },
    itens: [item(1, 2, 3000), item(2, 1, 1000)],
    escolhas: [{ pedido_item_id: 1, quantidade: 1 }],
    parcelas: [paga(1, 2000), paga(2, 1000), aberta(3, 600), aberta(4, 400, { id: 7, nosso_numero: '000777', status: 'vencido', a_pagar: true })]
  });
  assert.equal(plano.valor, 1500);
  assert.equal(plano.em_aberto, 1000);
  assert.equal(plano.valor_parcelas, 1000);
  assert.equal(plano.valor_reembolso, 500);
  const porNumero = Object.fromEntries(plano.parcelas.map(p => [p.numero_parcela, p]));
  assert.equal(porNumero[3].modo, 'cancelada');
  assert.equal(porNumero[3].valor_depois, 0);
  assert.equal(porNumero[4].modo, 'baixa_boleto');
  // Os R$ 500 saem das pagas na proporção do que cada uma pagou (2000 : 1000).
  assert.deepEqual([porNumero[1].modo, porNumero[1].desconto, porNumero[2].desconto], ['reembolso', 333.33, 166.67]);
  assert.equal(plano.pedido.valor_final, 2500);
});

test('parcial com tudo pago: reembolsa o valor da devolução', () => {
  const plano = calculo.planejar({
    pedido: { valor_final: 2000 },
    itens: [item(1, 4, 2000)],
    escolhas: [{ pedido_item_id: 1, quantidade: 1 }],
    parcelas: [paga(1, 1000), paga(2, 1000)]
  });
  assert.equal(plano.valor, 500);
  assert.equal(plano.valor_reembolso, 500);
  assert.equal(plano.valor_parcelas, 0);
  assert.deepEqual(plano.parcelas.map(p => p.desconto), [250, 250]);
});

test('total: cancela o que está em aberto e reembolsa só o que foi pago', () => {
  const tudo = [{ pedido_item_id: 1, quantidade: 2 }, { pedido_item_id: 2, quantidade: 1 }];
  const parcialmentePago = calculo.planejar({
    pedido: { valor_final: 3000 }, itens: [item(1, 2, 2000), item(2, 1, 1000)], escolhas: tudo,
    parcelas: [paga(1, 1000), aberta(2, 1000, { id: 3, nosso_numero: '0003', status: 'registrado', a_pagar: true }), aberta(3, 1000)]
  });
  assert.equal(parcialmentePago.tipo, 'total');
  assert.equal(parcialmentePago.valor, 3000);
  assert.equal(parcialmentePago.valor_reembolso, 1000);
  assert.deepEqual(parcialmentePago.parcelas.map(p => p.modo), ['baixa_boleto', 'cancelada', 'reembolso']);
  // Devolvido por inteiro, o pedido continua mostrando o valor da venda.
  assert.deepEqual(parcialmentePago.pedido, { valor_original: 3000, valor_devolvido: 3000, valor_final: 3000 });

  const tudoPago = calculo.planejar({
    pedido: { valor_final: 3000 }, itens: [item(1, 2, 2000), item(2, 1, 1000)], escolhas: tudo, parcelas: [paga(1, 1500), paga(2, 1500)]
  });
  assert.equal(tudoPago.valor_reembolso, 3000);

  const nadaPago = calculo.planejar({
    pedido: { valor_final: 3000 }, itens: [item(1, 2, 2000), item(2, 1, 1000)], escolhas: tudo, parcelas: [aberta(1, 1500), aberta(2, 1500)]
  });
  assert.equal(nadaPago.valor_reembolso, 0);
  assert.equal(nadaPago.valor_parcelas, 3000);
});

test('segunda devolução: fecha o pedido, desconta o que já foi reembolsado e restaura o valor da venda', () => {
  const plano = calculo.planejar({
    pedido: { valor_final: 1500, valor_original: 2000, valor_devolvido: 500 },
    itens: [item(1, 4, 2000, { quantidade_devolvida: 1 })],
    escolhas: [{ pedido_item_id: 1, quantidade: 3 }],
    parcelas: [paga(1, 1000, 250), paga(2, 1000, 250)]
  });
  assert.equal(plano.tipo, 'total');
  assert.equal(plano.valor, 1500);
  assert.equal(plano.valor_reembolso, 1500);
  assert.deepEqual(plano.pedido, { valor_original: 2000, valor_devolvido: 2000, valor_final: 2000 });
});

test('recusa o que não fecha com o pedido e avisa quando o reembolso não cobre a devolução', () => {
  const itens = [item(1, 2, 1000, { quantidade_devolvida: 1 })];
  assert.throws(() => calculo.planejar({ pedido: {}, itens, escolhas: [], parcelas: [] }), /ao menos uma peça/);
  assert.throws(() => calculo.planejar({ pedido: {}, itens, escolhas: [{ pedido_item_id: 1, quantidade: 2 }], parcelas: [] }), /só 1 peça pode/);
  assert.throws(() => calculo.planejar({ pedido: {}, itens, escolhas: [{ pedido_item_id: 99, quantidade: 1 }], parcelas: [] }), /não é deste pedido/);
  assert.throws(() => calculo.planejar({ pedido: {}, itens, escolhas: [{ pedido_item_id: 1, quantidade: 0.5 }], parcelas: [] }), /Quantidade inválida/);

  const curto = calculo.planejar({
    pedido: { valor_final: 3000 }, itens: [item(1, 3, 3000)], escolhas: [{ pedido_item_id: 1, quantidade: 2 }],
    parcelas: [paga(1, 500), aberta(2, 1000)]
  });
  assert.equal(curto.valor, 2000);
  assert.equal(curto.valor_reembolso, 500);
  assert.match(curto.avisos.join(' '), /passa do que o pedido tem em aberto e pago/);
  assert.equal(soma(curto.parcelas, 'desconto'), 1500);
});
