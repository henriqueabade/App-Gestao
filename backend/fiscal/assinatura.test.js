/**
 * Assinatura XMLDSig da NF-e (backend/fiscal/assinatura.js).
 *
 * Assina um XML montado pelo xmlNfe.js com um certificado de teste e confere,
 * com o crypto do Node de forma independente, o resumo do infNFe canônico e a
 * assinatura do SignedInfo. Um byte alterado depois de assinar tem de ser
 * detectado. (O método foi validado contra a NF-e real nº 361 — DigestValue e
 * SignatureValue conferem — mas o XML dela tem dados de um cliente e não vem
 * para o repositório.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { gerarPfx } = require('./certificadoDeTeste');
const { abrirPfx } = require('./certificado');
const assinatura = require('./assinatura');

const SENHA = 'segredo';
const CERT = abrirPfx(gerarPfx({ cn: 'SANTISSIMO DECOR LTDA:44039257000122', senha: SENHA }), SENHA);

const NFE = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe31260944039257000122550010000003611140003053" versao="4.00">'
  + '<ide><cUF>31</cUF><cNF>14000305</cNF><natOp>Venda &amp; serviço</natOp></ide><emit><CNPJ>44039257000122</CNPJ></emit>'
  + '</infNFe></NFe>';

test('assina: Signature depois do infNFe, com os algoritmos que a SEFAZ exige e o certificado embutido', () => {
  const assinado = assinatura.assinarNfe(NFE, CERT);
  assert.ok(assinado.startsWith(NFE.replace('</infNFe></NFe>', '</infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>')));
  assert.ok(assinado.endsWith('</X509Certificate></X509Data></KeyInfo></Signature></NFe>'));
  assert.match(assinado, /<CanonicalizationMethod Algorithm="http:\/\/www\.w3\.org\/TR\/2001\/REC-xml-c14n-20010315"><\/CanonicalizationMethod>/);
  assert.match(assinado, /<SignatureMethod Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#rsa-sha1"><\/SignatureMethod>/);
  assert.match(assinado, /<Reference URI="#NFe31260944039257000122550010000003611140003053">/);
  assert.match(assinado, /<Transform Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#enveloped-signature"><\/Transform><Transform Algorithm="http:\/\/www\.w3\.org\/TR\/2001\/REC-xml-c14n-20010315"><\/Transform>/);
  assert.match(assinado, /<DigestMethod Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#sha1"><\/DigestMethod>/);
  assert.ok(!/<\w+[^>]*\/>/.test(assinado), 'sem tag autofechada');
  assert.ok(!/\s/.test(/<SignatureValue>([^<]*)</.exec(assinado)[1]), 'base64 numa linha só');
  assert.ok(!assinado.includes('BEGIN CERTIFICATE'), 'só o corpo base64 do certificado');
});

test('resumo e assinatura conferem com o crypto do Node; o infNFe canônico ganha o xmlns herdado', () => {
  const assinado = assinatura.assinarNfe(NFE, CERT);
  const canonico = assinatura.canonicalInfNFe(assinado);
  assert.ok(canonico.startsWith('<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id="NFe31260944039257000122550010000003611140003053" versao="4.00"><ide>'));
  assert.ok(canonico.endsWith('</infNFe>'));
  assert.ok(!canonico.includes('<Signature'));

  const digest = crypto.createHash('sha1').update(canonico, 'utf8').digest('base64');
  assert.equal(/<DigestValue>([^<]*)</.exec(assinado)[1], digest);

  const signedInfo = /<SignedInfo>[\s\S]*?<\/SignedInfo>/.exec(assinado)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const valor = Buffer.from(/<SignatureValue>([^<]*)</.exec(assinado)[1], 'base64');
  assert.equal(crypto.verify('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), CERT.certificadoPem, valor), true);

  assert.deepEqual(assinatura.verificarAssinatura(assinado), { assinada: true, digestConfere: true, assinaturaConfere: true });
});

test('um byte alterado depois da assinatura é detectado; assinar duas vezes ou sem chave é erro', () => {
  const assinado = assinatura.assinarNfe(NFE, CERT);
  const adulterado = assinado.replace('<cNF>14000305</cNF>', '<cNF>14000306</cNF>');
  const v = assinatura.verificarAssinatura(adulterado);
  assert.equal(v.digestConfere, false);
  assert.equal(v.assinaturaConfere, true, 'o SignedInfo não mudou, só o conteúdo');
  const semAssinatura = assinatura.verificarAssinatura(NFE);
  assert.equal(semAssinatura.assinada, false);

  assert.throws(() => assinatura.assinarNfe(assinado, CERT), /já está assinada/);
  assert.throws(() => assinatura.assinarNfe(NFE, { certificadoPem: CERT.certificadoPem }), /sem chave/);
  assert.throws(() => assinatura.assinarNfe('<NFe><infNFe Id="x"></infNFe>', CERT), /fora do formato/);
  assert.throws(() => assinatura.assinarNfe('<NFe xmlns="x"><infNFe versao="4.00"></infNFe></NFe>', CERT), /sem o atributo Id/);
});

test('assinarEvento: o Signature entra no evento e o resumo é do infEvento canônico', () => {
  const evento = '<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="ID110111312609440392570001225500100000036211400030531"><cOrgao>31</cOrgao><tpAmb>2</tpAmb></infEvento></evento>';
  const assinado = assinatura.assinarEvento(evento, CERT);
  assert.ok(assinado.startsWith(evento.replace('</infEvento></evento>', '</infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>')));
  assert.ok(assinado.endsWith('</Signature></evento>'));
  assert.match(assinado, /<Reference URI="#ID110111312609440392570001225500100000036211400030531">/);
  const canonico = '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID110111312609440392570001225500100000036211400030531"><cOrgao>31</cOrgao><tpAmb>2</tpAmb></infEvento>';
  assert.equal(/<DigestValue>([^<]*)</.exec(assinado)[1], crypto.createHash('sha1').update(canonico, 'utf8').digest('base64'));
  const signedInfo = /<SignedInfo>[\s\S]*?<\/SignedInfo>/.exec(assinado)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  assert.equal(crypto.verify('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), CERT.certificadoPem, Buffer.from(/<SignatureValue>([^<]*)</.exec(assinado)[1], 'base64')), true);
  assert.throws(() => assinatura.assinarEvento(assinado, CERT), /já está assinado/);
  assert.throws(() => assinatura.assinarEvento('<evento><infEvento></infEvento></evento>', CERT), /sem o atributo Id/);
});

test('assinarInutilizacao: o Signature entra no inutNFe com o resumo do infInut canônico', () => {
  const inut = '<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infInut Id="ID3126440392570001225500100000000500000000007"><tpAmb>2</tpAmb><xServ>INUTILIZAR</xServ></infInut></inutNFe>';
  const assinado = assinatura.assinarInutilizacao(inut, CERT);
  assert.ok(assinado.endsWith('</Signature></inutNFe>'));
  assert.match(assinado, /<Reference URI="#ID3126440392570001225500100000000500000000007">/);
  const canonico = '<infInut xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID3126440392570001225500100000000500000000007"><tpAmb>2</tpAmb><xServ>INUTILIZAR</xServ></infInut>';
  assert.equal(/<DigestValue>([^<]*)</.exec(assinado)[1], crypto.createHash('sha1').update(canonico, 'utf8').digest('base64'));
  assert.throws(() => assinatura.assinarInutilizacao(assinado, CERT), /já está assinad/);
  assert.throws(() => assinatura.assinarElemento('<a><b Id="1"></b></a>', { tag: 'b', pai: 'c', ...CERT }), /fora do formato/);
});

test('expandirAutofechadas e canonicalInfNFe aceitam XML de terceiros (com tag autofechada e xmlns já no infNFe)', () => {
  assert.equal(assinatura.expandirAutofechadas('<a><b x="1"/><c/></a>'), '<a><b x="1"></b><c></c></a>');
  const comXmlns = '<NFe><infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id="NFe1" versao="4.00"><ide/></infNFe></NFe>';
  assert.equal(assinatura.canonicalInfNFe(comXmlns), '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id="NFe1" versao="4.00"><ide></ide></infNFe>');
  assert.throws(() => assinatura.canonicalInfNFe('<NFe></NFe>'), /sem o elemento infNFe/);
});
