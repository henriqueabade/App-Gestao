/**
 * Leitor de OFX (backend/contabilidade/extrato/ofx.js) e as contas puras do
 * extrato (extrato.js). O que fica preso: o OFX 1.x do jeito do BB (SGML,
 * Windows-1252, tags de valor sem fechamento, linhas de SALDO com zero) e o
 * 2.x (XML); data cortada como texto; valor com ponto ou vírgula; a
 * identidade de cada lançamento (reimportar dá o mesmo hash; linhas iguais
 * no arquivo não se confundem); a conferência da conta; a cobertura do mês.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ofx = require('./ofx');
const ext = require('./extrato');

const SGML_BB = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20260902120000[-3:BRT]
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>1
<BRANCHID>1234-5
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260801
<DTEND>20260831
<STMTTRN>
<TRNTYPE>OTHER
<DTPOSTED>20260801
<TRNAMT>0.00
<FITID>SALDO
<MEMO>Saldo Anterior
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260805120000[-3:BRT]
<TRNAMT>-2500.00
<FITID>202608050001
<CHECKNUM>000123
<MEMO>Pagamento de Boleto - IMOBILI&amp;RIA CENTRO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260810
<TRNAMT>1.500,00
<FITID>202608100002
<NAME>PIX RECEBIDO
<MEMO>CASA VICENZO LTDA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260831
<TRNAMT>-12.90
<MEMO>Tarifa Pacote de Serviços
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260831
<TRNAMT>-12.90
<MEMO>Tarifa Pacote de Serviços
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>10987.10
<DTASOF>20260831
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

const XML2 = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>001</BANKID><BRANCHID>1234</BRANCHID><ACCTID>123456</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260915</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260905</DTPOSTED><TRNAMT>-2500.00</TRNAMT><FITID>X1</FITID><MEMO></MEMO><NAME>Aluguel</NAME></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260910</DTPOSTED><TRNAMT>800.00</TRNAMT><FITID>X2</FITID><MEMO>Pix recebido — Ateliê</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>9287.10</BALAMT><DTASOF>20260915</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('OFX 1.x do BB (SGML, Windows-1252): conta, período, saldo e os lançamentos; a linha de SALDO (zero) sai', () => {
  const lido = ofx.lerOfx(Buffer.from(SGML_BB, 'latin1'));
  assert.equal(lido.versao, '1.x (SGML)');
  const [e] = lido.extratos;
  assert.deepEqual([e.banco, e.agencia, e.conta, e.tipo_conta, e.moeda, e.inicio, e.fim], ['1', '1234-5', '12345-6', 'CHECKING', 'BRL', '2026-08-01', '2026-08-31']);
  assert.deepEqual(e.saldo, { valor: 10987.1, data: '2026-08-31' });
  assert.equal(e.zerados, 1);
  assert.deepEqual(e.lancamentos.map(l => [l.data, l.valor, l.tipo, l.identificador, l.documento]), [
    ['2026-08-05', -2500, 'debito', '202608050001', '000123'],
    ['2026-08-10', 1500, 'credito', '202608100002', null],
    ['2026-08-31', -12.9, 'debito', null, null],
    ['2026-08-31', -12.9, 'debito', null, null]
  ]);
  assert.equal(e.lancamentos[0].descricao, 'Pagamento de Boleto - IMOBILI&RIA CENTRO', 'entidade decodificada');
  assert.equal(e.lancamentos[1].descricao, 'PIX RECEBIDO — CASA VICENZO LTDA', 'NAME + MEMO');
  assert.equal(e.lancamentos[2].descricao, 'Tarifa Pacote de Serviços', 'Windows-1252 lido direito');
});

test('OFX 2.x (XML, UTF-8): tudo fechado, tag vazia não engole a seguinte', () => {
  const [e] = ofx.lerOfx(Buffer.from(XML2, 'utf8')).extratos;
  assert.deepEqual([e.banco, e.agencia, e.conta, e.inicio, e.fim], ['001', '1234', '123456', '2026-09-01', '2026-09-15']);
  assert.deepEqual(e.lancamentos.map(l => [l.data, l.valor, l.descricao]), [['2026-09-05', -2500, 'Aluguel'], ['2026-09-10', 800, 'Pix recebido — Ateliê']]);
});

test('recusa o que não é OFX de conta; data e valor lidos como texto', () => {
  assert.throws(() => ofx.lerOfx(Buffer.from('não sou ofx')), /não é um extrato OFX/);
  assert.throws(() => ofx.lerOfx(Buffer.from('')), /vazio/);
  assert.throws(() => ofx.lerOfx(Buffer.from('<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>')), /cartão de crédito/);
  assert.equal(ofx.dataOfx('20260805120000[-3:BRT]'), '2026-08-05');
  assert.equal(ofx.dataOfx('2026130'), null);
  assert.equal(ofx.valorOfx('-1.234,56'), -1234.56);
  assert.equal(ofx.valorOfx('1,234.56'), 1234.56);
  assert.equal(ofx.valorOfx('12,5'), 12.5);
  assert.equal(ofx.valorOfx('x'), null);
});

test('identidade: reimportar dá o mesmo hash; linhas idênticas no arquivo ganham ordem; a conta entra na conta', () => {
  const [e] = ofx.lerOfx(Buffer.from(SGML_BB, 'latin1')).extratos;
  const a = ofx.comHash(7, e.lancamentos);
  const b2 = ofx.comHash(7, e.lancamentos);
  assert.deepEqual(a.map(l => l.hash), b2.map(l => l.hash));
  assert.equal(new Set(a.map(l => l.hash)).size, 4, 'as duas tarifas iguais são duas linhas');
  assert.notEqual(ofx.comHash(8, e.lancamentos)[0].hash, a[0].hash);
  assert.equal(a[0].hash.length, 64);
});

test('mesmaConta: dígitos com ou sem DV, zeros à esquerda; sem número não dá para dizer', () => {
  assert.equal(ofx.mesmaConta({ agencia: '1234-5', conta: '12345-6' }, { agencia: '1234', agencia_dv: '5', conta: '123456' }), true);
  assert.equal(ofx.mesmaConta({ agencia: '1234', conta: '0000123456' }, { agencia: '1234', conta: '123456' }), true);
  assert.equal(ofx.mesmaConta({ agencia: '1234', conta: '99999-9' }, { agencia: '1234', conta: '123456' }), false);
  assert.equal(ofx.mesmaConta({ agencia: '9999', conta: '123456' }, { agencia: '1234', conta: '123456' }), false);
  assert.equal(ofx.mesmaConta({ conta: null }, { conta: '1' }), null);
});

test('cobertura do mês: o que falta, o mês em curso até ontem, desfeita não conta', () => {
  const imp = (de, ate, status = 'completa') => ({ periodo_inicio: de, periodo_fim: ate, status });
  assert.deepEqual(ext.cobertura([imp('2026-08-01', '2026-08-31')], '2026-08', { hoje: '2026-09-28' }).faltas, []);
  const meio = ext.cobertura([imp('2026-08-01', '2026-08-10'), imp('2026-08-20', '2026-09-05')], '2026-08', { hoje: '2026-09-28' });
  assert.deepEqual(meio.faltas, [{ de: '2026-08-11', ate: '2026-08-19' }]);
  assert.equal(meio.completa, false);
  assert.deepEqual(ext.cobertura([], '2026-08', { hoje: '2026-09-28' }).faltas, [{ de: '2026-08-01', ate: '2026-08-31' }]);
  assert.deepEqual(ext.cobertura([imp('2026-08-01', '2026-08-31', 'desfeita')], '2026-08', { hoje: '2026-09-28' }).completa, false);
  const emCurso = ext.cobertura([imp('2026-09-01', '2026-09-20')], '2026-09', { hoje: '2026-09-28' });
  assert.deepEqual([emCurso.exigido_ate, emCurso.faltas], ['2026-09-27', [{ de: '2026-09-21', ate: '2026-09-27' }]]);
  assert.equal(ext.cobertura([], '2026-09', { hoje: '2026-09-01' }).completa, true, 'no dia 1 ainda não há o que cobrar');
  assert.equal(ext.faixaImpressa({ de: '2026-08-11', ate: '2026-08-19' }), '11/08/2026 a 19/08/2026');
});

test('conta financeira: validação, rótulo e o saldo que o banco informou no mês', () => {
  const conta = ext.validarConta({ nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '1', agencia: '1234', agencia_dv: '5', conta: '12.345-6', saldo_inicial: '1.000,00', saldo_inicial_data: '2026-01-01' });
  assert.deepEqual(conta, { nome: 'BB — conta corrente', tipo: 'corrente', banco_codigo: '001', agencia: '1234', agencia_dv: '5', conta: '123456', saldo_inicial: 1000, saldo_inicial_data: '2026-01-01', ativa: true, observacao: null });
  assert.equal(ext.rotuloDaConta(conta), 'Banco do Brasil · ag. 1234-5 · c/c 123456');
  assert.throws(() => ext.validarConta({ nome: 'X' }), /nome/);
  assert.throws(() => ext.validarConta({ nome: 'BB', tipo: 'corrente' }), /banco, agência e conta/);
  assert.equal(ext.validarConta({ nome: 'Caixa da loja', tipo: 'caixa' }).banco_codigo, null, 'caixa não pede banco');
  assert.throws(() => ext.validarConta({ nome: 'BB', banco_codigo: '001', agencia: '1', conta: '2', saldo_inicial: 10 }), /dia do saldo de abertura/);
  const saldo = ext.saldoDoBanco([
    { id: 1, status: 'completa', saldo_final: '100.00', saldo_final_data: '2026-08-15' },
    { id: 2, status: 'completa', saldo_final: '250.00', saldo_final_data: '2026-08-31' },
    { id: 3, status: 'desfeita', saldo_final: '999.00', saldo_final_data: '2026-08-31' },
    { id: 4, status: 'completa', saldo_final: '300.00', saldo_final_data: '2026-09-05' }
  ], '2026-08');
  assert.deepEqual(saldo, { valor: 250, data: '2026-08-31' });
  assert.deepEqual(ext.totaisDe([{ valor: '100.00' }, { valor: -40 }, { valor: '-10.50' }]), { quantidade: 3, entradas: { quantidade: 1, total: 100 }, saidas: { quantidade: 2, total: -50.5 }, resultado: 49.5 });
});
