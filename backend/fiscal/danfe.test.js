/**
 * DANFE (backend/fiscal/danfe.js): código de barras Code 128 C, leitura do
 * nfeProc e a página em HTML com os blocos do leiaute e as marcas d'água.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const danfe = require('./danfe');
const xmlNfe = require('./xmlNfe');
const sefaz = require('./sefazCliente');

const CONFIG = {
  cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', inscricao_estadual: '0041842150081', logradouro: 'Av. Abílio Machado', numero: '1264',
  complemento: 'Sala 611', bairro: 'Inconfidência', codigo_municipio: '3106200', municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', telefone: '3133574894', crt: 1,
  natureza_operacao: 'Venda de produtos de fabricação própria', cfop_dentro_uf: '5101', cfop_fora_uf: '6101', csosn: '101', pcred_sn: 2.33, pis_cst: '07', cofins_cst: '07', unidade_padrao: 'Peça', modalidade_frete_padrao: 4
};
const CLIENTE = {
  id: 7, razao_social: 'Cliente & Filhos LTDA', tipo_pessoa: 'PJ', cnpj: '11222333000181', inscricao_estadual: '0628725380094', indicador_ie: 1,
  reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'MG', reg_cep: '32113000', reg_codigo_municipio: '3118601', email_nfe: 'nf@cliente.com'
};
const PEDIDO = { id: 55, numero: '2548', forma_pagamento: 'Boleto', transportadora: 'Transportes Rápido' };
const ITENS = [
  { id: 1, produto_id: 3, codigo: 'MESA-01', nome: 'Mesa <Luxo> 2m', ncm: '94036000', quantidade: 2, valor_unitario: 147, valor_total: 294 },
  { id: 2, produto_id: 4, codigo: 'CAD-02', nome: 'Cadeira', ncm: '94016100', quantidade: 3, valor_unitario: 100, valor_total: 270 }
];
const PRODUTOS = [{ id: 3, ncm: '94036000', origem_mercadoria: 0 }, { id: 4, ncm: '94016100', origem_mercadoria: 0, unidade_comercial: 'UN', csosn: '102' }];
const PARCELAS = [{ numero_parcela: 1, valor: 282, data_vencimento: '2026-10-14' }, { numero_parcela: 2, valor: 282, data_vencimento: '2026-11-13' }];

function nfeProcDeTeste({ ambiente = 'homologacao' } = {}) {
  const montada = xmlNfe.montarNfe({
    configuracao: CONFIG, ambiente, serie: 1, numero: 362, cNF: '14000305', dhEmi: new Date('2026-09-15T15:00:00-03:00'),
    pedido: PEDIDO, cliente: CLIENTE, itens: ITENS, produtos: PRODUTOS, parcelas: PARCELAS,
    transporte: { modalidade_frete: 1, volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: 12.5, peso_liquido: 11 }, verProc: 'Santissimo 1.1.1'
  });
  const assinada = montada.xml.replace('</infNFe></NFe>', '</infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></NFe>');
  const prot = `<protNFe versao="4.00"><infProt Id="ID131260000123456"><tpAmb>2</tpAmb><verAplic>MG</verAplic><chNFe>${montada.chave}</chNFe><dhRecbto>2026-09-15T15:10:01-03:00</dhRecbto><nProt>131260000123456</nProt><digVal>x=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  return { xml: sefaz.montarNfeProc(assinada, prot), chave: montada.chave };
}

test('Code 128 C: 107 padrões com 11 módulos (13 no stop), Start C, dígito de controle e Stop no SVG', () => {
  assert.equal(danfe.CODE128.length, 107);
  danfe.CODE128.forEach((p, i) => assert.equal([...p].reduce((s, c) => s + Number(c), 0), i === 106 ? 13 : 11, `padrão ${i}`));

  // "10" -> [Start C=105, 10, controle=(105 + 10*1) % 103 = 12, Stop=106]
  const svg = danfe.codigoDeBarrasSvg('10', { modulo: 1 });
  const larguras = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
  const barras = padrao => [...padrao].filter((_, i) => i % 2 === 0).map(Number);
  const esperadas = [...barras(danfe.CODE128[105]), ...barras(danfe.CODE128[10]), ...barras(danfe.CODE128[12]), ...barras(danfe.CODE128[106])];
  assert.deepEqual(larguras.map(([, w]) => w), esperadas);
  assert.equal(larguras[0][0], 0);
  assert.equal(larguras[1][0], 2 + 1, 'a segunda barra começa depois da primeira barra (2) e do primeiro espaço (1)');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="46\.00" height="44"/, '11+11+11+13 módulos');
  assert.throws(() => danfe.codigoDeBarrasSvg('123'), /quantidade par/);
});

test('lerNfe tira do nfeProc o que o DANFE mostra (emitente, destinatário, itens, totais, transporte, duplicatas, protocolo)', () => {
  const { xml, chave } = nfeProcDeTeste();
  const n = danfe.lerNfe(xml);
  assert.equal(n.chave, chave);
  assert.equal(n.ambiente, 'homologacao');
  assert.equal(n.numero, '362');
  assert.equal(n.serie, '1');
  assert.equal(n.emitente.nome, 'SANTÍSSIMO DECOR LTDA');
  assert.equal(n.emitente.fone, '3133574894');
  assert.equal(n.destinatario.nome, 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
  assert.equal(n.destinatario.cnpj, '11222333000181');
  assert.equal(n.destinatario.municipio, 'Contagem');
  assert.equal(n.itens.length, 2);
  assert.deepEqual(n.itens.map(i => [i.codigo, i.descricao, i.cst, i.cfop, i.unidade, i.total]), [
    ['MESA-01', 'Mesa <Luxo> 2m', '0101', '5101', 'Peça', '294.00'], ['CAD-02', 'Cadeira', '0102', '5101', 'UN', '300.00']
  ]);
  assert.equal(n.itens[1].desconto, '30.00');
  assert.equal(n.totais.vNF, '564.00');
  assert.equal(n.totais.vDesc, '30.00');
  assert.equal(n.transporte.modFrete, '1');
  assert.equal(n.transporte.nome, 'Transportes Rápido');
  assert.equal(n.transporte.qVol, '2');
  assert.equal(n.transporte.pesoB, '12.500');
  assert.deepEqual(n.duplicatas.map(d => [d.numero, d.vencimento, d.valor]), [['001', '2026-10-14', '282.00'], ['002', '2026-11-13', '282.00']]);
  assert.equal(n.protocolo.numero, '131260000123456');
  assert.match(n.infCpl, /SIMPLES NACIONAL/);
  assert.throws(() => danfe.lerNfe('<x/>'), /sem infNFe/);
});

test('montarDanfeHtml: página A4 retrato com os blocos, a chave formatada, o código de barras e o texto escapado', () => {
  const { xml, chave } = nfeProcDeTeste();
  const html = danfe.montarDanfeHtml(xml);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.match(html, /@page \{ size: A4 portrait/);
  for (const bloco of ['DANFE', 'Documento Auxiliar da Nota Fiscal Eletrônica', 'Destinatário / Remetente', 'Fatura / Duplicatas', 'Cálculo do imposto', 'Transportador / Volumes transportados', 'Dados dos produtos / serviços', 'Dados adicionais']) {
    assert.ok(html.includes(bloco), `sem o bloco ${bloco}`);
  }
  assert.ok(html.includes(chave.replace(/(\d{4})(?=\d)/g, '$1 ')), 'chave em grupos de 4');
  assert.ok(html.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'código de barras');
  assert.ok(html.includes('Nº 000.000.362'));
  assert.ok(html.includes('SÉRIE 1'));
  assert.ok(html.includes('1 - SAÍDA'));
  assert.ok(html.includes('131260000123456 - 15/09/2026 15:10:01'), 'protocolo e data');
  assert.ok(html.includes('Mesa &lt;Luxo&gt; 2m'), 'texto do item escapado');
  assert.ok(html.includes('11.222.333/0001-81'));
  assert.ok(html.includes('1 - Destinatário (FOB)'));
  assert.ok(html.includes('564,00') && html.includes('30,00'));
  assert.ok(html.includes('<div class="marca">SEM VALOR FISCAL</div>'), 'homologação estampa a marca');
  assert.ok(!html.includes('NF-e CANCELADA'));
  assert.equal((html.match(/<tr>\s*<td>/g) || []).length, 2, 'um <tr> por item');

  const cancelada = danfe.montarDanfeHtml(nfeProcDeTeste({ ambiente: 'producao' }).xml, { cancelada: true });
  assert.ok(cancelada.includes('<div class="marca">NF-e CANCELADA</div>'));
  assert.ok(!cancelada.includes('SEM VALOR FISCAL'));
  const producao = danfe.montarDanfeHtml(nfeProcDeTeste({ ambiente: 'producao' }).xml);
  assert.ok(!producao.includes('class="marca"'), 'produção sem marca d\'água');
  assert.ok(producao.includes('Cliente &amp; Filhos LTDA'));
});
