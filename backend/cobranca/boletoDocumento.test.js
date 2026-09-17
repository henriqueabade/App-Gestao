/**
 * Boleto em PDF (backend/cobranca/boletoDocumento.js): o código de barras
 * ITF-25 é DECODIFICADO de volta a partir do SVG (conferência independente
 * da tabela), e a página traz o que o boleto real de 15/09/2026 traz —
 * linha digitável, agência/código, nosso número, valores, instruções, Pix —
 * com a marca da homologação e os estados que não se imprimem.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const doc = require('./boletoDocumento');

const BARRAS_REAIS = '00191169500003327000000003453481000000039317';
const CFG = {
  beneficiario_nome: 'SANTISSIMO DECOR LTDA', beneficiario_cnpj: '44039257000122', beneficiario_endereco: 'RUA RUBI 150 - SAO JOAQUIM',
  beneficiario_cep: '32113270', beneficiario_cidade: 'CONTAGEM', beneficiario_uf: 'MG',
  agencia: '1614', agencia_dv: '4', conta: '16773', conta_dv: '8', convenio: '3453481', carteira: 17, variacao: 19, especie: 'DM', aceite: false,
  mensagem_boleto: null
};
const BOLETO = {
  id: 7, status: 'registrado', ambiente: 'producao', numero_parcela: 1, convenio: '3453481', carteira: 17, sequencial: 393,
  nosso_numero: '00034534810000000393', nosso_numero_dv: '4', numero_documento: '40F', valor: '3327.00',
  data_emissao: '2026-09-15', data_vencimento: '2027-01-18T00:00:00.000Z', linha_digitavel: null, codigo_barras: null,
  pagador: { nome: 'ESTUDIO SOMBRA - ESTUDIO DE DESIGN LTDA', documento: '57248237000103', endereco: 'AVENIDA DO ESTADO DALMO VIEIRA, 4770, S', bairro: '', cidade: 'BALNEARIO CAMBORIU', uf: 'SC', cep: '88339060' },
  instrucoes: ['JRS: Vl p/Dia Atraso R$9,98 A PARTIR DE 19/01/27', 'MULTA DE 2,00% A PARTIR DE 19/01/2027', 'PROTESTO: A partir de 25/01/2027', 'Receber até 15 dias após o vencimento'],
  pix_emv: '00020101021226870014br.gov.bcb.pix2565qrcodepix.bb.com.br/pix/v2/teste5204000053039865406327.005802BR5913SANTISSIMO6008CONTAGEM62070503***6304ABCD'
};

/** Lê o SVG do ITF-25 de volta: larguras de barras e espaços → dígitos. */
function decodificarItf(svg) {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].map(m => ({ x: Number(m[1]), w: Number(m[2]) }));
  const elementos = [];
  let cursor = 0;
  for (const r of rects) {
    if (r.x > cursor) elementos.push(r.x - cursor); // espaço
    elementos.push(r.w); // barra
    cursor = r.x + r.w;
  }
  const larg = elementos.map(w => (w > 1.5 ? 'W' : 'N'));
  assert.equal(larg.slice(0, 4).join(''), 'NNNN', 'início do ITF');
  assert.equal(larg.slice(-3).join(''), 'WNN', 'fim do ITF');
  const miolo = larg.slice(4, -3);
  assert.equal(miolo.length % 10, 0);
  const tabela = Object.fromEntries(doc.ITF_DIGITOS.map((p, i) => [p, String(i)]));
  let saida = '';
  for (let i = 0; i < miolo.length; i += 10) {
    const bloco = miolo.slice(i, i + 10);
    const barras = bloco.filter((_, k) => k % 2 === 0).join('');
    const espacos = bloco.filter((_, k) => k % 2 === 1).join('');
    assert.ok(tabela[barras] !== undefined && tabela[espacos] !== undefined, `par inválido em ${i}`);
    saida += tabela[barras] + tabela[espacos];
  }
  return saida;
}

