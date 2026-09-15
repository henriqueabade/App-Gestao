/**
 * Certificado digital A1 (.pfx) do emitente.
 *
 * O .pfx guarda a chave privada e o certificado do e-CNPJ. A SEFAZ usa os dois:
 * o certificado autentica a conexão TLS e a chave assina o XML da NF-e. Este
 * módulo só ABRE o arquivo e diz o que há dentro; onde ele fica e como a senha
 * é guardada é assunto de segredoLocal.js.
 *
 * Nada daqui vai ao renderer inteiro: `resumo()` devolve só o que a tela
 * precisa mostrar (titular, CNPJ, validade). A chave privada não sai do
 * backend, e a senha não sai de lugar nenhum.
 *
 * node-forge (JS puro) porque o Node lê .pfx para TLS, mas não expõe a chave
 * privada de dentro dele — e sem a chave em PEM não há assinatura do XML.
 */
const forge = require('node-forge');

/** Lê o .pfx e devolve chave, certificado e cadeia em PEM, com os dados do titular. */
function abrirPfx(conteudo, senha) {
  if (!conteudo || !conteudo.length) throw erro('Arquivo do certificado vazio.');

  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(conteudo).toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, String(senha ?? ''));
  } catch (e) {
    // O forge não distingue senha errada de arquivo estranho; a mensagem dele
    // é a única pista, e a de MAC é a de senha.
    const msg = String(e?.message || '');
    if (/MAC could not be verified|Invalid password/i.test(msg)) throw erro('Senha do certificado incorreta.');
    throw erro('O arquivo não é um certificado .pfx/.p12 válido.');
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])
  ].map(b => b.key).filter(Boolean);
  const certificados = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])
    .map(b => b.cert).filter(Boolean);

  if (!chaves.length) throw erro('O certificado não contém a chave privada (é preciso um A1 exportado com a chave).');
  if (!certificados.length) throw erro('O arquivo não contém certificado.');

  const chave = chaves[0];
  // O certificado do titular é o que casa com a chave; os outros são a cadeia.
  const titular = certificados.find(c => mesmaChave(c.publicKey, chave)) || certificados[0];
  const cadeia = certificados.filter(c => c !== titular);

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(titular),
    cadeiaPem: cadeia.map(c => forge.pki.certificateToPem(c)),
    ...dadosDoTitular(titular)
  };
}

function mesmaChave(publica, privada) {
  try {
    return publica.n.compareTo(privada.n) === 0 && publica.e.compareTo(privada.e) === 0;
  } catch (_) {
    return false;
  }
}

/** Titular, CNPJ e validade, para a tela e para conferir com o emitente. */
function dadosDoTitular(cert) {
  const cn = String(cert.subject.getField('CN')?.value || '');
  // No e-CNPJ o CN é "RAZAO SOCIAL:CNPJ".
  const partes = cn.split(':');
  const cnpj = partes.length > 1 ? partes[partes.length - 1].replace(/\D/g, '') : '';
  return {
    titular: partes.length > 1 ? partes.slice(0, -1).join(':').trim() : cn.trim(),
    cnpj: cnpj.length === 14 ? cnpj : null,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    numeroSerie: cert.serialNumber,
    emissor: String(cert.issuer.getField('CN')?.value || '')
  };
}

/** O que a tela mostra. Sem chave, sem senha, sem PEM. */
function resumo(dados, agora = new Date()) {
  if (!dados) return { configurado: false };
  const fim = new Date(dados.validoAte);
  const diasRestantes = Math.floor((fim - agora) / 86400000);
  return {
    configurado: true,
    titular: dados.titular,
    cnpj: dados.cnpj,
    emissor: dados.emissor,
    validoDe: new Date(dados.validoDe).toISOString(),
    validoAte: fim.toISOString(),
    diasRestantes,
    vencido: diasRestantes < 0,
    venceEmBreve: diasRestantes >= 0 && diasRestantes <= 30
  };
}

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

module.exports = { abrirPfx, resumo, dadosDoTitular };
