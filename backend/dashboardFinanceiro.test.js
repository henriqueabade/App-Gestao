/**
 * As contas do Financeiro no Dashboard (backend/dashboardFinanceiro.js): as
 * bordas que o cenário de dashboardController.test.js não alcança — faixas de
 * vencimento nos dias 15/16 e 30/31, a janela de "sem NF-e" na virada do ano e
 * a ordem dos pagamentos a confirmar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./dashboardFinanceiro');

// Meio-dia em São Paulo: longe de qualquer virada de dia.
const AGORA = new Date('2026-01-10T15:00:00.000Z');

test('faixas de vencimento: 15 dias ainda é "até 15" (o BB recebe), 16 já não; 30 é "16 a 30"; em dia pelo vencimento', () => {
  const hoje = '2026-01-10';
  const faixa = (dias_atraso, vencimento = '2026-01-01') => F.faixaDaParcela({ dias_atraso, vencimento }, hoje);
  assert.deepEqual([faixa(1), faixa(15), faixa(16), faixa(30), faixa(31)], ['atraso_1_15', 'atraso_1_15', 'atraso_16_30', 'atraso_16_30', 'atraso_30']);
  assert.equal(faixa(0, '2026-01-09'), 'vence_7', 'venceu no sábado e está no prazo sem encargos: em dia');
  assert.equal(faixa(0, '2026-01-17'), 'vence_7');
  assert.equal(faixa(0, '2026-01-18'), 'vence_30');
  assert.equal(faixa(0, '2026-02-09'), 'vence_30');
  assert.equal(faixa(0, '2026-02-10'), 'depois');
  assert.equal(F.faixaDaParcela({ dias_atraso: 0, vencimento: null }, hoje), null, 'sem data não entra em faixa');
  assert.deepEqual(F.FAIXAS_VENCIMENTO, ['atraso_30', 'atraso_16_30', 'atraso_1_15', 'vence_7', 'vence_30', 'depois']);
});

test('fiscal: "sem NF-e" olha desde o 1º dia do mês passado — em janeiro, desde dezembro do ano anterior', () => {
  const f = F.resumirFiscal({
    pedidos: [
      { id: 1, numero: 'PED1', situacao: 'Enviado', embarcar_real: '2025-12-28', valor_final: 900 },
      { id: 2, numero: 'PED2', situacao: 'Entregue', embarcar_real: '2025-11-30', valor_final: 500 }
    ],
    notas_fiscais: []
  }, { agora: AGORA });
  assert.equal(f.aguardandoNfe.desde, '2025-12-01');
  assert.deepEqual(f.aguardandoNfe.itens.map(i => [i.numero, i.dias, i.valor]), [['PED1', 13, 900]], 'o de novembro é antes da janela');
  assert.equal(f.certificado, null, 'sem o complemento, nada sobre o certificado');
});

test('pagar: o que falta é comissão + produção; a confirmar sem o que já foi pago, atrasados primeiro', () => {
  const p = F.resumirPagar({
    competencia: '2026-01',
    comissoes: { situacao: 'aberta', valor: 1000.1, total: 1000.1, pago: 0, parcelas: 3, pagar_ate: '2026-02-05' },
    producao: { situacao: 'paga', valor: 0, total: 2000, pago: 2000, pecas: 10, pagar_ate: '2026-02-06' },
    atrasadas: { valor: 99.9, parcelas: 1 },
    a_confirmar: [
      { tipo: 'comissao', competencia: '2025-12', total: 800, falta_pagar: 800, pagar_ate: '2026-01-15' },
      { tipo: 'producao', competencia: '2025-12', total: 700, falta_pagar: 300, pagar_ate: '2026-01-08' },
      { tipo: 'producao', competencia: '2025-11', total: 900, falta_pagar: 0, pagar_ate: '2025-12-08' }
    ]
  }, { agora: AGORA });
  assert.deepEqual(p.aPagar, { valor: 1000.1 });
  assert.deepEqual(p.aConfirmar.itens.map(i => [i.tipo, i.competencia, i.valor, i.atrasado]), [
    ['producao', '2025-12', 300, true],
    ['comissao', '2025-12', 800, false]
  ]);
  assert.deepEqual([p.aConfirmar.quantidade, p.aConfirmar.atrasados, p.aConfirmar.valor], [2, 1, 1100]);
  assert.deepEqual(p.producao.pago, { valor: 2000 });
});