test('ITF-25: o SVG decodifica de volta nos 44 dígitos do boleto real; cada dígito tem 2 largos em 5; ímpar é recusado', () => {
  const svg = doc.itf25Svg(BARRAS_REAIS);
  assert.equal(decodificarItf(svg), BARRAS_REAIS);
  assert.equal(decodificarItf(doc.itf25Svg('0123456789')), '0123456789');
  for (const p of doc.ITF_DIGITOS) assert.equal([...p].filter(c => c === 'W').length, 2, `padrão ${p}`);
  assert.equal(new Set(doc.ITF_DIGITOS).size, 10);
  assert.equal(doc.itf25Padrao('12'), 'nnnnWnNwNnNnWwWnn');
  // 44 dígitos: 4 do início + 22 pares × (2×2 largos×3 + 3×2 estreitos) + fim (3+1+1) = 4 + 22×18 + 5.
  assert.match(svg, /viewBox="0 0 405 50"/);
  assert.throws(() => doc.itf25Svg('123'), /quantidade par/);
});

test('dados do boleto: linha digitável e barras calculadas quando o BB não devolveu; agência/código com dígitos; instruções sem a regra interna', () => {
  const d = doc.dadosDoBoleto(BOLETO, CFG);
  assert.equal(d.barras, BARRAS_REAIS);
  assert.equal(d.linha, '00190.00009 03453.481008 00000.393173 1 16950000332700');
  assert.equal(d.agenciaCodigo, '1614-4/16773-8');
  assert.equal(d.nossoNumero, '00034534810000000393-4');
  assert.equal(d.vencimento, '18/01/2027');
  assert.equal(d.emissao, '15/09/2026');
  assert.equal(d.valor.replace(/ /g, ' '), '3.327,00');
  assert.equal(d.carteira, '17');
  assert.equal(d.especieDoc, 'DM');
  assert.equal(d.aceite, 'N');
  assert.deepEqual(d.instrucoes, ['JRS: Vl p/Dia Atraso R$9,98 A PARTIR DE 19/01/27', 'MULTA DE 2,00% A PARTIR DE 19/01/2027', 'PROTESTO: A partir de 25/01/2027']);
  assert.equal(d.beneficiario.documento, '44.039.257/0001-22');
  assert.equal(d.beneficiario.cidade, 'CEP: 32113-270, CONTAGEM - MG');
  assert.equal(d.pagador.documento, '57.248.237/0001-03');
  assert.equal(d.pagador.rotulo, 'CNPJ');
  assert.equal(d.pagador.cidade, 'CEP: 88339-060, BALNEARIO CAMBORIU - SC');
  assert.equal(d.marca, '');
  assert.equal(d.nomeArquivo, 'Boleto-40F-00034534810000000393');

  // O que o BB devolveu vale mais que a conta.
  const doBB = doc.dadosDoBoleto({ ...BOLETO, linha_digitavel: 'LINHA DO BB', codigo_barras: '0019'.padEnd(44, '1') }, CFG);
  assert.equal(doBB.linha, 'LINHA DO BB');
  assert.equal(doBB.barras, '0019'.padEnd(44, '1'));

  // Homologação: conta de teste sem dígito e a marca; mensagem da configuração vai nas instruções; CPF no pagador.
  const hm = doc.dadosDoBoleto({ ...BOLETO, ambiente: 'sandbox', pagador: { ...BOLETO.pagador, documento: '12345678909' } }, { ...CFG, mensagem_boleto: 'PEDIDO DE OUTUBRO' });
  assert.equal(hm.agenciaCodigo, '452/123873');
  assert.equal(hm.marca, 'HOMOLOGAÇÃO — SEM VALOR');
  assert.equal(hm.instrucoes.at(-1), 'PEDIDO DE OUTUBRO');
  assert.equal(hm.pagador.rotulo, 'CPF');
  assert.equal(hm.pagador.documento, '123.456.789-09');

  assert.equal(doc.dadosDoBoleto({ ...BOLETO, status: 'pago' }, CFG).marca, 'PAGO');
  assert.equal(doc.dadosDoBoleto({ ...BOLETO, status: 'baixado' }, CFG).marca, 'BAIXADO');
  assert.throws(() => doc.dadosDoBoleto({ ...BOLETO, status: 'erro' }, CFG), e => e.status === 409 && /ainda não foi registrado no BB/.test(e.message));
  assert.throws(() => doc.dadosDoBoleto({ ...BOLETO, status: 'reservado' }, CFG), e => e.status === 409);
  assert.throws(() => doc.dadosDoBoleto(null, CFG), e => e.status === 404);
  // Instruções gravadas como texto JSON (coluna JSONB lida como texto).
  assert.equal(doc.dadosDoBoleto({ ...BOLETO, instrucoes: JSON.stringify(['A', 'Receber até 15 dias após o vencimento']) }, CFG).instrucoes.join('|'), 'A');
});

