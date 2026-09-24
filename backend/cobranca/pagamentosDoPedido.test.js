/**
 * Pagamentos das parcelas de um pedido (modal "Pagamentos" do Visualizar,
 * decisões do dono de 24/09/2026): a situação de cada parcela, o que se pode
 * registrar e estornar, o vencimento em dia não útil e o resumo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const pagamentos = require('./pagamentosDoPedido');
const contas = require('./contasReceber');

const HOJE = '2026-09-24';

function montar({ recebimentos = [], boletos = [], externos = [], cancelado = false } = {}) {
  const pedido = { id: 7, numero: 'PED104', situacao: 'Entregue', cliente_id: 1 };
  const parcelas = [
    { id: 71, pedido_id: 7, numero_parcela: 1, valor: '3326.51', data_vencimento: '2026-08-20' },
    { id: 72, pedido_id: 7, numero_parcela: 2, valor: '3326.51', data_vencimento: '2026-09-20' },
    { id: 73, pedido_id: 7, numero_parcela: 3, valor: '3326.51', data_vencimento: '2026-10-19' },
    { id: 74, pedido_id: 7, numero_parcela: 4, valor: '3326.51', data_vencimento: '2026-11-18' }
  ];
  const linhas = contas.parcelasDosPedidos({ pedidos: [pedido], parcelas, recebimentos, boletos, hoje: HOJE });
  return pagamentos.parcelasParaPagamento({ linhas, parcelas, boletosExternos: externos, recebimentosDoPedido: recebimentos, hoje: HOJE, cancelado });
}

test('cada parcela: paga (com forma, observação e encargos), boleto em aberto, atrasada desde o vencimento, em aberto', () => {
  const lista = montar({
    recebimentos: [{ id: 5, pedido_id: 7, numero_parcela: 1, status: 'confirmado', origem: 'manual', forma: 'Pix', data_recebimento: '2026-08-25', valor_parcela: '3326.51', valor_recebido: '3422.98', valor_encargos: '96.47', competencia: '2026-08', observacao: 'Pix na conta da empresa' }],
    boletos: [{ id: 30, pedido_id: 7, parcela_id: 73, numero_parcela: 3, status: 'registrado', data_vencimento: '2026-10-19', nosso_numero: '00031285570000000003' }],
    externos: [{ id: 9, pedido_id: 7, parcela_id: 74, numero_parcela: 4, banco: '341', valor: '3326.51', vencimento: '2026-11-18', linha_digitavel: '3419', ativo: true }]
  });
  const [p1, p2, p3, p4] = lista;

  assert.equal(p1.situacao, 'paga');
  assert.deepEqual(
    [p1.recebimento.forma, p1.recebimento.data, p1.recebimento.encargos, p1.recebimento.observacao, p1.recebimento.origem_rotulo, p1.recebimento.pode_estornar, p1.pode_registrar],
    ['Pix', '2026-08-25', 96.47, 'Pix na conta da empresa', 'registrado à mão', true, false]
  );

  // A 2ª vence no domingo 20/09: em dia até segunda 21/09; em 24/09, 4 dias desde o domingo.
  assert.deepEqual([p2.situacao, p2.limite_sem_encargos, p2.dias_atraso, p2.pode_registrar], ['atrasada', '2026-09-21', 4, true]);

  assert.deepEqual([p3.situacao, p3.boleto_aberto, p3.boleto.nosso_numero, p3.pode_registrar], ['aberta', true, '00031285570000000003', true], 'boleto do BB em aberto: registra (a tela pergunta antes de baixar)');
  assert.deepEqual([p4.situacao, p4.boleto_externo.banco_nome, p4.boleto_aberto], ['aberta', 'Itaú', false]);

  assert.deepEqual(pagamentos.resumoDosPagamentos(lista), { parcelas: 4, pagas: 1, recebido: 3422.98, em_aberto: 9979.53, atrasadas: 1 });
});

test('o que veio do banco não se estorna aqui; boleto pago sem lançamento não se registra; pedido cancelado não recebe', () => {
  const doBanco = montar({
    recebimentos: [{ id: 6, pedido_id: 7, numero_parcela: 1, status: 'confirmado', origem: 'boleto', forma: null, data_recebimento: '2026-08-20', valor_recebido: '3326.51', valor_encargos: '0', competencia: '2026-08' }],
    boletos: [{ id: 31, pedido_id: 7, parcela_id: 72, numero_parcela: 2, status: 'pago', data_vencimento: '2026-09-20', nosso_numero: 'N2' }]
  });
  assert.deepEqual([doBanco[0].situacao, doBanco[0].recebimento.pode_estornar], ['paga', false], 'só o BB desfaz o pagamento do boleto');
  assert.deepEqual([doBanco[1].situacao, doBanco[1].pode_registrar], ['paga_no_banco', false], 'a conciliação lança');

  const cancelado = montar({ cancelado: true });
  assert.ok(cancelado.every(p => p.pode_registrar === false));
});

test('a resposta para a tela não leva as regras internas', () => {
  assert.deepEqual(Object.keys(pagamentos.paraTela({ pedido: {}, parcelas: [], _cfg: { x: 1 }, _feriados: [] })).sort(), ['parcelas', 'pedido']);
});
