/**
 * Só para os testes da fase C: PDFs de mentira do Rende Fácil e do CDB DI
 * (dados que fecham ao centavo), montados como texto posicionado — o leitor
 * lê pela posição, como nos PDFs de verdade do BB.
 */

/**
 * Um PDF de texto (Helvetica, WinAnsi) com cada pedaço na posição dada. `y`
 * é medido de cima, como se lê; com `invertido`, o PDF fica com o eixo y
 * crescendo para baixo (como o navegador imprime).
 */
function pdfDeTexto(pecas, { invertido = false, altura = 842 } = {}) {
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const conteudo = Buffer.from(pecas.map(p => `BT /F1 9 Tf 1 0 0 1 ${p.x} ${invertido ? p.y : altura - p.y} Tm (${esc(p.texto)}) Tj ET`).join('\n'), 'latin1');
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
      + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n'
      + `4 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`, 'latin1'),
    conteudo,
    Buffer.from('\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF', 'latin1')
  ]);
}

/** O PDF do Rende Fácil de setembro (dados de mentira, que fecham ao centavo). */
function pdfRendeFacil({ saldoFinal = '701,55', invertido = true } = {}) {
  const pecas = [{ x: 120, y: 60, texto: 'BB RENDE FÁCIL' }, { x: 40, y: 100, texto: 'Agência' }, { x: 400, y: 100, texto: 'Conta' },
    { x: 40, y: 115, texto: '1614-4' }, { x: 400, y: 115, texto: '16773-8' }, { x: 16, y: 150, texto: 'Resumo do mês - Setembro/2026' }];
  const resumo = [['Saldo bruto em 31/08/2026', 'R$ 1.000,50'], ['Aplicações no mês:', 'R$ 500,00'], ['Resgates líquidos no mês:', 'R$ 800,15'], ['IR sobre resgates no mês:', 'R$ 0,30'],
    ['IOF sobre resgates no mês:', 'R$ 0,10'], ['Rendimentos no mês:', 'R$ 1,60'], ['Saldo bruto em 30/09/2026:', `R$ ${saldoFinal}`]];
  resumo.forEach(([r, v], i) => pecas.push({ x: 28, y: 170 + i * 15, texto: r }, { x: 700, y: 170 + i * 15, texto: v }));
  const xs = [28, 181, 363, 529, 699, 809, 919];
  ['Data', 'Histórico', 'Capital', 'Rendimento*', 'IR', 'IOF', 'Valor Líquido'].forEach((t, i) => pecas.push({ x: xs[i], y: 300, texto: t }));
  const linhas = [
    ['31/08/2026', 'Saldo Anterior', '1.000,00', '0,50', '0,00', '0,00', '0,00'],
    ['04/09/2026', 'Resgate', '300,00', '0,40', '0,10', '0,05', '300,25'],
    ['04/09/2026', 'Resgate', '199,00', '0,60', '0,10', '0,05', '199,45'],
    ['10/09/2026', 'Aplicação', '500,00', '0,00', '0,00', '0,00', '500,00'],
    ['20/09/2026', 'Resgate', '300,00', '0,55', '0,10', '0,00', '300,45'],
    ['30/09/2026', 'Saldo Final', '701,00', '0,55', '0,00', '0,00', '0,00']
  ];
  linhas.forEach((l, k) => l.forEach((t, i) => pecas.push({ x: xs[i], y: 320 + k * 15, texto: i >= 2 ? `R$ ${t}` : t })));
  return pdfDeTexto(pecas, { invertido });
}

/** O PDF do CDB DI de setembro (dados de mentira). */
function pdfCdb({ capitalFinal = '11.500,00' } = {}) {
  const linhas = ['Extratos - CDB / RDB e BB Reaplic', 'Dados consultados', ['Agência', '1614-4'], ['Conta', '16773-8 SANTISSIMO DECOR LTDA'], ['Período', '01/09/2026 a 30/09/2026'], 'BB CDB DI',
    'Data Dt.proc Histórico Nr.depósito Valor', '01/09 Saldo anterior', 'valor capital 10.000,00', '15/09 Aplicação - 1234567890123', 'valor capital 2.000,00',
    '21/09 Resgate - 1111111111111', 'valor capital 500,00', 'valor juros até mês ant 41,08', 'valor juros no mês 3,72', 'valor IR 8,96-', 'valor líquido 535,84',
    '30/09 Rendimento mensal - 1111111111111', 'valor juros 315,00', '30/09 Saldo final', `valor capital ${capitalFinal}`,
    'SALDO NOS ULTIMOS 6 MESES', 'Data Capital em ser Juros IR proj. Liquid.proj.', '30/09/2026 11500,00 900,00 150,00 12250,00', '31/08/2026 10000,00 600,00 120,00 10480,00',
    'RESUMO DOS DEPOSITOS EM SER', 'Numero Dt.aplic Capital Inicial Saldo de Capital Taxa Dt.vcto',
    '1111111111111 10/01/2026 10.000,00 9.500,00 98,00 10/01/2028', '1234567890123 15/09/2026 2.000,00 2.000,00 98,00 15/09/2028',
    'RENDIMENTO BRUTO NO PERIODO POR DEPOSITO', 'Data Nr. depósito Rend.bruto', '30/09 1111111111111 900,00'];
  const pecas = [];
  linhas.forEach((l, k) => {
    if (Array.isArray(l)) pecas.push({ x: 56, y: 40 + k * 14, texto: l[0] }, { x: 131, y: 40 + k * 14, texto: l[1] });
    else pecas.push({ x: 56, y: 40 + k * 14, texto: l });
  });
  return pdfDeTexto(pecas);
}

module.exports = { pdfDeTexto, pdfRendeFacil, pdfCdb };