test('HTML: recibo do pagador e ficha de compensação com o conteúdo do boleto real, QR do Pix, uma página por boleto e nada de dado sem escapar', async () => {
  const { html, dados } = await doc.gerarBoletosHtml(BOLETO, CFG);
  assert.equal(dados.length, 1);
  for (const trecho of ['Pague agora com o seu Pix', 'Recibo do Pagador', 'BANCO DO BRASIL', '001-9', '00190.00009 03453.481008 00000.393173 1 16950000332700',
    'Nome do Pagador / Endereço', 'ESTUDIO SOMBRA - ESTUDIO DE DESIGN LTDA', '57.248.237/0001-03', 'Data de Vencimento', '18/01/2027',
    'Agência / Código do Beneficiário', '1614-4/16773-8', 'Nosso Número', '00034534810000000393-4', '(=) Valor do Documento',
    'Nr. do Documento', '40F', 'Espécie Doc.', 'Aceite', 'Data Processamento', '15/09/2026', '(=) Valor Pago', 'Autenticação Mecânica',
    'Local do Pagamento', 'Pagar preferencialmente nos canais de autoatendimento do Banco do Brasil', 'Carteira', 'Informações de responsabilidade do Beneficiário',
    'JRS: Vl p/Dia Atraso R$9,98 A PARTIR DE 19/01/27', 'MULTA DE 2,00% A PARTIR DE 19/01/2027', 'PROTESTO: A partir de 25/01/2027',
    '(-) Abatimento', '(+) Juros / Multa', '(=) Valor Cobrado', 'Beneficiário Final', 'Autenticação Mecânica - Ficha de Compensação',
    'SANTISSIMO DECOR LTDA', 'RUA RUBI 150 - SAO JOAQUIM', 'CEP: 32113-270, CONTAGEM - MG', '@page { size: A4 portrait']) {
    assert.ok(html.includes(trecho), `HTML sem "${trecho}"`);
  }
  assert.ok(!html.includes('Receber até 15 dias'), 'a regra de recebimento não sai impressa');
  assert.equal((html.match(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="405"/g) || []).length, 1, 'um código de barras');
  assert.match(html, /<div class="qr"><svg/, 'QR Code do Pix');
  assert.ok(!html.includes('class="marca"'), 'produção sem marca');

  // Dois boletos: duas páginas; sem Pix, sem o bloco do Pix; nome com HTML é escapado.
  const outro = { ...BOLETO, id: 8, numero_parcela: 2, numero_documento: '40FP2', pix_emv: null, pagador: { ...BOLETO.pagador, nome: '<b>X & Y</b>' } };
  const dois = await doc.gerarBoletosHtml([BOLETO, outro], CFG);
  assert.equal((dois.html.match(/<section class="pagina">/g) || []).length, 2);
  assert.equal((dois.html.match(/Pague agora com o seu Pix/g) || []).length, 1);
  assert.ok(dois.html.includes('&lt;b&gt;X &amp; Y&lt;/b&gt;') && !dois.html.includes('<b>X & Y</b>'));
  assert.match(dois.html, /<title>Boletos 40F, 40FP2<\/title>/);

  const hm = await doc.gerarBoletosHtml({ ...BOLETO, ambiente: 'sandbox' }, CFG);
  assert.match(hm.html, /<div class="marca">HOMOLOGAÇÃO — SEM VALOR<\/div>/);
  assert.throws(() => doc.montarBoletosHtml([], CFG), e => e.status === 404);
  assert.equal(await doc.qrPixSvg(''), '');
});
