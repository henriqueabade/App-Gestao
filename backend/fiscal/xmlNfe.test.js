/**
 * Montagem do XML da NF-e 4.00 (backend/fiscal/xmlNfe.js).
 *
 * A chave de acesso é conferida contra a NF-e real nº 361 da empresa (mesmos
 * cUF, CNPJ, série, número e cNF -> mesma chave e mesmo DV). O resto prende o
 * que a SEFAZ valida: totais que fecham, CFOP por UF, CSOSN 101 com crédito,
 * duplicatas iguais ao total, o nome fixo do destinatário em homologação e a
 * forma canônica (sem tag autofechada, escapes de C14N).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const x = require('./xmlNfe');

const CONFIG = {
  cnpj: '44039257000122', razao_social: 'SANTÍSSIMO DECOR LTDA', nome_fantasia: 'Santíssimo Decor', inscricao_estadual: '0041842150081',
  inscricao_municipal: '1.345.545/001-5', cnae: '3101200', crt: 1, logradouro: 'Av. Abílio Machado', numero: '1264', complemento: 'Sala 611',
  bairro: 'Inconfidência', codigo_municipio: '3106200', municipio: 'Belo Horizonte', uf: 'MG', cep: '30820272', telefone: '(31) 3357-4894',
  natureza_operacao: 'Venda de produtos de fabricação própria', cfop_dentro_uf: '5101', cfop_fora_uf: '6101', csosn: '101', pcred_sn: 2.33,
  pis_cst: '07', cofins_cst: '07', unidade_padrao: 'Peça', modalidade_frete_padrao: 4, informacoes_complementares: 'Pedido sujeito a conferência.'
};
const CLIENTE = {
  id: 7, razao_social: 'Cliente Bom LTDA', tipo_pessoa: 'PJ', cnpj: '11.222.333/0001-81', inscricao_estadual: '0628725380094', indicador_ie: 1,
  reg_logradouro: 'Rua Diamante', reg_numero: '504', reg_bairro: 'São Joaquim', reg_cidade: 'Contagem', reg_uf: 'Minas Gerais',
  reg_cep: '32113-000', reg_codigo_municipio: '3118601', email_nfe: 'fiscal@clientebom.com.br', consumidor_final: false
};
const PEDIDO = { id: 55, numero: '2548', forma_pagamento: 'Boleto', transportadora: 'Transportes Rápido' };
const ITENS = [
  { id: 1, produto_id: 3, codigo: 'OCJP 0000 MDF', nome: 'Corte, Junção e Laminação de Painéis de MDF', ncm: '94036000', quantidade: 2, valor_unitario: '147.00', valor_total: '294.00' }
];
const PRODUTOS = [{ id: 3, codigo: 'OCJP 0000 MDF', ncm: '94036000', origem_mercadoria: 0 }];
const DH = new Date('2026-09-14T16:55:00-03:00');
const PARCELAS_PRAZO = [
  { numero_parcela: 1, valor: 147, data_vencimento: '2026-10-14' },
  { numero_parcela: 2, valor: '147.00', data_vencimento: '2026-11-13T00:00:00.000Z' }
];

const base = (extra = {}) => ({
  configuracao: CONFIG, ambiente: 'homologacao', serie: 1, numero: 361, cNF: '14000305', dhEmi: DH,
  pedido: PEDIDO, cliente: CLIENTE, itens: ITENS, produtos: PRODUTOS, parcelas: PARCELAS_PRAZO, verProc: 'Santissimo 1.1.1', ...extra
});

const entre = (xml, tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? null;

test('chave de acesso e DV batem com a NF-e real nº 361 da empresa', () => {
  const r = x.montarNfe(base());
  assert.equal(r.chave, '31260944039257000122550010000003611140003053');
  assert.equal(r.id, 'NFe31260944039257000122550010000003611140003053');
  assert.equal(x.dvModulo11('3126094403925700012255001000000361114000305'), 3);
  assert.equal(r.dhEmi, '2026-09-14T16:55:00-03:00');
  assert.ok(r.xml.startsWith(`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="${r.id}" versao="4.00"><ide><cUF>31</cUF><cNF>14000305</cNF>`));
  assert.ok(r.xml.endsWith('</infNFe></NFe>'));
});

test('ide, emitente e destinatário: dentro do estado, homologação troca o nome do destinatário', () => {
  const r = x.montarNfe(base());
  const ide = entre(r.xml, 'ide');
  assert.equal(ide, '<cUF>31</cUF><cNF>14000305</cNF><natOp>Venda de produtos de fabricação própria</natOp><mod>55</mod><serie>1</serie><nNF>361</nNF>'
    + '<dhEmi>2026-09-14T16:55:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>3106200</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>3</cDV>'
    + '<tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>0</indPres><procEmi>0</procEmi><verProc>Santissimo 1.1.1</verProc>');
  const emit = entre(r.xml, 'emit');
  assert.equal(emit, '<CNPJ>44039257000122</CNPJ><xNome>SANTÍSSIMO DECOR LTDA</xNome><xFant>Santíssimo Decor</xFant>'
    + '<enderEmit><xLgr>Av. Abílio Machado</xLgr><nro>1264</nro><xCpl>Sala 611</xCpl><xBairro>Inconfidência</xBairro><cMun>3106200</cMun><xMun>Belo Horizonte</xMun>'
    + '<UF>MG</UF><CEP>30820272</CEP><cPais>1058</cPais><xPais>BRASIL</xPais><fone>3133574894</fone></enderEmit>'
    + '<IE>0041842150081</IE><IM>1.345.545/001-5</IM><CNAE>3101200</CNAE><CRT>1</CRT>');
  const dest = entre(r.xml, 'dest');
  assert.equal(dest, '<CNPJ>11222333000181</CNPJ><xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>'
    + '<enderDest><xLgr>Rua Diamante</xLgr><nro>504</nro><xBairro>São Joaquim</xBairro><cMun>3118601</cMun><xMun>Contagem</xMun><UF>MG</UF><CEP>32113000</CEP>'
    + '<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>1</indIEDest><IE>0628725380094</IE><email>fiscal@clientebom.com.br</email>');
  assert.equal(r.destinatario.nome, 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');

  const prod = x.montarNfe(base({ ambiente: 'producao', cliente: { ...CLIENTE, consumidor_final: true } }));
  assert.match(prod.xml, /<tpAmb>1<\/tpAmb><finNFe>1<\/finNFe><indFinal>1<\/indFinal>/);
  assert.match(prod.xml, /<xNome>Cliente Bom LTDA<\/xNome>/);
  assert.equal(prod.destinatario.nome, 'Cliente Bom LTDA');
});

test('item igual ao da nota real: quantidades, unitário com 10 casas, CSOSN 101 com crédito de 2,33% e PIS/COFINS NT', () => {
  const r = x.montarNfe(base());
  const det = /<det nItem="1">([\s\S]*?)<\/det>/.exec(r.xml)[1];
  assert.equal(det, '<prod><cProd>OCJP 0000 MDF</cProd><cEAN>SEM GTIN</cEAN><xProd>Corte, Junção e Laminação de Painéis de MDF</xProd><NCM>94036000</NCM><CFOP>5101</CFOP>'
    + '<uCom>Peça</uCom><qCom>2.0000</qCom><vUnCom>147.0000000000</vUnCom><vProd>294.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>Peça</uTrib><qTrib>2.0000</qTrib>'
    + '<vUnTrib>147.0000000000</vUnTrib><indTot>1</indTot></prod>'
    + '<imposto><ICMS><ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.33</pCredSN><vCredICMSSN>6.85</vCredICMSSN></ICMSSN101></ICMS>'
    + '<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto>');
  assert.equal(entre(r.xml, 'ICMSTot'), '<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST>'
    + '<vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>294.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI>'
    + '<vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>294.00</vNF>');
  assert.deepEqual(r.totais, { valor_produtos: 294, valor_desconto: 0, valor_frete: 0, valor_total: 294, credito_sn: 6.85 });
  assert.equal(r.itens[0].numero_item, 1);
  assert.equal(r.itens[0].valor_credito_sn, 6.85);
  assert.equal(r.itens[0].gtin, null);
  assert.match(entre(r.xml, 'infCpl'), /SIMPLES NACIONAL.*CREDITO DE ICMS NO VALOR DE R\$ 6,85, CORRESPONDENTE A ALIQUOTA DE 2,33%.*Pedido sujeito a conferência\./);
});

test('desconto do pedido vira vDesc do item e os totais fecham; frete entra no vNF', () => {
  const itens = [
    ITENS[0],
    { id: 2, produto_id: 4, codigo: 'CAD-02', nome: 'Cadeira', ncm: '94016100', quantidade: 3, valor_unitario: 100, valor_total: 270, desconto_total: 30 }
  ];
  const produtos = [...PRODUTOS, { id: 4, codigo: 'CAD-02', ncm: '94016100', origem_mercadoria: 0, gtin: '7891234567890', cest: '1234567', unidade_comercial: 'UN', csosn: '102' }];
  const parcelas = [{ numero_parcela: 1, valor: 584, data_vencimento: '2026-10-14' }];
  const r = x.montarNfe(base({ itens, produtos, parcelas, transporte: { valor_frete: '20,00', modalidade_frete: 1, volumes_quantidade: 2, volumes_especie: 'Caixa', peso_bruto: 12.5, peso_liquido: 11 } }));
  const det2 = /<det nItem="2">([\s\S]*?)<\/det>/.exec(r.xml)[1];
  assert.match(det2, /<cEAN>7891234567890<\/cEAN>.*<CEST>1234567<\/CEST><CFOP>5101<\/CFOP><uCom>UN<\/uCom><qCom>3\.0000<\/qCom><vUnCom>100\.0000000000<\/vUnCom><vProd>300\.00<\/vProd>/);
  assert.match(det2, /<vDesc>30\.00<\/vDesc><indTot>1<\/indTot>/);
  assert.match(det2, /<ICMSSN102><orig>0<\/orig><CSOSN>102<\/CSOSN><\/ICMSSN102>/);
  assert.match(entre(r.xml, 'ICMSTot'), /<vProd>594\.00<\/vProd><vFrete>20\.00<\/vFrete><vSeg>0\.00<\/vSeg><vDesc>30\.00<\/vDesc>.*<vNF>584\.00<\/vNF>/);
  assert.deepEqual(r.totais, { valor_produtos: 594, valor_desconto: 30, valor_frete: 20, valor_total: 584, credito_sn: 6.85 });
  assert.equal(entre(r.xml, 'transp'), '<modFrete>1</modFrete><transporta><xNome>Transportes Rápido</xNome></transporta><vol><qVol>2</qVol><esp>Caixa</esp><marca>Santíssimo Decor SD</marca><nVol>361_1/2 a 361_2/2</nVol><pesoL>11.000</pesoL><pesoB>12.500</pesoB></vol>');
  assert.equal(r.itens[1].valor_desconto, 30);
  assert.equal(r.itens[1].valor_total, 270);
  assert.equal(r.itens[1].gtin, '7891234567890');
});

test('volumes detalhados: um <vol> por linha, numerado "nota_caixa/total", com a marca "fantasia SD" (ou a informada); sem fantasia usa a razão social', () => {
  const r = x.montarNfe(base({ transporte: { modalidade_frete: 1, volumes: [
    { especie: 'Caixa', peso_bruto: '10,5', peso_liquido: 9 }, { especie: 'Engradado', peso_bruto: 20, peso_liquido: 18, numeracao: 'B-2' }, { especie: 'Caixa', quantidade: 2 }
  ] } }));
  assert.equal(entre(r.xml, 'transp'), '<modFrete>1</modFrete><transporta><xNome>Transportes Rápido</xNome></transporta>'
    + '<vol><qVol>1</qVol><esp>Caixa</esp><marca>Santíssimo Decor SD</marca><nVol>361_1/4</nVol><pesoL>9.000</pesoL><pesoB>10.500</pesoB></vol>'
    + '<vol><qVol>1</qVol><esp>Engradado</esp><marca>Santíssimo Decor SD</marca><nVol>361_2/4</nVol><pesoL>18.000</pesoL><pesoB>20.000</pesoB></vol>'
    + '<vol><qVol>2</qVol><esp>Caixa</esp><marca>Santíssimo Decor SD</marca><nVol>361_3/4 a 361_4/4</nVol></vol>');
  // A regra da numeração, sozinha: nota_caixa/total; um <vol> de várias caixas leva a faixa.
  assert.equal(x.numeracaoDasCaixas(125, 2, 1, 3), '125_2/3');
  assert.equal(x.numeracaoDasCaixas('000125', 1, 3, 3), '125_1/3 a 125_3/3', 'sem zeros à esquerda no número da nota');
  assert.equal(x.numeracaoDasCaixas(7, 1, 1, 1), '7_1/1', 'uma caixa só também é numerada');
  assert.equal(x.numeracaoDasCaixas('', 1, 1, 1), '', 'sem número da nota não inventa');
  assert.match(x.montarNfe(base({ transporte: { modalidade_frete: 1, volumes_quantidade: 1, volumes_especie: 'Caixa', volumes_marca: 'Marca X' } })).xml, /<marca>Marca X<\/marca>/);
  assert.match(x.montarNfe(base({ configuracao: { ...CONFIG, nome_fantasia: '' }, transporte: { modalidade_frete: 1, volumes_quantidade: 1, volumes_especie: 'Caixa' } })).xml, /<marca>SANTÍSSIMO DECOR LTDA SD<\/marca>/);
  assert.throws(() => x.montarNfe(base({ transporte: { modalidade_frete: 1, volumes: [{ peso_bruto: 1 }] } })), /Volume 1 sem espécie/);
});

test('fora do estado: idDest 2 e CFOP de fora (da peça quando ela tem o seu)', () => {
  const cliente = { ...CLIENTE, reg_uf: 'SP', reg_cidade: 'São Paulo', reg_codigo_municipio: '3550308' };
  const produtos = [{ ...PRODUTOS[0], cfop_fora_uf: '6102' }];
  const r = x.montarNfe(base({ cliente, produtos }));
  assert.match(r.xml, /<idDest>2<\/idDest>/);
  assert.match(r.xml, /<CFOP>6102<\/CFOP>/);
  assert.equal(r.dentroDoEstado, false);
  const semCfopProprio = x.montarNfe(base({ cliente }));
  assert.match(semCfopProprio.xml, /<CFOP>6101<\/CFOP>/);
});

test('cobrança a prazo: fatura + duplicatas iguais ao total, indPag 1 e tPag pelo texto da forma de pagamento', () => {
  const r = x.montarNfe(base());
  assert.equal(entre(r.xml, 'cobr'), '<fat><nFat>361</nFat><vOrig>294.00</vOrig><vDesc>0.00</vDesc><vLiq>294.00</vLiq></fat>'
    + '<dup><nDup>001</nDup><dVenc>2026-10-14</dVenc><vDup>147.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-11-13</dVenc><vDup>147.00</vDup></dup>');
  assert.equal(entre(r.xml, 'pag'), '<detPag><indPag>1</indPag><tPag>15</tPag><vPag>294.00</vPag></detPag>');
  assert.equal(r.aPrazo, true);
  assert.deepEqual(r.avisos, []);

  // Um centavo de diferença nas parcelas vai para a última; mais que isso é erro.
  const ajustada = x.montarNfe(base({ parcelas: [{ numero_parcela: 1, valor: 147, data_vencimento: '2026-10-14' }, { numero_parcela: 2, valor: 146.99, data_vencimento: '2026-11-13' }] }));
  assert.match(entre(ajustada.xml, 'cobr'), /<nDup>002<\/nDup><dVenc>2026-11-13<\/dVenc><vDup>147\.00<\/vDup>/);
  assert.match(ajustada.avisos[0], /Última parcela ajustada em 0\.01/);
  assert.throws(() => x.montarNfe(base({ parcelas: [{ numero_parcela: 1, valor: 200, data_vencimento: '2026-10-14' }] })), /parcelas somam 200\.00 e a nota vale 294\.00/);

  // Vencimento antes da emissão vai com a data da emissão, avisando.
  const antes = x.montarNfe(base({ parcelas: [{ numero_parcela: 1, valor: 147, data_vencimento: '2026-09-01' }, { numero_parcela: 2, valor: 147, data_vencimento: '2026-10-14' }] }));
  assert.match(entre(antes.xml, 'cobr'), /<nDup>001<\/nDup><dVenc>2026-09-14<\/dVenc>/);
  assert.match(antes.avisos[0], /Parcela 1 vencia em 2026-09-01/);
});

test('à vista: só a fatura, indPag 0, PIX vira tPag 17 e forma desconhecida vira 99 com descrição', () => {
  const r = x.montarNfe(base({ pedido: { ...PEDIDO, forma_pagamento: 'PIX' }, parcelas: [{ numero_parcela: 1, valor: 294, data_vencimento: '2026-09-14' }] }));
  assert.equal(entre(r.xml, 'cobr'), '<fat><nFat>361</nFat><vOrig>294.00</vOrig><vDesc>0.00</vDesc><vLiq>294.00</vLiq></fat>');
  assert.equal(entre(r.xml, 'pag'), '<detPag><indPag>0</indPag><tPag>17</tPag><vPag>294.00</vPag></detPag>');
  assert.equal(r.aPrazo, false);

  const outra = x.montarNfe(base({ pedido: { ...PEDIDO, forma_pagamento: 'Permuta' }, parcelas: [{ numero_parcela: 1, valor: 294, data_vencimento: '2026-09-14' }] }));
  assert.equal(entre(outra.xml, 'pag'), '<detPag><indPag>0</indPag><tPag>99</tPag><xPag>Permuta</xPag><vPag>294.00</vPag></detPag>');

  const forcada = x.montarNfe(base({ pagamento: { tPag: '3', indPag: 1 } }));
  assert.match(entre(forcada.xml, 'pag'), /<indPag>1<\/indPag><tPag>03<\/tPag>/);
  assert.equal(x.codigoPagamento('Cartão de crédito'), '03');
  assert.equal(x.codigoPagamento('boleto bancário'), '15');
  assert.equal(x.codigoPagamento('Transferência'), '18');
});

test('pessoa física: CPF, sem IE (indIEDest 9); frete 9 não leva volumes; sem responsável técnico sem CNPJ', () => {
  const cliente = { ...CLIENTE, tipo_pessoa: 'PF', cnpj: null, cpf: '123.456.789-09', inscricao_estadual: '', indicador_ie: 9, email_nfe: '' };
  const r = x.montarNfe(base({ cliente, transporte: { modalidade_frete: 9, volumes_quantidade: 3 } }));
  assert.match(entre(r.xml, 'dest'), /^<CPF>12345678909<\/CPF><xNome>/);
  assert.match(entre(r.xml, 'dest'), /<indIEDest>9<\/indIEDest>$/);
  assert.equal(entre(r.xml, 'transp'), '<modFrete>9</modFrete>');
  assert.ok(!r.xml.includes('<infRespTec>'));
  assert.equal(r.destinatario.tipo_pessoa, 'PF');
  assert.equal(r.destinatario.documento, '12345678909');

  const comResp = x.montarNfe(base({ configuracao: { ...CONFIG, resp_tec_cnpj: '43728245000142', resp_tec_contato: 'suporte', resp_tec_email: 'suporte@x.com', resp_tec_fone: '08005700800' } }));
  assert.equal(entre(comResp.xml, 'infRespTec'), '<CNPJ>43728245000142</CNPJ><xContato>suporte</xContato><email>suporte@x.com</email><fone>08005700800</fone>');
});

test('forma canônica: sem tag autofechada, & < > escapados, textos limpos e cNF nunca igual ao número', () => {
  const itens = [{ ...ITENS[0], nome: '  Mesa & Cadeira <Luxo>  "grande"  ' }];
  const r = x.montarNfe(base({ itens, cNF: null, aleatorio: () => 0.00000361 }));
  assert.match(r.xml, /<xProd>Mesa &amp; Cadeira &lt;Luxo&gt; "grande"<\/xProd>/);
  assert.ok(!/<[\w:]+[^>]*\/>/.test(r.xml), 'nenhuma tag autofechada');
  assert.ok(!/>\s+</.test(r.xml), 'nenhum espaço entre elementos');
  assert.notEqual(r.cNF, '00000361', 'cNF igual ao nNF é rejeitado pela SEFAZ');
  assert.equal(x.limparTexto('  a \n\t b c  ', 3), 'a b');
  assert.equal(x.escapar('a&b<c>d"e\r'), 'a&amp;b&lt;c&gt;d"e&#xD;');
  assert.equal(x.dec('1.005', 2), '1.01');
  assert.equal(x.dec(2.5, 4), '2.5000');
  assert.throws(() => x.dec('abc', 2, 'quantidade'), /quantidade inválido/);
  assert.equal(x.formatarDataHora(new Date('2026-01-10T02:30:00Z')), '2026-01-09T23:30:00-03:00');
});

test('o que não dá para montar vira erro claro (NCM, CSOSN fora do Simples, município, item vazio)', () => {
  assert.throws(() => x.montarNfe(base({ itens: [{ ...ITENS[0], ncm: '9403' }] })), /sem NCM de 8 dígitos/);
  assert.throws(() => x.montarNfe(base({ produtos: [{ ...PRODUTOS[0], csosn: '900' }] })), /CSOSN 900/);
  assert.throws(() => x.montarNfe(base({ cliente: { ...CLIENTE, reg_codigo_municipio: null } })), /Código IBGE do município do cliente ausente/);
  assert.match(x.montarNfe(base({ cliente: { ...CLIENTE, reg_codigo_municipio: null }, codigoMunicipioDestino: '3118601' })).xml, /<cMun>3118601<\/cMun><xMun>Contagem/, 'com o código vindo de fora, monta');
  assert.throws(() => x.montarNfe(base({ itens: [] })), /sem itens/);
  assert.throws(() => x.montarNfe(base({ itens: [{ ...ITENS[0], quantidade: 0 }] })), /quantidade zero/);
  assert.throws(() => x.montarNfe(base({ configuracao: { ...CONFIG, pis_cst: '01' } })), /PIS\/COFINS/);
  assert.throws(() => x.montarNfe(base({ cliente: { ...CLIENTE, reg_uf: 'Marte' } })), /Estado do cliente não reconhecido/);
});
