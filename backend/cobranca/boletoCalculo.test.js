/**
 * Contas do boleto BB (backend/cobranca/boletoCalculo.js), conferidas contra
 * um boleto REAL do convênio 3453481 emitido em 15/09/2026: nosso número
 * 00034534810000000393-4, linha digitável 00190.00009 03453.481008
 * 00000.393173 1 16950000332700, vencimento 18/01/2027, R$ 3.327,00, juros
 * R$ 9,98/dia (9% ÷ 30), multa 2% e protesto a partir de 25/01/2027.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./boletoCalculo');

const REAL = { convenio: '3453481', sequencial: 393, carteira: 17, vencimento: '2027-01-18', valor: 3327 };

test('nosso número: "000" + convênio + sequencial de 10 dígitos, com o dígito do BB (11 − resto; 10 = X; 11 = 0)', () => {
  const nn = c.nossoNumero(REAL.convenio, REAL.sequencial);
  assert.equal(nn.numero, '00034534810000000393');
  assert.equal(nn.dv, '4');
  assert.equal(nn.formatado, '00034534810000000393-4');
  assert.equal(nn.numeroTituloCliente, '00034534810000000393');
  assert.equal(c.dvNossoNumero('00034534810000000001'), c.dvNossoNumero('00034534810000000001'), 'determinístico');
  // Um resto que dá 10 vira X, e 0 vira 0 — os dois casos que quebram quem só faz "11 - resto".
  const casos = new Set();
  for (let seq = 1; seq < 200; seq += 1) casos.add(c.nossoNumero(REAL.convenio, seq).dv);
  assert.ok(casos.has('X') && casos.has('0'), `faltou X ou 0 entre os dígitos: ${[...casos].join(',')}`);
  assert.throws(() => c.nossoNumero('123', 1), /7 dígitos/);
  assert.throws(() => c.nossoNumero(REAL.convenio, 0), /Sequencial/);
});

test('campo livre, código de barras (44) e linha digitável batem com o boleto real', () => {
  const livre = c.campoLivre(REAL);
  assert.equal(livre, '0000003453481000000039317');
  const barras = c.codigoBarras({ vencimento: REAL.vencimento, valor: REAL.valor, campoLivre: livre });
  assert.equal(barras, '00191169500003327000000003453481000000039317');
  assert.equal(barras.length, 44);
  const linha = c.linhaDigitavel(barras);
  assert.equal(linha.texto, '00190.00009 03453.481008 00000.393173 1 16950000332700');
  assert.equal(linha.digitos, '00190000090345348100800000393173116950000332700');
  assert.equal(linha.digitos.length, 47);
  assert.throws(() => c.codigoBarras({ vencimento: REAL.vencimento, valor: 0, campoLivre: livre }), /Valor/);
  assert.throws(() => c.linhaDigitavel('123'), /44/);
});

test('fator de vencimento: base nova (22/02/2025 = 1000) e a antiga para datas anteriores', () => {
  assert.equal(c.fatorVencimento('2027-01-18'), 1695);
  assert.equal(c.fatorVencimento('2025-02-22'), 1000);
  assert.equal(c.fatorVencimento('2025-02-21'), 9999, 'último dia da contagem antiga');
  assert.equal(c.fatorVencimento('2000-07-03'), 1000, 'na base antiga 03/07/2000 era 1000');
  assert.throws(() => c.fatorVencimento('x'), /Vencimento/);
});

test('juros por dia (9% ao mês ÷ 30 sobre o bruto), multa, datas do BB e soma de dias sem fuso', () => {
  assert.equal(c.jurosPorDia(3327, 9), 9.98);
  assert.equal(c.jurosPorDia('1500.00', 9), 4.5);
  assert.equal(c.valorMulta(3327, 2), 66.54);
  assert.equal(c.dataBB('2027-01-18'), '18.01.2027');
  assert.equal(c.dataBB('2027-01-18T00:00:00.000Z'), '18.01.2027');
  assert.equal(c.dataImpressa('2027-01-19'), '19/01/2027');
  assert.equal(c.dataImpressa('2027-01-19', { anoCurto: true }), '19/01/27');
  assert.equal(c.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(c.somarDias('2027-01-18', 7), '2027-01-25');
  assert.equal(c.dvModulo10('001900000'), '9', 'o 1º campo da linha real: 00190.0000 + DV 9');
});

test('encargos e instruções impressas com a redação do boleto real', () => {
  const cfg = { juros_tipo: 'valor_dia', juros_percentual_mes: 9, multa_percentual: 2, multa_dias: 1, protesto_dias: 7, negativacao_dias: null, dias_limite_recebimento: 15, desconto_percentual: 0, desconto_dias: 0 };
  const e = c.encargos({ valor: 3327, vencimento: '2027-01-18', cfg });
  assert.deepEqual(e.juros, { tipo: 'valor_dia', valorDia: 9.98, percentualMes: 9, aPartirDe: '2027-01-19' });
  assert.deepEqual(e.multa, { percentual: 2, valor: 66.54, aPartirDe: '2027-01-19' });
  assert.deepEqual(e.protesto, { dias: 7, aPartirDe: '2027-01-25' });
  assert.equal(e.negativacao, null);
  assert.equal(e.desconto, null);
  assert.equal(e.diasLimiteRecebimento, 15);
  assert.deepEqual(e.instrucoes, [
    'JRS: Vl p/Dia Atraso R$9,98 A PARTIR DE 19/01/27',
    'MULTA DE 2,00% A PARTIR DE 19/01/2027',
    'PROTESTO: A partir de 25/01/2027',
    'Receber até 15 dias após o vencimento'
  ]);

  const semNada = c.encargos({ valor: 100, vencimento: '2026-10-10', cfg: { juros_tipo: 'sem', multa_percentual: 0, dias_limite_recebimento: 0 } });
  assert.equal(semNada.juros, null);
  assert.equal(semNada.multa, null);
  assert.deepEqual(semNada.instrucoes, []);

  const mensal = c.encargos({ valor: 100, vencimento: '2026-10-10', cfg: { juros_tipo: 'percentual_mes', juros_percentual_mes: 1, multa_percentual: 0, desconto_percentual: 5, desconto_dias: 3, dias_limite_recebimento: 0 } });
  assert.equal(mensal.juros.tipo, 'percentual_mes');
  assert.deepEqual(mensal.desconto, { percentual: 5, valor: 5, ate: '2026-10-07' });
  assert.deepEqual(mensal.instrucoes, ['JUROS DE 1,00% AO MÊS A PARTIR DE 11/10/2026', 'DESCONTO DE 5,00 ATÉ 07/10/2026']);
});
