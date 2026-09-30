/**
 * Documentos recebidos (backend/contabilidade/documentosRecebidos.js): as
 * funções puras. O que fica preso: a leitura da NF-e de entrada (emitente com
 * endereço e UF por extenso, duplicatas, CFOPs); o que bloqueia (nota da
 * própria empresa, destinatário errado, chave repetida) e o que só avisa; as
 * parcelas sugeridas; a NF-e só pela chave; a NFS-e e o recibo digitados; e
 * as marcas da lista (falta XML, falta arquivo, sem conta).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('./documentosRecebidos');

const EMPRESA = '11444777000161';
const CHAVE = '31260857248237000103550010000012341000012344';

function xmlDaNota({ chave = CHAVE, destinatario = EMPRESA, emitente = '57248237000103', protocolo = true, duplicatas = true } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">
<ide><cUF>31</cUF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-08-10T10:00:00-03:00</dhEmi><finNFe>1</finNFe></ide>
<emit><CNPJ>${emitente}</CNPJ><xNome>Vidros Norte LTDA</xNome><xFant>Vidros Norte</xFant><enderEmit><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3118601</cMun><xMun>Contagem</xMun><UF>MG</UF><CEP>32000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais><fone>3133330000</fone></enderEmit><IE>0012345670011</IE></emit>
<dest><CNPJ>${destinatario}</CNPJ><xNome>Santissimo Decor</xNome></dest>
<det nItem="1"><prod><cProd>V1</cProd><xProd>Vidro temperado 8mm</xProd><NCM>70071900</NCM><CFOP>5102</CFOP><uCom>M2</uCom><qCom>10.0000</qCom><vUnCom>100.00</vUnCom><vProd>1000.00</vProd></prod></det>
<det nItem="2"><prod><cProd>F1</cProd><xProd>Ferragem &amp; parafuso</xProd><NCM>73181500</NCM><CFOP>5405</CFOP><uCom>UN</uCom><qCom>4.0000</qCom><vUnCom>50.00</vUnCom><vProd>200.00</vProd></prod></det>
<total><ICMSTot><vProd>1200.00</vProd><vICMS>144.00</vICMS><vIPI>0.00</vIPI><vFrete>0.00</vFrete><vDesc>0.00</vDesc><vNF>1200.00</vNF></ICMSTot></total>
${duplicatas ? '<cobr><fat><nFat>1234</nFat></fat><dup><nDup>001</nDup><dVenc>2026-09-10</dVenc><vDup>600.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-10-10</dVenc><vDup>600.00</vDup></dup></cobr>' : ''}
</infNFe></NFe>${protocolo ? `<protNFe><infProt><chNFe>${chave}</chNFe><nProt>131260000012345</nProt><cStat>100</cStat></infProt></protNFe>` : ''}</nfeProc>`;
}

test('lerNfeEntrada: emitente com endereço (UF por extenso), duplicatas, CFOPs e tributos', () => {
  const n = d.lerNfeEntrada(xmlDaNota());
  assert.equal(n.chave_acesso, CHAVE);
  assert.equal(n.data_emissao, '2026-08-10');
  assert.equal(n.emitente_documento, '57248237000103');
  assert.equal(n.emitente_fantasia, 'Vidros Norte');
  assert.equal(n.emitente_ie, '0012345670011');
  assert.deepEqual(n.emitente_endereco, {
    rua: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cidade: 'Contagem', codigo_municipio: '3118601',
    estado: 'Minas Gerais', pais: 'Brasil', cep: '32000-000'
  });
  assert.deepEqual(n.duplicatas, [{ numero: '001', vencimento: '2026-09-10', valor: 600 }, { numero: '002', vencimento: '2026-10-10', valor: 600 }]);
  assert.deepEqual(n.cfops, ['5102', '5405']);
  assert.equal(n.valor_icms, 144);
  assert.equal(n.itens[1].descricao, 'Ferragem & parafuso');
  assert.throws(() => d.lerNfeEntrada('<nada/>'), /não é o XML de uma NF-e/);
});

test('conferirNfeEntrada: bloqueia nota da própria empresa, destinatário errado e chave repetida; avisa sem protocolo', () => {
  const ok = d.conferirNfeEntrada(d.lerNfeEntrada(xmlDaNota()), { cnpjEmpresa: EMPRESA });
  assert.deepEqual(ok, { bloqueios: [], avisos: [] });
  const outraEmpresa = d.conferirNfeEntrada(d.lerNfeEntrada(xmlDaNota({ destinatario: '11222333000181' })), { cnpjEmpresa: EMPRESA });
  assert.match(outraEmpresa.bloqueios[0], /não foi emitida para a empresa \(o destinatário é 11\.222\.333\/0001-81\)/);
  const propria = d.conferirNfeEntrada(d.lerNfeEntrada(xmlDaNota({ emitente: EMPRESA })), { cnpjEmpresa: EMPRESA });
  assert.match(propria.bloqueios.join(' '), /própria empresa/);
  const repetida = d.conferirNfeEntrada(d.lerNfeEntrada(xmlDaNota()), { cnpjEmpresa: EMPRESA, chavesRegistradas: [CHAVE] });
  assert.deepEqual(repetida.bloqueios, ['Esta NF-e já foi registrada.']);
  const semProtocolo = d.conferirNfeEntrada(d.lerNfeEntrada(xmlDaNota({ protocolo: false })), {});
  assert.equal(semProtocolo.bloqueios.length, 0);
  assert.equal(semProtocolo.avisos.length, 2, 'sem CNPJ da empresa e sem protocolo');
});

test('parcelasSugeridas: as duplicatas; sem elas, uma parcela no vencimento dado ou na emissão', () => {
  assert.deepEqual(d.parcelasSugeridas({ duplicatas: [{ vencimento: '2026-09-10', valor: 600 }, { vencimento: null, valor: 600 }], valorTotal: 1200, emissao: '2026-08-10' })
    .map(p => [p.numero, p.vencimento, p.valor]), [[1, '2026-09-10', 600], [2, '2026-08-10', 600]]);
  assert.deepEqual(d.parcelasSugeridas({ valorTotal: 300, emissao: '2026-08-10', vencimento: '2026-08-20' }).map(p => [p.vencimento, p.valor]), [['2026-08-20', 300]]);
  assert.deepEqual(d.parcelasSugeridas({ valorTotal: 300, emissao: '2026-08-10' }).map(p => p.vencimento), ['2026-08-10']);
});

test('nfeDaChave: a chave diz emitente, modelo e número; a data tem de ser do mês da chave', () => {
  const n = d.nfeDaChave({ chave: CHAVE.replace(/(\d{4})/g, '$1 '), data_emissao: '2026-08-10', valor_total: '1.200,00', emitente_nome: 'Vidros Norte' });
  assert.deepEqual(n, {
    tipo: 'nfe', origem: 'chave', chave_acesso: CHAVE, modelo: '55', serie: '1', numero: '1234', emitente_documento: '57248237000103',
    emitente_nome: 'Vidros Norte', data_emissao: '2026-08-10', valor_total: 1200
  });
  assert.throws(() => d.nfeDaChave({ chave: CHAVE, data_emissao: '2026-09-01', valor_total: 10 }), /agosto\/2026/);
  assert.throws(() => d.nfeDaChave({ chave: CHAVE.slice(0, 43) + '5', data_emissao: '2026-08-10', valor_total: 10 }), /dígito verificador/);
  assert.throws(() => d.nfeDaChave({ chave: CHAVE, data_emissao: '2026-08-10', valor_total: 0 }), /valor total/);
});

test('NFS-e e recibo digitados: o que é obrigatório e o que vira número', () => {
  const s = d.nfseDigitada({ numero: ' 45 ', municipio: 'Contagem', emitente_documento: '123.456.789-09', emitente_nome: 'Ana Pintura', data_emissao: '2026-09-05', valor_total: '1.000,00', valor_iss: '50,00', iss_retido: 'true', descricao: 'Pintura das peças' });
  assert.deepEqual([s.tipo, s.numero, s.municipio, s.emitente_documento, s.valor_total, s.valor_iss, s.iss_retido, s.valor_retencoes], ['nfse', '45', 'Contagem', '12345678909', 1000, 50, true, null]);
  assert.throws(() => d.nfseDigitada({ municipio: 'Contagem', data_emissao: '2026-09-05', valor_total: 10 }), /número da NFS-e/);
  assert.throws(() => d.nfseDigitada({ numero: '1', data_emissao: '2026-09-05', valor_total: 10 }), /município/);
  assert.throws(() => d.nfseDigitada({ numero: '1', municipio: 'BH', data_emissao: '2026-09-05', valor_total: 10, valor_iss: '-1' }), /ISS inválido/);
  const r = d.outroDigitado({ especie: 'guia', descricao: 'DAS de agosto', data_emissao: '2026-09-20', valor_total: 321.45 });
  assert.deepEqual([r.tipo, r.especie, r.valor_total], ['outro', 'guia', 321.45]);
  assert.equal(d.outroDigitado({ especie: 'xpto', descricao: 'Recibo de frete', data_emissao: '2026-09-20', valor_total: 10 }).especie, 'recibo');
  assert.throws(() => d.outroDigitado({ descricao: 'ab', data_emissao: '2026-09-20', valor_total: 10 }), /do que se trata/);
  assert.equal(d.categoriaDoArquivo('outro', 'guia'), 'guia');
  assert.equal(d.categoriaDoArquivo('nfse'), 'nfse');
});

test('linhaDoDocumento: o rótulo, o emitente pelo contato e as marcas de falta', () => {
  const contatos = new Map([['7', { id: 7, nome: 'Vidros Norte', cnpj: '57248237000103' }]]);
  const arquivosMapa = new Map([['documento_recebido:1', [{ id: 9, categoria: 'xml_nfe' }]], ['documento_recebido:3', [{ id: 10, categoria: 'nfse' }]]]);
  const titulosPorDocumento = new Map([['1', [{ id: 50, descricao: 'NF-e 1/1234', status: 'aberto' }]]]);
  const pagamentosFechamento = new Map([['70', { id: 70, rotulo: 'Comissões de agosto/2026 — Ana (CMS)', valor: 1000 }]]);
  const ctx = { contatos, arquivosMapa, titulosPorDocumento, pagamentosFechamento };
  const nfe = d.linhaDoDocumento({ id: 1, tipo: 'nfe', origem: 'xml', serie: '1', numero: '1234', contato_id: 7, emitente_documento: '57248237000103', data_emissao: '2026-08-10', competencia: '2026-08', valor_total: '1200.00' }, ctx);
  assert.deepEqual([nfe.rotulo, nfe.emitente, nfe.emitente_documento, nfe.tem_xml, nfe.falta_xml, nfe.sem_conta, nfe.titulo.id], ['NF-e 1/1234', 'Vidros Norte', '57.248.237/0001-03', true, false, false, 50]);
  const soChave = d.linhaDoDocumento({ id: 2, tipo: 'nfe', origem: 'chave', numero: '9', emitente_nome: 'X', data_emissao: '2026-08-11', competencia: '2026-08', valor_total: 10 }, ctx);
  assert.deepEqual([soChave.falta_xml, soChave.falta_arquivo, soChave.sem_conta], [true, false, true]);
  const nfse = d.linhaDoDocumento({ id: 3, tipo: 'nfse', origem: 'manual', numero: '45', emitente_nome: 'Ana', data_emissao: '2026-09-05', competencia: '2026-09', valor_total: 1000, financeiro_pagamento_id: 70 }, ctx);
  assert.deepEqual([nfse.rotulo, nfse.falta_arquivo, nfse.sem_conta, nfse.financeiro_pagamento.rotulo], ['NFS-e 45', false, false, 'Comissões de agosto/2026 — Ana (CMS)']);
  const recibo = d.linhaDoDocumento({ id: 4, tipo: 'outro', especie: 'recibo', origem: 'manual', data_emissao: '2026-09-05', competencia: '2026-09', valor_total: 80, sem_pagamento: true }, ctx);
  assert.deepEqual([recibo.rotulo, recibo.falta_arquivo, recibo.sem_conta], ['Recibo', true, false]);
});

test('rotuloDoPagamentoDeFechamento: tipo, competência e quem recebeu', () => {
  assert.equal(d.rotuloDoPagamentoDeFechamento({ competencia: '2026-08', beneficiario: 'Ana', tipo_comissao: 'royalty' }, { tipo: 'comissao' }), 'Comissões de agosto/2026 — Ana (Royalty)');
  assert.equal(d.rotuloDoPagamentoDeFechamento({ competencia: '2026-08 ' }, { tipo: 'producao' }), 'Produção de agosto/2026');
});
