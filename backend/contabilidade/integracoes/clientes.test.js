/**
 * Os clientes das integrações (etapas 10, 11 e 13), sem rede: as mensagens
 * que saem e a leitura do que volta.
 *   - SEFAZ: distDFeInt por NSU / NSU exato / chave, o envelope SOAP, os
 *     documentos gzip+base64 (resNFe, procNFe, evento de cancelamento), 137 e
 *     656, e a manifestação (cOrgao 91, a descrição exata, justificativa só na
 *     "não realizada") assinada e conferida;
 *   - ADN: LoteDFe com chaves maiúsculas ou minúsculas, "nenhum documento"
 *     por 200 ou 404, recusa do certificado, e o XML da NFS-e nacional
 *     (tomador, ISS retido, valores);
 *   - BB: datas DDMMAAAA sem o zero do dia, débito/crédito, contrapartida,
 *     as linhas de saldo fora dos lançamentos, as páginas e a app key.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const sefazDist = require('./sefazDistribuicao');
const nfseAdn = require('./nfseAdn');
const bbExtrato = require('./bbExtrato');
const certificado = require('../../fiscal/certificado');
const assinatura = require('../../fiscal/assinatura');
const { gerarPfx } = require('../../fiscal/certificadoDeTeste');

const EMPRESA = '11444777000161';
const CHAVE_A = '31260857248237000103550010000012341000012344';
const CHAVE_C = '31260812345678000199550010000000991000000999';
const gz = texto => zlib.gzipSync(Buffer.from(texto, 'utf8')).toString('base64');

const resNFe = (chave, extra = '') => `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${chave}</chNFe><CNPJ>57248237000103</CNPJ><xNome>Vidros Norte LTDA</xNome><IE>1</IE><dhEmi>2026-08-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1200.00</vNF><digVal>x</digVal><dhRecbto>2026-08-10T10:01:00-03:00</dhRecbto><nProt>131260000012345</nProt>${extra}</resNFe>`;
const procNFe = chave => `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><nNF>1234</nNF></ide></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const cancelamento = chave => `<resEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cOrgao>31</cOrgao><CNPJ>12345678000199</CNPJ><chNFe>${chave}</chNFe><dhEvento>2026-08-12T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento><dhRecbto>2026-08-12T09:00:01-03:00</dhRecbto><nProt>131260000099999</nProt></resEvento>`;

function retDist({ cStat = '138', xMotivo = 'Documento localizado', ult = '3', max = '3', docs = [] } = {}) {
  const lote = docs.length ? `<loteDistDFeInt>${docs.map(d => `<docZip NSU="${String(d.nsu).padStart(15, '0')}" schema="${d.schema}">${gz(d.xml)}</docZip>`).join('')}</loteDistDFeInt>` : '';
  return `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>`
    + `<retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><verAplic>1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><dhResp>2026-09-15T12:00:00-03:00</dhResp>`
    + `<ultNSU>${String(ult).padStart(15, '0')}</ultNSU><maxNSU>${String(max).padStart(15, '0')}</maxNSU>${lote}</retDistDFeInt>`
    + '</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
}

test('SEFAZ: a mensagem da distribuição por NSU, por NSU exato e por chave; o envelope e o cabeçalho SOAP', () => {
  const porNsu = sefazDist.xmlDistribuicao({ ambiente: 'homologacao', uf: 'MG', cnpj: '11.444.777/0001-61', ultNSU: '42' });
  assert.equal(porNsu, `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><cUFAutor>31</cUFAutor><CNPJ>${EMPRESA}</CNPJ><distNSU><ultNSU>000000000000042</ultNSU></distNSU></distDFeInt>`);
  assert.match(sefazDist.xmlDistribuicao({ ambiente: 'producao', uf: 'MG', cnpj: EMPRESA, nsu: 7 }), /<tpAmb>1<\/tpAmb>.*<consNSU><NSU>000000000000007<\/NSU><\/consNSU>/);
  assert.match(sefazDist.xmlDistribuicao({ ambiente: 'producao', uf: 'MG', cnpj: EMPRESA, chave: CHAVE_A }), new RegExp(`<consChNFe><chNFe>${CHAVE_A}</chNFe></consChNFe>`));
  assert.throws(() => sefazDist.xmlDistribuicao({ ambiente: 'producao', uf: 'MG', cnpj: '123', ultNSU: 0 }), /CNPJ/);
  assert.throws(() => sefazDist.xmlDistribuicao({ ambiente: 'producao', uf: 'MG', cnpj: EMPRESA, chave: '123' }), /Chave/);
  const env = sefazDist.envelopeDistribuicao('<x/>');
  assert.match(env, /<nfeDistDFeInteresse xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe"><nfeDadosMsg><x\/><\/nfeDadosMsg><\/nfeDistDFeInteresse>/);
  assert.match(sefazDist.CABECALHOS_DISTRIBUICAO['Content-Type'], /action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe\/nfeDistDFeInteresse"/);
});

test('SEFAZ: o retorno com documentos compactados, o "nada novo" (137) e o consumo indevido (656)', () => {
  const r = sefazDist.lerRetornoDistribuicao(retDist({
    docs: [{ nsu: 1, schema: 'resNFe_v1.01.xsd', xml: resNFe(CHAVE_A) }, { nsu: 2, schema: 'procNFe_v4.00.xsd', xml: procNFe(CHAVE_A) }, { nsu: 3, schema: 'resEvento_v1.01.xsd', xml: cancelamento(CHAVE_C) }]
  }));
  assert.equal(r.cStat, '138');
  assert.equal(r.comDocumento, true);
  assert.deepEqual([r.ultNSU, r.maxNSU], ['000000000000003', '000000000000003']);
  const lidos = r.documentos.map(d => sefazDist.lerDocumento(d));
  assert.deepEqual(lidos.map(d => d.tipo), ['resumo_nfe', 'nfe', 'evento']);
  assert.deepEqual([lidos[0].chave, lidos[0].emitente_documento, lidos[0].valor, lidos[0].data_emissao, lidos[0].situacao_nota], [CHAVE_A, '57248237000103', 1200, '2026-08-10', 'autorizada']);
  assert.equal(lidos[1].chave, CHAVE_A);
  assert.deepEqual([lidos[2].chave, lidos[2].tpEvento, lidos[2].cancela, lidos[2].descricao], [CHAVE_C, '110111', true, 'Cancelamento']);
  assert.equal(sefazDist.lerDocumento({ schema: 'resNFe_v1.01.xsd', xml: resNFe(CHAVE_A, '<cSitNFe>3</cSitNFe>') }).situacao_nota, 'cancelada');
  const nada = sefazDist.lerRetornoDistribuicao(retDist({ cStat: '137', xMotivo: 'Nenhum documento localizado', ult: 3, max: 3 }));
  assert.equal(nada.semDocumento, true);
  assert.equal(nada.documentos.length, 0);
  assert.equal(sefazDist.lerRetornoDistribuicao(retDist({ cStat: '656', xMotivo: 'Consumo Indevido' })).consumoIndevido, true);
  assert.throws(() => sefazDist.lerRetornoDistribuicao('<soap:Envelope><soap:Body><soap:Fault><soap:Reason><soap:Text>Certificado inválido</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>'), /Certificado inválido/);
});

test('SEFAZ: a manifestação vai ao Ambiente Nacional com a descrição exata, assinada; a "não realizada" pede justificativa; 573 vale como feita', () => {
  const xml = sefazDist.xmlManifestacao({ ambiente: 'producao', cnpj: EMPRESA, chave: CHAVE_A, tipo: 'ciencia', dhEvento: '2026-09-15T12:00:00-03:00' });
  assert.match(xml, new RegExp(`<infEvento Id="ID210210${CHAVE_A}01"><cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${EMPRESA}</CNPJ>`));
  assert.match(xml, /<detEvento versao="1\.00"><descEvento>Ciencia da Operacao<\/descEvento><\/detEvento>/);
  assert.throws(() => sefazDist.xmlManifestacao({ ambiente: 'producao', cnpj: EMPRESA, chave: CHAVE_A, tipo: 'nao_realizada', dhEvento: 'x' }), /15 a 255/);
  assert.match(sefazDist.xmlManifestacao({ ambiente: 'producao', cnpj: EMPRESA, chave: CHAVE_A, tipo: 'nao_realizada', justificativa: 'Mercadoria devolvida no ato da entrega', dhEvento: 'x' }), /<tpEvento>210240<\/tpEvento>.*<descEvento>Operacao nao Realizada<\/descEvento><xJust>Mercadoria devolvida no ato da entrega<\/xJust>/);
  assert.throws(() => sefazDist.xmlManifestacao({ ambiente: 'producao', cnpj: EMPRESA, chave: CHAVE_A, tipo: 'outra', dhEvento: 'x' }), /Manifestação inválida/);
  // A assinatura do fiscal serve ao evento do Ambiente Nacional.
  const cert = certificado.abrirPfx(gerarPfx({ cn: `EMPRESA TESTE:${EMPRESA}` }), 'segredo');
  const assinado = assinatura.assinarEvento(xml, cert);
  assert.match(assinado, new RegExp(`</infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">.*<Reference URI="#ID210210${CHAVE_A}01">.*<SignatureValue>[A-Za-z0-9+/=]{100,}</SignatureValue>.*</Signature></evento>$`, 's'));
  const ret = cStat => `<retEnvEvento><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento><infEvento><cStat>${cStat}</cStat><xMotivo>ok</xMotivo><chNFe>${CHAVE_A}</chNFe><tpEvento>210210</tpEvento><nProt>891260000000001</nProt></infEvento></retEvento></retEnvEvento>`;
  assert.equal(sefazDist.lerRetornoManifestacao(ret('135')).registrado, true);
  assert.deepEqual([sefazDist.lerRetornoManifestacao(ret('573')).registrado, sefazDist.lerRetornoManifestacao(ret('573')).duplicado], [true, true]);
  assert.equal(sefazDist.lerRetornoManifestacao(ret('596')).registrado, false);
});

// ------------------------------------------------------------------ ADN

const CHAVE_NFSE = '31062002212345678000199000000000012326090123456789';
const nfse = ({ tomador = EMPRESA, prestador = '12345678000199', retido = '2' } = {}) => `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS${CHAVE_NFSE}">`
  + '<xLocEmi>Belo Horizonte</xLocEmi><xLocPrestacao>Belo Horizonte</xLocPrestacao><nNFSe>123</nNFSe><cLocIncid>3106200</cLocIncid><dhProc>2026-08-20T10:00:00-03:00</dhProc>'
  + `<emit><CNPJ>${prestador}</CNPJ><xNome>Contabilidade Exata &amp; Cia</xNome></emit>`
  + '<valores><vBC>850.00</vBC><vISSQN>42.50</vISSQN><vTotalRet>42.50</vTotalRet><vLiq>807.50</vLiq></valores>'
  + `<DPS versao="1.00"><infDPS Id="DPS1"><dhEmi>2026-08-20T09:00:00-03:00</dhEmi><dCompet>2026-08-20</dCompet><prest><CNPJ>${prestador}</CNPJ></prest><toma><CNPJ>${tomador}</CNPJ><xNome>Santissimo</xNome></toma>`
  + '<serv><cServ><cTribNac>171901</cTribNac><xDescServ>Honorários contábeis de agosto</xDescServ></cServ></serv>'
  + `<valores><vServPrest><vServ>850.00</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${retido}</tpRetISSQN></tribMun></trib></valores></infDPS></DPS></infNFSe></NFSe>`;
const eventoNfse = chave => `<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infEvento Id="EVT1"><pedRegEvento versao="1.00"><infPedReg Id="PRE1"><dhEvento>2026-08-25T10:00:00-03:00</dhEvento><chNFSe>${chave}</chNFSe><e101101><xDesc>Cancelamento de NFS-e</xDesc></e101101></infPedReg></pedRegEvento></infEvento></evento>`;

test('ADN: o endereço, o lote (chaves maiúsculas ou minúsculas), "nenhum documento" por 200 ou 404 e a recusa do certificado', () => {
  assert.equal(nfseAdn.urlDfe('https://adn.nfse.gov.br/contribuintes/', '000123', { lote: true }), 'https://adn.nfse.gov.br/contribuintes/DFe/123?lote=true');
  assert.equal(nfseAdn.urlDfe('https://adn.nfse.gov.br/contribuintes', 0, { lote: false }), 'https://adn.nfse.gov.br/contribuintes/DFe/0');
  const r = nfseAdn.lerRetorno(200, { StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU: 5, ChaveAcesso: CHAVE_NFSE, TipoDocumento: 'NFSE', ArquivoXml: gz(nfse()), DataHoraGeracao: '2026-08-20T10:00:00' }] });
  assert.equal(r.documentos.length, 1);
  assert.deepEqual([r.documentos[0].nsu, r.documentos[0].chave, r.documentos[0].tipoDocumento], ['5', CHAVE_NFSE, 'NFSE']);
  assert.match(r.documentos[0].xml, /<nNFSe>123<\/nNFSe>/);
  const minusculo = nfseAdn.lerRetorno(200, { statusProcessamento: 'DOCUMENTOS_LOCALIZADOS', loteDFe: [{ nsu: 6, chaveAcesso: CHAVE_NFSE, arquivoXml: gz(nfse()) }] });
  assert.equal(minusculo.documentos[0].nsu, '6');
  assert.equal(nfseAdn.lerRetorno(404, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' }).semDocumento, true);
  assert.equal(nfseAdn.lerRetorno(200, { StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO', LoteDFe: [] }).semDocumento, true);
  assert.throws(() => nfseAdn.lerRetorno(403, { Erros: [{ Codigo: 'E001', Descricao: 'Certificado não autorizado' }] }), /recusou o certificado.*E001 — Certificado não autorizado/);
  assert.throws(() => nfseAdn.lerRetorno(400, { StatusProcessamento: 'REJEICAO', Erros: [{ Codigo: 'E2', Descricao: 'NSU inválido' }] }), /REJEICAO.*NSU inválido/);
});

test('ADN: a NFS-e nacional lida — papel da empresa, prestador, município, valores e ISS retido; o evento de cancelamento', () => {
  const lida = nfseAdn.lerDocumento(nfse(), { cnpjEmpresa: EMPRESA });
  assert.deepEqual(
    [lida.tipo, lida.chave, lida.numero, lida.papel, lida.municipio, lida.emitente_documento, lida.emitente_nome, lida.data_emissao, lida.valor_servicos, lida.valor_iss, lida.valor_liquido, lida.iss_retido, lida.descricao],
    ['nfse', CHAVE_NFSE, '123', 'tomador', 'Belo Horizonte', '12345678000199', 'Contabilidade Exata & Cia', '2026-08-20', 850, 42.5, 807.5, true, 'Honorários contábeis de agosto']
  );
  assert.equal(nfseAdn.lerDocumento(nfse({ retido: '1' }), { cnpjEmpresa: EMPRESA }).iss_retido, false);
  assert.equal(nfseAdn.lerDocumento(nfse({ tomador: '99999999000199', prestador: EMPRESA }), { cnpjEmpresa: EMPRESA }).papel, 'prestador');
  const ev = nfseAdn.lerDocumento(eventoNfse(CHAVE_NFSE));
  assert.deepEqual([ev.tipo, ev.chave, ev.codigo_evento, ev.cancela], ['evento', CHAVE_NFSE, 'e101101', true]);
});

// ------------------------------------------------------------------ BB extrato

test('BB: datas no formato do BB, sinal, contrapartida e as linhas de saldo fora dos lançamentos', () => {
  assert.equal(bbExtrato.dataBB('2026-09-01'), '1092026');
  assert.equal(bbExtrato.dataBB('2026-09-15'), '15092026');
  assert.equal(bbExtrato.lerDataBB(1092026), '2026-09-01');
  assert.equal(bbExtrato.lerDataBB('15092026'), '2026-09-15');
  assert.equal(bbExtrato.lerDataBB('15.09.2026'), '2026-09-15');
  assert.equal(bbExtrato.lerDataBB('99999999'), null);
  const pagina = bbExtrato.lerPagina({
    numeroPaginaAtual: 1, numeroPaginaProximo: 2, quantidadeTotalPagina: 2,
    listaLancamento: [
      { dataLancamento: 1092026, valorLancamento: 8000, codigoHistorico: 0, textoDescricaoHistorico: 'Saldo Anterior', numeroDocumento: 0, indicadorSinalLancamento: 'C' },
      { dataLancamento: 5092026, valorLancamento: 2500, indicadorTipoLancamento: 'D', numeroDocumento: 123, textoDescricaoHistorico: 'Pagamento de boleto', textoInformacaoComplementar: 'Imobiliária Centro', codigoHistorico: 109, codigoSubHistorico: 12, numeroCpfCnpjContrapartida: 12345678000199, indicadorTipoPessoaContrapartida: 'J', codigoIdentificadorSistemaPagamento: 'SPB', textoIdentificadorUnicoTransacao: 'E00000000202609051200abc' },
      { dataLancamento: 9092026, valorLancamento: 612, indicadorTipoLancamento: 'D', numeroDocumento: 0, textoDescricaoHistorico: 'Pix - Enviado', numeroCpfCnpjContrapartida: 12345678909, indicadorTipoPessoaContrapartida: 'F' },
      { dataLancamento: 10092026, valorLancamento: 3200, indicadorTipoLancamento: 'C', numeroDocumento: 1, textoDescricaoHistorico: 'Liquidação de cobrança' },
      { dataLancamento: 11092026, valorLancamento: 0, indicadorTipoLancamento: 'C', textoDescricaoHistorico: 'Estorno zerado' },
      { dataLancamento: 30092026, valorLancamento: 8087.5, codigoHistorico: 999, textoDescricaoHistorico: 'S A L D O', indicadorSinalLancamento: 'C' }
    ]
  });
  assert.equal(pagina.lancamentos.length, 3);
  assert.deepEqual(pagina.saldo, { valor: 8087.5, data: '2026-09-30' });
  assert.equal(pagina.zerados, 1);
  assert.equal(pagina.proximaPagina, 2);
  const [boleto, pix, cobranca] = pagina.lancamentos;
  assert.deepEqual(
    [boleto.data, boleto.valor, boleto.tipo, boleto.documento, boleto.identificador, boleto.descricao, boleto.contrapartida_documento, boleto.contrapartida_tipo, boleto.codigo_historico, boleto.codigo_sub_historico, boleto.sistema_pagamento],
    ['2026-09-05', -2500, 'debito', '123', 'E00000000202609051200abc', 'Pagamento de boleto — Imobiliária Centro', '12345678000199', 'J', '109', '12', 'SPB']
  );
  assert.deepEqual([pix.valor, pix.documento, pix.contrapartida_documento, pix.contrapartida_tipo], [-612, null, '12345678909', 'F']);
  assert.deepEqual([cobranca.valor, cobranca.tipo], [3200, 'credito']);
  assert.equal(bbExtrato.lerPagina({ numeroPaginaAtual: 2, numeroPaginaProximo: 0, listaLancamento: [] }).proximaPagina, 0);
});

test('BB v2: os nomes novos dos campos, o CNPJ alfanumérico e o que fica fora do extrato (futuro, saldos, limites, bloqueado)', () => {
  // Formato da OpenAPI 2.0.1 (02/10/2026): indicadorTipoLancamento 1/2/3/SA…, sinal em indicadorSinalLancamento.
  const v2 = (extra) => ({ indicadorTipoLancamento: '1', dataMovimento: 0, codigoAgenciaOrigem: 638, numeroLote: 99015, ...extra });
  const pagina = bbExtrato.lerPagina({
    numeroPaginaAtual: 1, numeroPaginaProximo: 0, quantidadeTotalPagina: 1,
    listaLancamento: [
      v2({ dataLancamento: 1092026, valorLancamento: 0, codigoHistorico: 0, textoDescricaoSubHistorico: 'Saldo Anterior', numeroDocumento: 0, indicadorSinalLancamento: 'C' }),
      v2({ dataLancamento: 19092026, valorLancamento: 1079, indicadorSinalLancamento: 'C', numeroDocumento: 550638000086722, codigoHistorico: 821, codigoSubHistorico: 25001,
        textoDescricaoSubHistorico: 'Pix - Recebido', textoInformacaoComplementar: '19092026 14:22 Loja ABC', numeroCadastroPessoaFisicaCadastroNacPessoasJuridicasContrapartida: '12.ABC.345/01DE-35',
        indicadorTipoPessoaContrapartida: 'J', numeroISPB: 60746948, textoIdentificadorUnicoTransacao: 'BB0017984000000040242025', codigoConfederacaoNacionalBancos: null }),
      v2({ dataLancamento: 20092026, valorLancamento: 60.97, indicadorSinalLancamento: 'D', numeroDocumento: 91803, textoDescricaoSubHistorico: 'Pix - Agendamento' }),
      v2({ indicadorTipoLancamento: '2', dataLancamento: 2102026, valorLancamento: 400, indicadorSinalLancamento: 'D', numeroDocumento: 92202, textoDescricaoSubHistorico: 'Pix - Agendamento' }),
      v2({ indicadorTipoLancamento: '3', dataLancamento: 1102026, valorLancamento: 50, indicadorSinalLancamento: 'C', numeroDocumento: 5, textoDescricaoSubHistorico: 'Depósito' }),
      v2({ indicadorTipoLancamento: 'RA', dataLancamento: 1102026, valorLancamento: 1660.78, indicadorSinalLancamento: 'C', textoDescricaoSubHistorico: 'Invest Resgate Autom' }),
      v2({ indicadorTipoLancamento: 'LC', dataLancamento: 1102026, valorLancamento: 5000, indicadorSinalLancamento: 'C', textoDescricaoSubHistorico: 'Limite Contratado' }),
      v2({ dataLancamento: 21092026, valorLancamento: 12, indicadorSinalLancamento: '*', numeroDocumento: 7, textoDescricaoSubHistorico: 'Bloqueio judicial' }),
      v2({ dataLancamento: 30092026, valorLancamento: 1018.03, codigoHistorico: 999, textoDescricaoSubHistorico: 'S A L D O', numeroDocumento: 0, indicadorSinalLancamento: 'C' })
    ]
  });
  assert.equal(pagina.lancamentos.length, 2, 'só os contabilizados');
  assert.deepEqual(pagina.saldo, { valor: 1018.03, data: '2026-09-30' });
  const [pix, agendado] = pagina.lancamentos;
  assert.deepEqual(
    [pix.data, pix.valor, pix.documento, pix.descricao, pix.contrapartida_documento, pix.contrapartida_tipo, pix.codigo_historico, pix.codigo_sub_historico, pix.sistema_pagamento, pix.identificador, pix.hash_por_documento],
    ['2026-09-19', 1079, '550638000086722', 'Pix - Recebido — 19092026 14:22 Loja ABC', '12ABC34501DE35', 'J', '821', '25001', '60746948', 'BB0017984000000040242025', true]
  );
  assert.deepEqual([agendado.valor, agendado.descricao], [-60.97, 'Pix - Agendamento']);
  assert.deepEqual(pagina.fora.map(x => [x.tipo, x.valor]), [['futuro', -400], ['em processamento', 50], ['resgate automático', 1660.78], ['limite contratado', 5000], ['bloqueado', 12]]);
  assert.equal(bbExtrato.documentoContrapartida('ABC', 'J'), null, 'alfanumérico só com 14 posições');
  assert.equal(bbExtrato.documentoContrapartida('00000000000000', 'J'), null);
  assert.deepEqual(bbExtrato.janelas('2026-08-01', '2026-09-14'), [{ inicio: '2026-08-01', fim: '2026-08-31' }, { inicio: '2026-09-01', fim: '2026-09-14' }]);
  assert.deepEqual(bbExtrato.janelas('2026-09-01', '2026-09-30'), [{ inicio: '2026-09-01', fim: '2026-09-30' }], 'um mês cabe numa consulta');
});

test('BB v2: o token (Basic + escopo), a app key gw-dev-app-key, o código de teste só na homologação, 120 por página e o erro do banco em português', async () => {
  const pedidos = [];
  const paginas = {
    1: { numeroPaginaAtual: 1, numeroPaginaProximo: 2, listaLancamento: [{ indicadorTipoLancamento: '1', dataLancamento: 2092026, valorLancamento: 10, indicadorSinalLancamento: 'C', textoDescricaoSubHistorico: 'Crédito 1' }] },
    2: { numeroPaginaAtual: 2, numeroPaginaProximo: 0, listaLancamento: [{ indicadorTipoLancamento: '1', dataLancamento: 3092026, valorLancamento: 5, indicadorSinalLancamento: 'D', textoDescricaoSubHistorico: 'Débito 1' }] }
  };
  const transporte = async (url, { metodo, cabecalhos, corpo }) => {
    pedidos.push({ url, metodo, cabecalhos, corpo });
    if (url.includes('/oauth/token')) return { status: 200, corpo: Buffer.from(JSON.stringify({ access_token: 'tk', token_type: 'Bearer', expires_in: 600, scope: 'extrato-info' })) };
    const pagina = Number(new URL(url).searchParams.get('numeroPaginaSolicitacao'));
    return { status: 200, corpo: Buffer.from(JSON.stringify(paginas[pagina])) };
  };
  const r = await bbExtrato.buscarPeriodo({
    transporte, urlOauth: 'https://oauth.hm.bb.com.br/oauth/token', urlApi: 'https://extratos.mtls.api.hm.bb.com.br/v2',
    credenciais: { clientId: 'cid', secret: 'sec', appKey: 'app' }, escopo: 'extrato-info', ambiente: 'homologacao',
    agencia: '01505', conta: '0001348', mciTeste: '178961031', inicio: '2026-09-01', fim: '2026-09-14'
  });
  assert.deepEqual(r.extrato.lancamentos.map(l => [l.data, l.valor]), [['2026-09-02', 10], ['2026-09-03', -5]]);
  assert.deepEqual([r.escopos, r.semLancamentos], [['extrato-info'], false]);
  const token = pedidos[0];
  assert.equal(token.cabecalhos.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
  assert.equal(token.corpo, 'grant_type=client_credentials&scope=extrato-info');
  const consulta = new URL(pedidos[1].url);
  assert.equal(`${consulta.host}${consulta.pathname}`, 'extratos.mtls.api.hm.bb.com.br/v2/conta-corrente/agencia/1505/conta/1348');
  assert.deepEqual(Object.fromEntries(consulta.searchParams), { 'gw-dev-app-key': 'app', numeroPaginaSolicitacao: '1', quantidadeRegistroPaginaSolicitacao: '120', dataInicioSolicitacao: '1092026', dataFimSolicitacao: '14092026' });
  assert.deepEqual([pedidos[1].cabecalhos['x-br-com-bb-ipa-mciteste'], pedidos[1].cabecalhos['Content-Type'], pedidos[1].cabecalhos.Authorization], ['178961031', 'application/json', 'Bearer tk']);
  assert.equal(pedidos.length, 3, 'token + 2 páginas');

  // Produção: a mesma gw-dev-app-key (a chave de produção), sem o cabeçalho de teste; mais de 31 dias vira duas consultas; 404 = sem lançamentos.
  pedidos.length = 0;
  const vazio = async (url, opcoes) => { pedidos.push({ url, ...opcoes }); return url.includes('/oauth/') ? { status: 200, corpo: Buffer.from(JSON.stringify({ access_token: 'tp' })) } : { status: 404, corpo: Buffer.from('') }; };
  const p = await bbExtrato.buscarPeriodo({
    transporte: vazio, urlOauth: 'https://oauth.bb.com.br/oauth/token', urlApi: 'https://extratos.mtls.api.bb.com.br/v2',
    credenciais: { clientId: 'c', secret: 's', appKey: 'prod' }, escopo: 'extrato-info', ambiente: 'producao', agencia: '1614', conta: '16773', inicio: '2026-08-01', fim: '2026-09-14'
  });
  assert.deepEqual([p.semLancamentos, p.consultas, p.extrato.lancamentos.length], [true, 2, 0]);
  const [ago, set] = pedidos.slice(1).map(x => new URL(x.url));
  assert.deepEqual([ago.searchParams.get('dataInicioSolicitacao'), ago.searchParams.get('dataFimSolicitacao'), set.searchParams.get('dataInicioSolicitacao'), set.searchParams.get('dataFimSolicitacao')], ['1082026', '31082026', '1092026', '14092026']);
  assert.equal(ago.searchParams.get('gw-dev-app-key'), 'prod');
  assert.ok(pedidos.slice(1).every(x => !('x-br-com-bb-ipa-mciteste' in x.cabecalhos)), 'o código de teste nunca vai em produção');
  assert.equal(bbExtrato.nomeDaAppKey('producao'), 'gw-app-key', 'as APIs antigas (CDB) seguem com gw-app-key em produção');

  await assert.rejects(() => bbExtrato.buscarPeriodo({ transporte, urlOauth: 'https://o/oauth/token', urlApi: 'https://a', credenciais: { clientId: 'a', secret: 'b', appKey: 'c' }, escopo: 'x', ambiente: 'homologacao', agencia: '1614', conta: '16773', inicio: '2026-09-01', fim: '2026-09-02' }),
    /precisa do código da conta de teste/);
  const recusa = async url => (url.includes('/oauth/') ? { status: 401, corpo: Buffer.from(JSON.stringify({ error_description: 'invalid_client' })) } : { status: 500, corpo: Buffer.from('') });
  await assert.rejects(() => bbExtrato.buscarPeriodo({ transporte: recusa, urlOauth: 'https://o/oauth/token', urlApi: 'https://a', credenciais: { clientId: 'a', secret: 'b', appKey: 'c' }, escopo: 'x', ambiente: 'producao', agencia: '1', conta: '2', inicio: '2026-09-01', fim: '2026-09-02' }),
    /recusou as credenciais ou o escopo \(401\): invalid_client/);
  const proibido = async url => (url.includes('/oauth/') ? { status: 200, corpo: Buffer.from(JSON.stringify({ access_token: 't' })) } : { status: 403, corpo: Buffer.from(JSON.stringify({ code: '6646500.1', message: 'Recebemos sua solicitação, mas não é possível prosseguir.' })) });
  await assert.rejects(() => bbExtrato.buscarPeriodo({ transporte: proibido, urlOauth: 'https://o/oauth/token', urlApi: 'https://a', credenciais: { clientId: 'a', secret: 'b', appKey: 'c' }, escopo: 'x', ambiente: 'producao', agencia: '1', conta: '2', inicio: '2026-09-01', fim: '2026-09-02' }),
    /403: Recebemos sua solicitação.*cadeia do certificado foi enviada.*envio para produção/);
});
