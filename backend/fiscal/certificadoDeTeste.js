/**
 * Gera um .pfx de mentira para os testes: chave RSA curta (rápida de gerar em
 * JS puro) e certificado autoassinado com o CN no formato do e-CNPJ
 * ("RAZAO SOCIAL:CNPJ"). Nunca é usado fora dos testes — a SEFAZ não aceitaria.
 */
const forge = require('node-forge');

function gerarPfx({ cn = 'EMPRESA TESTE LTDA:12345678000199', senha = 'segredo', diasValidade = 365, bits = 1024 } = {}) {
  const chaves = forge.pki.rsa.generateKeyPair(bits);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01';
  const agora = new Date();
  cert.validity.notBefore = new Date(agora.getTime() - 86400000);
  cert.validity.notAfter = new Date(agora.getTime() + diasValidade * 86400000);
  cert.setSubject([{ name: 'commonName', value: cn }, { name: 'countryName', value: 'BR' }]);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE' }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

module.exports = { gerarPfx };
