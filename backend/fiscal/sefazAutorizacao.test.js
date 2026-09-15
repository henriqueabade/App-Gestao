/**
 * Autorização, recibo e consulta no cliente da SEFAZ (backend/fiscal/sefazCliente.js),
 * sem rede: o transporte devolve as respostas que a SEFAZ-MG devolveria.
 * Prende o lote síncrono (indSinc=1), a leitura do protocolo (autorizada,
 * denegada, rejeitada), o recibo assíncrono, a consulta pela chave e o nfeProc.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const sefaz = require('./sefazCliente');

const CHAVE = '31260944039257000122550010000003621140003053';
const NFE_ASSINADA = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><cUF>31</cUF></ide></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></NFe>`;

const envelope = (servico, corpo) => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>`
  + `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;

const protocolo = (cStat, xMotivo, nProt = '131260000123456') => `<protNFe versao="4.00"><infProt Id="ID${nProt}"><tpAmb>2</tpAmb><verAplic>MG_2026</verAplic>`
  + `<chNFe>${CHAVE}</chNFe><dhRecbto>2026-09-15T15:10:01-03:00</dhRecbto>${nProt ? `<nProt>${nProt}</nProt>` : ''}<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

const retEnvi = (cStat, xMotivo, dentro = '') => `<retEnviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG_2026</verAplic>`
  + `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF><dhRecbto>2026-09-15T15:10:00-03:00</dhRecbto>${dentro}</retEnviNFe>`;

const transporteCom = (corpo, registro = []) => async (url, corpoEnviado, cabecalhos) => {
  registro.push({ url, corpo: corpoEnviado, cabecalhos });
  return { status: 200, corpo };
};

test('mensagens: lote síncrono com a NF-e assinada, consulta do recibo e consulta pela chave', () => {
  const lote = sefaz.xmlEnviNFe({ idLote: '42', xmlNfe: NFE_ASSINADA });
  assert.ok(lote.startsWith('<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>42</idLote><indSinc>1</indSinc><NFe xmlns='));
  assert.ok(lote.endsWith('</NFe></enviNFe>'));
  assert.throws(() => sefaz.xmlEnviNFe({ idLote: '1', xmlNfe: '<x/>' }), /precisa de um <NFe>/);
  assert.equal(sefaz.xmlConsultaRecibo('homologacao', '311000012345678'), '<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><nRec>311000012345678</nRec></consReciNFe>');
  assert.equal(sefaz.xmlConsultaNfe('producao', CHAVE), `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chNFe>${CHAVE}</chNFe></consSitNFe>`);
  assert.throws(() => sefaz.xmlConsultaNfe('homologacao', '123'), /Chave de acesso inválida/);
});

test('autorizar: lote processado com protocolo 100 = autorizada; manda para NFeAutorizacao4 com o action certo', async () => {
  const registro = [];
  const r = await sefaz.autorizar({
    uf: 'MG', ambiente: 'homologacao', xmlNfe: NFE_ASSINADA, idLote: '7',
    transporte: transporteCom(envelope('NFeAutorizacao4', retEnvi('104', 'Lote processado', protocolo('100', 'Autorizado o uso da NF-e'))), registro)
  });
  assert.equal(r.cStat, '104');
  assert.equal(r.protocolo.cStat, '100');
  assert.equal(r.protocolo.situacao, 'autorizada');
  assert.equal(r.protocolo.nProt, '131260000123456');
  assert.equal(r.protocolo.chNFe, CHAVE);
  assert.equal(r.protocolo.dhRecbto, '2026-09-15T15:10:01-03:00');
  assert.ok(r.protocolo.xml.startsWith('<protNFe versao="4.00"><infProt'));
  assert.equal(r.recibo, null);
  assert.equal(registro[0].url, 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4');
  assert.match(registro[0].cabecalhos['Content-Type'], /action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeAutorizacao4\/nfeAutorizacaoLote"/);
  assert.match(registro[0].corpo, /<nfeDadosMsg xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeAutorizacao4"><enviNFe [^>]*><idLote>7<\/idLote><indSinc>1<\/indSinc><NFe/);
});

test('protocolo com rejeição ou denegação, lote rejeitado e recibo assíncrono são lidos com a situação certa', async () => {
  const rejeitada = sefaz.lerRetornoEnvio(retEnvi('104', 'Lote processado', protocolo('539', 'Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso', '')));
  assert.equal(rejeitada.protocolo.situacao, 'rejeitada');
  assert.equal(rejeitada.protocolo.nProt, null);
  assert.equal(sefaz.lerRetornoEnvio(retEnvi('104', 'Lote processado', protocolo('302', 'Uso Denegado: Irregularidade fiscal do destinatario'))).protocolo.situacao, 'denegada');

  const loteRejeitado = sefaz.lerRetornoEnvio(retEnvi('225', 'Rejeicao: Falha no Schema XML'));
  assert.equal(loteRejeitado.cStat, '225');
  assert.equal(loteRejeitado.protocolo, null);
  assert.equal(loteRejeitado.recibo, null);

  const recebido = sefaz.lerRetornoEnvio(retEnvi('103', 'Lote recebido com sucesso', '<infRec><nRec>311000012345678</nRec><tMed>2</tMed></infRec>'));
  assert.equal(recebido.recibo, '311000012345678');
  assert.equal(recebido.tempoMedioSegundos, 2);
  assert.equal(recebido.protocolo, null);

  for (const [c, s] of [['100', 'autorizada'], ['150', 'autorizada'], ['101', 'cancelada'], ['110', 'denegada'], ['301', 'denegada'], ['303', 'denegada'], ['204', 'rejeitada'], ['999', 'rejeitada']]) {
    assert.equal(sefaz.situacaoDoProtocolo(c), s, c);
  }
});

test('consultarRecibo: 105 ainda processando, 104 traz o protocolo; consultarNfe: 217 não consta, 100 protocolo, 101 cancelada', async () => {
  const retRecibo = (cStat, xMotivo, dentro = '') => `<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG</verAplic><nRec>311000012345678</nRec><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF>${dentro}</retConsReciNFe>`;
  const processando = await sefaz.consultarRecibo({ uf: 'MG', ambiente: 'homologacao', recibo: '311000012345678', transporte: transporteCom(envelope('NFeRetAutorizacao4', retRecibo('105', 'Lote em processamento'))) });
  assert.equal(processando.emProcessamento, true);
  assert.equal(processando.protocolo, null);
  const registro = [];
  const pronto = await sefaz.consultarRecibo({ uf: 'MG', ambiente: 'homologacao', recibo: '311000012345678', transporte: transporteCom(envelope('NFeRetAutorizacao4', retRecibo('104', 'Lote processado', protocolo('100', 'Autorizado o uso da NF-e'))), registro) });
  assert.equal(pronto.protocolo.situacao, 'autorizada');
  assert.equal(registro[0].url, 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4');

  const retSit = (cStat, xMotivo, dentro = '') => `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><verAplic>MG</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>31</cUF><chNFe>${CHAVE}</chNFe>${dentro}</retConsSitNFe>`;
  const naoConsta = await sefaz.consultarNfe({ uf: 'MG', ambiente: 'homologacao', chave: CHAVE, transporte: transporteCom(envelope('NFeConsultaProtocolo4', retSit('217', 'Rejeicao: NF-e nao consta na base de dados da SEFAZ'))) });
  assert.equal(naoConsta.naoConsta, true);
  assert.equal(naoConsta.situacao, null);
  assert.equal(naoConsta.protocolo, null);
  const autorizada = await sefaz.consultarNfe({ uf: 'MG', ambiente: 'homologacao', chave: CHAVE, transporte: transporteCom(envelope('NFeConsultaProtocolo4', retSit('100', 'Autorizado o uso da NF-e', protocolo('100', 'Autorizado o uso da NF-e')))) });
  assert.equal(autorizada.situacao, 'autorizada');
  assert.equal(autorizada.protocolo.nProt, '131260000123456');
  const cancelada = await sefaz.consultarNfe({ uf: 'MG', ambiente: 'homologacao', chave: CHAVE, transporte: transporteCom(envelope('NFeConsultaProtocolo4', retSit('101', 'Cancelamento de NF-e homologado', protocolo('101', 'Cancelamento de NF-e homologado') + '<procEventoNFe versao="1.00"><evento></evento></procEventoNFe>'))) });
  assert.equal(cancelada.situacao, 'cancelada');
  assert.equal(cancelada.protocolo.situacao, 'cancelada');
  assert.equal(cancelada.eventos.length, 1);
});

test('evento de cancelamento: mensagem, validações, lote assinado, leitura do retorno (128/135) e procEventoNFe', async () => {
  const base = { uf: 'MG', ambiente: 'homologacao', cnpj: '44.039.257/0001-22', chave: CHAVE, protocolo: '131260000123456', justificativa: '  Pedido   cancelado pelo cliente  ', dhEvento: '2026-09-15T15:30:00-03:00' };
  const evento = sefaz.xmlEventoCancelamento(base);
  assert.equal(evento, `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="ID110111${CHAVE}01"><cOrgao>31</cOrgao><tpAmb>2</tpAmb><CNPJ>44039257000122</CNPJ><chNFe>${CHAVE}</chNFe><dhEvento>2026-09-15T15:30:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>131260000123456</nProt><xJust>Pedido cancelado pelo cliente</xJust></detEvento></infEvento></evento>`);
  assert.match(sefaz.xmlEventoCancelamento({ ...base, justificativa: 'Cliente & filhos desistiram do pedido' }), /<xJust>Cliente &amp; filhos desistiram do pedido<\/xJust>/);
  assert.throws(() => sefaz.xmlEventoCancelamento({ ...base, justificativa: 'curta' }), /entre 15 e 255/);
  assert.throws(() => sefaz.xmlEventoCancelamento({ ...base, protocolo: '' }), /protocolo/);
  assert.throws(() => sefaz.xmlEventoCancelamento({ ...base, chave: '123' }), /Chave de acesso inválida/);
  assert.throws(() => sefaz.xmlEnvEvento({ idLote: '1', xmlEvento: evento }), /assinado/);

  const assinado = evento.replace('</infEvento></evento>', '</infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo></SignedInfo></Signature></evento>');
  assert.ok(sefaz.xmlEnvEvento({ idLote: '7', xmlEvento: assinado }).startsWith('<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>7</idLote><evento'));

  const retEvento = (cStat, xMotivo) => `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cOrgao>31</cOrgao><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${CHAVE}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-09-15T16:00:00-03:00</dhRegEvento><nProt>131260000222222</nProt></infEvento></retEvento>`;
  const retorno = `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>7</idLote><tpAmb>2</tpAmb><verAplic>MG</verAplic><cOrgao>31</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>${retEvento('135', 'Evento registrado e vinculado a NF-e')}</retEnvEvento>`;
  const lido = sefaz.lerRetornoEvento(retorno);
  assert.equal(lido.cStat, '128');
  assert.equal(lido.evento.cStat, '135');
  assert.equal(lido.evento.registrado, true);
  assert.equal(lido.evento.nProt, '131260000222222');
  assert.equal(lido.evento.dhRegEvento, '2026-09-15T16:00:00-03:00');
  assert.ok(lido.evento.xml.startsWith('<retEvento'));
  assert.equal(sefaz.lerRetornoEvento(retorno.replace('135', '573')).evento.registrado, false);
  assert.equal(sefaz.lerRetornoEvento('<retEnvEvento><cStat>225</cStat><xMotivo>Schema</xMotivo></retEnvEvento>').evento, null);

  const registro = [];
  const r = await sefaz.enviarEvento({ uf: 'MG', ambiente: 'homologacao', xmlEvento: assinado, idLote: '7', transporte: transporteCom(envelope('NFeRecepcaoEvento4', retorno), registro) });
  assert.equal(r.evento.registrado, true);
  assert.equal(registro[0].url, 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4');
  assert.match(registro[0].cabecalhos['Content-Type'], /NFeRecepcaoEvento4\/nfeRecepcaoEvento"/);

  const proc = sefaz.montarProcEvento(assinado, lido.evento.xml);
  assert.ok(proc.startsWith('<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento'));
  assert.ok(proc.endsWith('</retEvento></procEventoNFe>'));
  assert.throws(() => sefaz.montarProcEvento(evento, lido.evento.xml), /assinado/);
});

test('montarNfeProc junta a NF-e assinada e o protocolo no formato de distribuição', () => {
  const proc = sefaz.montarNfeProc(NFE_ASSINADA, protocolo('100', 'Autorizado o uso da NF-e'));
  assert.ok(proc.startsWith('<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns='));
  assert.ok(proc.endsWith('</infProt></protNFe></nfeProc>'));
  assert.throws(() => sefaz.montarNfeProc('<NFe><infNFe></infNFe></NFe>', protocolo('100', 'ok')), /precisa estar assinada/);
  assert.throws(() => sefaz.montarNfeProc(NFE_ASSINADA, ''), /Protocolo ausente/);
});
