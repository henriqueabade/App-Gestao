/**
 * Assinatura digital da NF-e (XMLDSig enveloped, RSA-SHA1, C14N 1.0) — o que
 * a SEFAZ exige no leiaute 4.00.
 *
 * Sem biblioteca de XML: o xmlNfe.js já produz o `infNFe` na forma canônica
 * (sem espaços entre elementos, sem tag autofechada, escapes de C14N). Para a
 * forma canônica só falta declarar o namespace no próprio `infNFe`, que no
 * documento ele herda do `NFe`. O resumo (SHA-1) é calculado sobre isso, o
 * `SignedInfo` é assinado com a chave do A1, e o `Signature` entra depois do
 * `infNFe`. O método foi conferido contra uma NF-e real autorizada da empresa:
 * DigestValue e SignatureValue batem.
 */
const crypto = require('crypto');
const { NS } = require('./xmlNfe');

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

function erro(mensagem, status = 500) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

/** Tag autofechada não existe na forma canônica: `<a/>` vira `<a></a>`. */
function expandirAutofechadas(xml) {
  return xml.replace(/<([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*\/>/g, '<$1$2></$1>');
}

/** O `infNFe` como a C14N o vê: com o xmlns herdado declarado nele mesmo. */
function canonicalInfNFe(xml) {
  const m = /<infNFe(\s[^>]*)?>[\s\S]*?<\/infNFe>/.exec(String(xml || ''));
  if (!m) throw erro('XML sem o elemento infNFe.', 400);
  const trecho = expandirAutofechadas(m[0]);
  if (/<infNFe[^>]*\sxmlns=/.test(trecho)) return trecho;
  return trecho.replace(/^<infNFe/, `<infNFe xmlns="${NS}"`);
}

function idDoInfNFe(xml) {
  const m = /<infNFe[^>]*\sId="([^"]+)"/.exec(String(xml || ''));
  if (!m) throw erro('infNFe sem o atributo Id.', 400);
  return m[1];
}

