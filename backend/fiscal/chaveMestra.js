/**
 * Chave mestra dos segredos guardados no banco (AES-256-GCM).
 *
 * Senha não serve em hash: o app precisa do valor para usar (abrir o .pfx,
 * autenticar no SMTP). Então o que fica no banco é o valor CIFRADO, e a
 * chave que cifra fica fora do banco — em SEGREDOS_CHAVE_MESTRA no .env, que
 * viaja no instalador para todas as máquinas da empresa (e, no futuro, no
 * ambiente do servidor web). Um dump do banco sozinho não abre nada.
 */
const crypto = require('crypto');

const VARIAVEL = 'SEGREDOS_CHAVE_MESTRA';
const CIFRA = 'aes-256-gcm';

/** Gera uma chave nova (64 caracteres hexadecimais) para colar no .env. */
function gerar() {
  return crypto.randomBytes(32).toString('hex');
}

/** A chave do .env como Buffer de 32 bytes, ou null quando não há (ou é inválida). */
function carregar(env = process.env) {
  const bruto = String(env?.[VARIAVEL] || '').trim();
  if (!bruto) return null;
  if (/^[0-9a-fA-F]{64}$/.test(bruto)) return Buffer.from(bruto, 'hex');
  try {
    const b = Buffer.from(bruto, 'base64');
    if (b.length === 32) return b;
  } catch (_) { /* não é base64 */ }
  return null;
}

/** Texto -> { cifra, iv, tag, valor } (tudo base64). */
function cifrar(chave, texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIFRA, chave, iv);
  const valor = Buffer.concat([cipher.update(String(texto ?? ''), 'utf8'), cipher.final()]);
  return { cifra: CIFRA, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), valor: valor.toString('base64') };
}

/** O inverso; lança se a chave for outra ou o registro tiver sido alterado. */
function decifrar(chave, { cifra, iv, tag, valor } = {}) {
  if (cifra !== CIFRA) throw new Error(`Cifra desconhecida: ${cifra}`);
  const decipher = crypto.createDecipheriv(CIFRA, chave, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(valor, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { VARIAVEL, CIFRA, gerar, carregar, cifrar, decifrar };
