/**
 * Fase G — faturas de mentira no layout do XLSX do cartão do BB (aba
 * "Extrato", 4 colunas de texto), para os testes. Dados inventados.
 */
const reais = v => {
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};
/** "ESTABELECIMENTO" (23) + "CIDADE" (14), como o BB alinha. */
const desc = (loja, cidade = 'BELO HORIZONT') => `${loja.padEnd(23).slice(0, 23)}${cidade.padEnd(14).slice(0, 14)}`;
const parc = (loja, n, de, cidade = 'BELO HORIZONT') => `${loja.padEnd(13).slice(0, 13)} PARC ${String(n).padStart(2, '0')}/${String(de).padStart(2, '0')} ${cidade}`.slice(0, 37).padEnd(37);

const COMPRAS_PADRAO = [
  ['15/08', desc('PADARIA PAO QUENTE'), 18.5],
  ['20/08', desc('KALUNGA LOJA 12', 'CONTAGEM'), 320],
  ['02/09', desc('LEROY MERLIN BH'), 150],
  ['05/09', desc('IOF COMPRA EXTERIOR', ''), 3.2],
  ['06/09', desc('ESTORNO KALUNGA', 'CONTAGEM'), -20]
];
const SUPERMERCADOS_PADRAO = [['25/08', desc('SUPERMERCADO BH', 'CONTAGEM'), 45]];
const PARCELADAS_PADRAO = [['10/06', parc('TOK STOK', 3, 10), 99.9]];

/**
 * As linhas da fatura. `total` muda o "Valor Total" do cabeçalho (para a que
 * não fecha); o resto sai das compras.
 */
function linhasDaFatura({
  vencimento = '12/09/2026', saldoAnterior = 1000, pagamento = -1000, compras = COMPRAS_PADRAO, supermercados = SUPERMERCADOS_PADRAO,
  parceladas = PARCELADAS_PADRAO, total = null, final = '9876', cliente = 'FULANO DE TAL'
} = {}) {
  const lancamentos = [...compras, ...supermercados, ...parceladas];
  const subtotal2 = Math.round(lancamentos.reduce((s, l) => s + l[2], 0) * 100) / 100;
  const valorTotal = total ?? Math.round((saldoAnterior + pagamento + subtotal2) * 100) / 100;
  const linha = (a = '', b = '', c = '', d = '') => [a, b, c, d];
  return [
    linha('Razao Social', 'EMPRESA TESTE LTDA'), linha('Nome Cliente', cliente), linha('Centro de Custo', '000-000 ADMINISTRATIVO'),
    linha('Cartao', `498412341234${final}`), linha('Limite Empresa', '10.000,00'), linha('Data Vencimento', vencimento),
    linha('Valor Pagamento Minimo', reais(valorTotal * 0.15)), linha('Valor Total', reais(valorTotal)), linha(),
    linha('Data', 'Lancamentos', '', 'Valor'), linha('', '', '', ''), linha('', '0-EMPRESA TESTE LT'),
    linha('', 'SALDO FATURA ANTERIOR', 'R$', reais(saldoAnterior)), linha('', 'Pagamentos/Créditos'),
    linha('12/08', 'PGTO. COBRANCA    4700 000000200  2003', 'R$', reais(pagamento)), linha('', 'SubTotal', '', reais(saldoAnterior + pagamento)),
    linha('', '', 'US$', '0,00'), linha(), linha('', `0--EMPRESA TESTE LT   Cartão N. ${final}`),
    ...compras.map(([d, t, v]) => linha(d, t, 'R$', reais(v))),
    ...(supermercados.length ? [linha('', 'Supermercados'), ...supermercados.map(([d, t, v]) => linha(d, t, 'R$', reais(v)))] : []),
    ...(parceladas.length ? [linha('', 'Compras parceladas'), ...parceladas.map(([d, t, v]) => linha(d, t, 'R$', reais(v)))] : []),
    linha('', 'SubTotal', '', reais(subtotal2)), linha('', '', 'US$', '0,00'), linha('', 'Total', '', reais(valorTotal)), linha('', '', 'US$', '0,00'), linha('', '', 'US$', '0,00')
  ];
}

/** O XLSX (Buffer) com as linhas, na aba "Extrato", tudo texto. */
async function xlsxDaFatura(opcoes = {}) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Extrato');
  for (const l of linhasDaFatura(opcoes)) ws.addRow(l);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { reais, desc, parc, linhasDaFatura, xlsxDaFatura, COMPRAS_PADRAO, SUPERMERCADOS_PADRAO, PARCELADAS_PADRAO };
