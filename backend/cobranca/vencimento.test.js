/**
 * Vencimento em dia não útil (decisão do dono, 24/09/2026): o vencimento do
 * papel não muda; paga até o próximo dia útil está em dia; depois disso o
 * atraso conta desde o vencimento do papel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./vencimento');

const REGRAS = { juros_tipo: 'valor_dia', juros_percentual_mes: 9, multa_percentual: 2, multa_dias: 1 };

test('o último dia sem encargos: o próprio vencimento em dia útil; senão o próximo dia útil', () => {
  assert.equal(v.limiteSemEncargos('2026-09-24'), '2026-09-24', 'quinta-feira: é ele mesmo');
  assert.equal(v.limiteSemEncargos('2026-09-20'), '2026-09-21', 'domingo → segunda');
  assert.equal(v.limiteSemEncargos('2026-09-19'), '2026-09-21', 'sábado nunca é dia útil para pagar');
  assert.equal(v.limiteSemEncargos('2026-10-12'), '2026-10-13', 'Nossa Senhora Aparecida (segunda) → terça');
  assert.equal(v.limiteSemEncargos('2027-01-01'), '2027-01-04', 'Confraternização (sexta) + fim de semana, já no ano seguinte');
  assert.equal(v.limiteSemEncargos('2026-09-20', [{ data: '2026-09-21', descricao: 'Feriado municipal' }]), '2026-09-22', 'o feriado cadastrado no Financeiro também conta');
  assert.equal(v.limiteSemEncargos(null), null);
});

test('dias de atraso: zero até o limite; passou dele, conta desde o vencimento do papel', () => {
  // O exemplo do dono: vence no domingo 20/09.
  assert.equal(v.diasDeAtraso('2026-09-20', '2026-09-20'), 0);
  assert.equal(v.diasDeAtraso('2026-09-20', '2026-09-21'), 0, 'pagou na segunda: em dia');
  assert.equal(v.diasDeAtraso('2026-09-20', '2026-09-22'), 2, 'terça: 2 dias desde o domingo');
  assert.equal(v.diasDeAtraso('2026-09-20', '2026-09-23'), 3, 'quarta: 3 dias desde 20/09');
  // Vencimento em dia útil: atraso normal.
  assert.equal(v.diasDeAtraso('2026-09-24', '2026-09-24'), 0);
  assert.equal(v.diasDeAtraso('2026-09-24', '2026-09-25'), 1);
  assert.equal(v.estaAtrasado('2026-09-20', '2026-09-21'), false);
  assert.equal(v.estaAtrasado('2026-09-20', '2026-09-22'), true);
  assert.equal(v.diasDeAtraso(null, '2026-09-22'), 0);
});

test('multa e juros do pagamento em atraso: pelas regras dos boletos, desde o vencimento do papel', () => {
  // A parcela de R$ 3.326,51 que vence no domingo 20/09.
  const emDia = v.encargosDoAtraso({ valor: 3326.51, vencimento: '2026-09-20', data: '2026-09-21', cfg: REGRAS });
  assert.deepEqual(emDia, { dias: 0, limite: '2026-09-21', desconto_perdido: 0, multa: 0, juros: 0, total: 0, valor: 3326.51, com_encargos: 3326.51 });

  const atrasado = v.encargosDoAtraso({ valor: 3326.51, vencimento: '2026-09-20', data: '2026-09-23', cfg: REGRAS });
  // Multa 2% = 66,53; juros 9% ao mês ÷ 30 = 9,98 por dia × 3 dias = 29,94.
  assert.deepEqual(atrasado, { dias: 3, limite: '2026-09-21', desconto_perdido: 0, multa: 66.53, juros: 29.94, total: 96.47, valor: 3326.51, com_encargos: 3422.98 });

  const semJuros = v.encargosDoAtraso({ valor: 1000, vencimento: '2026-09-24', data: '2026-09-28', cfg: { ...REGRAS, juros_tipo: 'sem' } });
  assert.deepEqual([semJuros.dias, semJuros.multa, semJuros.juros], [4, 20, 0]);

  // Multa só a partir do 5º dia depois do vencimento.
  const multaDepois = v.encargosDoAtraso({ valor: 1000, vencimento: '2026-09-24', data: '2026-09-27', cfg: { ...REGRAS, multa_dias: 5 } });
  assert.deepEqual([multaDepois.dias, multaDepois.multa, multaDepois.juros], [3, 0, 9]);

  const semRegras = v.encargosDoAtraso({ valor: 1000, vencimento: '2026-09-24', data: '2026-09-28', cfg: {} });
  assert.deepEqual([semRegras.dias, semRegras.total], [4, 0], 'sem regras cadastradas: o atraso aparece, sem sugerir valor');
});