function corpoDoCertificado(certificadoPem) {
  return String(certificadoPem || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

/** `SignedInfo` na forma canônica (a que se assina). */
function signedInfoCanonico(id, digest) {
  return `<SignedInfo xmlns="${NS_DSIG}">`
    + `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>`
    + `<SignatureMethod Algorithm="${RSA_SHA1}"></SignatureMethod>`
    + `<Reference URI="#${id}">`
    + `<Transforms><Transform Algorithm="${ENVELOPED}"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms>`
    + `<DigestMethod Algorithm="${SHA1}"></DigestMethod><DigestValue>${digest}</DigestValue>`
    + `</Reference></SignedInfo>`;
}

/**
 * Assina o `<NFe>` (sem assinatura) e devolve o XML com o `<Signature>`.
 * Lança se o XML já estiver assinado ou se faltar chave/certificado.
 */
function assinarNfe(xmlNfe, { chavePrivadaPem, certificadoPem } = {}) {
  if (!chavePrivadaPem || !certificadoPem) throw erro('Certificado digital sem chave ou sem certificado.', 409);
  const xml = String(xmlNfe || '');
  if (/<Signature[\s>]/.test(xml)) throw erro('A NF-e já está assinada.', 400);
  if (!/<\/infNFe><\/NFe>$/.test(xml)) throw erro('XML da NF-e fora do formato esperado (…</infNFe></NFe>).', 400);

  const id = idDoInfNFe(xml);
  const canonico = canonicalInfNFe(xml);
  const digest = crypto.createHash('sha1').update(canonico, 'utf8').digest('base64');
  const signedInfo = signedInfoCanonico(id, digest);
  const assinatura = crypto.sign('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), chavePrivadaPem).toString('base64');

  const signature = `<Signature xmlns="${NS_DSIG}">`
    + signedInfo.replace(` xmlns="${NS_DSIG}"`, '')
    + `<SignatureValue>${assinatura}</SignatureValue>`
    + `<KeyInfo><X509Data><X509Certificate>${corpoDoCertificado(certificadoPem)}</X509Certificate></X509Data></KeyInfo>`
    + `</Signature>`;
  return xml.replace(/<\/infNFe><\/NFe>$/, `</infNFe>${signature}</NFe>`);
}

/**
 * Assina um elemento `tag` (com atributo Id) que fecha logo antes de `pai`
 * fechar: o `Signature` entra entre os dois. É o mesmo processo do infNFe.
 */
function assinarElemento(xmlEntrada, { tag, pai, chavePrivadaPem, certificadoPem, rotulo = 'o XML' } = {}) {
  if (!chavePrivadaPem || !certificadoPem) throw erro('Certificado digital sem chave ou sem certificado.', 409);
  const xml = String(xmlEntrada || '');
  if (/<Signature[\s>]/.test(xml)) throw erro(`${rotulo} já está assinado.`, 400);
  const m = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`).exec(xml);
  const fecho = `</${tag}></${pai}>`;
  if (!m || !xml.includes(fecho)) throw erro(`${rotulo} fora do formato esperado (…${fecho}).`, 400);
  const id = new RegExp(`<${tag}[^>]*\\sId="([^"]+)"`).exec(xml)?.[1];
  if (!id) throw erro(`${tag} sem o atributo Id.`, 400);
  const trecho = expandirAutofechadas(m[0]);
  const canonico = new RegExp(`<${tag}[^>]*\\sxmlns=`).test(trecho) ? trecho : trecho.replace(new RegExp(`^<${tag}`), `<${tag} xmlns="${NS}"`);
  const digest = crypto.createHash('sha1').update(canonico, 'utf8').digest('base64');
  const signedInfo = signedInfoCanonico(id, digest);
  const assinatura = crypto.sign('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), chavePrivadaPem).toString('base64');
  const signature = `<Signature xmlns="${NS_DSIG}">${signedInfo.replace(` xmlns="${NS_DSIG}"`, '')}`
    + `<SignatureValue>${assinatura}</SignatureValue>`
    + `<KeyInfo><X509Data><X509Certificate>${corpoDoCertificado(certificadoPem)}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return xml.replace(fecho, `</${tag}>${signature}</${pai}>`);
}

/** Evento da NF-e (cancelamento, carta de correção): assina o `infEvento` dentro do `evento`. */
function assinarEvento(xmlEvento, cert = {}) {
  return assinarElemento(xmlEvento, { tag: 'infEvento', pai: 'evento', rotulo: 'O evento', ...cert });
}

/** Inutilização de numeração: assina o `infInut` dentro do `inutNFe`. */
function assinarInutilizacao(xmlInut, cert = {}) {
  return assinarElemento(xmlInut, { tag: 'infInut', pai: 'inutNFe', rotulo: 'A inutilização', ...cert });
}

/**
 * Confere uma NF-e assinada (nossa ou de terceiros): recalcula o resumo do
 * `infNFe` e verifica o `SignatureValue` com o certificado embutido.
 */
function verificarAssinatura(xmlAssinado) {
  const xml = String(xmlAssinado || '');
  const digestInformado = /<DigestValue>([^<]*)<\/DigestValue>/.exec(xml)?.[1]?.replace(/\s+/g, '') || null;
  const assinaturaInformada = /<SignatureValue>([^<]*)<\/SignatureValue>/.exec(xml)?.[1]?.replace(/\s+/g, '') || null;
  const certificado = /<X509Certificate>([^<]*)<\/X509Certificate>/.exec(xml)?.[1]?.replace(/\s+/g, '') || null;
  if (!digestInformado || !assinaturaInformada || !certificado) return { assinada: false, digestConfere: false, assinaturaConfere: false };

  const digestCalculado = crypto.createHash('sha1').update(canonicalInfNFe(xml), 'utf8').digest('base64');
  const signedInfo = /<SignedInfo(\s[^>]*)?>[\s\S]*?<\/SignedInfo>/.exec(xml)?.[0] || '';
  const canonico = expandirAutofechadas(/<SignedInfo[^>]*\sxmlns=/.test(signedInfo) ? signedInfo : signedInfo.replace(/^<SignedInfo/, `<SignedInfo xmlns="${NS_DSIG}"`));
  const pem = `-----BEGIN CERTIFICATE-----\n${certificado.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
  let assinaturaConfere = false;
  try {
    assinaturaConfere = crypto.verify('RSA-SHA1', Buffer.from(canonico, 'utf8'), pem, Buffer.from(assinaturaInformada, 'base64'));
  } catch (_) {
    assinaturaConfere = false;
  }
  return { assinada: true, digestConfere: digestCalculado === digestInformado, assinaturaConfere };
}

module.exports = { NS_DSIG, canonicalInfNFe, assinarNfe, assinarElemento, assinarEvento, assinarInutilizacao, verificarAssinatura, expandirAutofechadas, idDoInfNFe };
