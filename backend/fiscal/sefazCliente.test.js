/**
 * Cliente SOAP da SEFAZ (backend/fiscal/sefazCliente.js), sem rede: o
 * transporte é uma função que devolve o XML que a SEFAZ devolveria. Prende os
 * endereços da MG, o envelope 4.00, a leitura do Status do Serviço e as
 * falhas (SOAP Fault, HTTP fora de 2xx, corpo que não é XML, erros de rede).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const sefaz = require('./sefazCliente');

const RESPOSTA_107 = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>`
  + `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">`
  + `<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>W-3.4.35</verAplic>`
  + `<cStat>107</cStat><xMotivo>Servico em operacao</xMotivo><cUF>31</cUF><dhRecbto>2026-09-15T14:26:38-03:00</dhRecbto></retConsStatServ>`
  + `</nfeResultMsg></soap:Body></soap:Envelope>`;

const FALHA_SOAP = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault>`
  + `<soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="pt">Certificado inválido</soap:Text></soap:Reason>`
  + `</soap:Fault></soap:Body></soap:Envelope>`;

const transporteCom = (status, corpo, registro = []) => async (url, corpoEnviado, cabecalhos) => {
  registro.push({ url, corpo: corpoEnviado, cabecalhos });
  return { status, corpo };
};

test('endereços da SEFAZ-MG por ambiente e serviço', () => {
  assert.equal(sefaz.urlDoServico('MG', 'homologacao', 'statusServico'), 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4');
  assert.equal(sefaz.urlDoServico('mg', 'producao', 'autorizacao'), 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4');
  assert.equal(sefaz.urlDoServico('MG', 'homologacao', 'recepcaoEvento'), 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4');
  assert.throws(() => sefaz.urlDoServico('SP', 'homologacao', 'statusServico'), /Sem endereço da SEFAZ para a UF SP/);
  assert.throws(() => sefaz.urlDoServico('MG', 'homologacao', 'inexistente'), /Serviço desconhecido/);
});

test('mensagem do status e envelope SOAP 1.2 no formato da versão 4.00', () => {
  const xml = sefaz.xmlConsultaStatus('MG', 'homologacao');
  assert.equal(xml, '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>31</cUF><xServ>STATUS</xServ></consStatServ>');
  assert.match(sefaz.xmlConsultaStatus('MG', 'producao'), /<tpAmb>1<\/tpAmb>/);

  const envelope = sefaz.montarEnvelope('statusServico', xml);
  assert.ok(envelope.startsWith('<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'));
  assert.match(envelope, /<nfeDadosMsg xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeStatusServico4"><consStatServ/);
  assert.ok(!envelope.includes('CDATA'), 'a mensagem vai inline, sem CDATA');
});

test('statusServico lê cStat 107 e manda o header action do método', async () => {
  const registro = [];
  const r = await sefaz.statusServico({ uf: 'MG', ambiente: 'homologacao', transporte: transporteCom(200, RESPOSTA_107, registro) });
  assert.equal(r.cStat, '107');
  assert.equal(r.emOperacao, true);
  assert.equal(r.xMotivo, 'Servico em operacao');
  assert.equal(r.versaoAplicacao, 'W-3.4.35');
  assert.equal(r.ambiente, 'homologacao');
  assert.equal(r.cUF, '31');
  assert.equal(r.url, 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4');
  assert.ok(Number.isFinite(r.tempoMs));
  assert.match(registro[0].cabecalhos['Content-Type'], /^application\/soap\+xml; charset=utf-8; action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeStatusServico4\/nfeStatusServicoNF"$/);
});

test('falha SOAP, HTTP fora de 2xx, resposta sem XML e status ausente viram erros em português', async () => {
  const chamada = transporte => sefaz.statusServico({ uf: 'MG', ambiente: 'homologacao', transporte });
  await assert.rejects(chamada(transporteCom(500, FALHA_SOAP)), e => e.status === 502 && /recusou a mensagem: Certificado inválido/.test(e.message));
  await assert.rejects(chamada(transporteCom(503, '<html>indisponivel</html>')), /HTTP 503/);
  await assert.rejects(chamada(transporteCom(200, 'texto qualquer')), /não é XML/);
  await assert.rejects(chamada(transporteCom(200, RESPOSTA_107.replace(/<cStat>107<\/cStat>/, ''))), /sem o status do serviço/);
  await assert.rejects(sefaz.statusServico({ uf: 'MG', ambiente: 'homologacao', transporte: null }), /Transporte não configurado/);
});

test('erros de rede e de certificado ganham mensagem clara, sem detalhe interno', () => {
  const t = sefaz.traduzirErroDeRede;
  assert.match(t({ code: 'ENOTFOUND' }).message, /resolver o endereço/);
  assert.match(t({ code: 'ECONNRESET' }).message, /não aceitou a conexão/);
  assert.match(t({ message: 'mac verify failure' }).message, /senha do certificado/);
  assert.match(t({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'unable to verify the first certificate' }).message, /ICP-Brasil/);
  assert.equal(t({ code: 'ENOTFOUND' }).status, 502);
  const proprio = Object.assign(new Error('já traduzido'), { status: 504 });
  assert.equal(t(proprio), proprio);
});

test('campo e bloco ignoram prefixo de namespace e devolvem null quando não há', () => {
  const xml = '<a:ret xmlns:a="x"><a:cStat>100</a:cStat><a:xMotivo>Ok</a:xMotivo></a:ret>';
  assert.equal(sefaz.campo(xml, 'cStat'), '100');
  assert.equal(sefaz.campo(xml, 'nada'), null);
  assert.equal(sefaz.bloco(xml, 'ret'), xml);
  assert.equal(sefaz.faltaSoap(xml), null);
  assert.equal(sefaz.faltaSoap(FALHA_SOAP), 'Certificado inválido');
});
