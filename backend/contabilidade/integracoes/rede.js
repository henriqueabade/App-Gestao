/**
 * A rede das integrações: HTTPS com (ou sem) o certificado da empresa como
 * certificado de cliente (mTLS). A SEFAZ (Distribuição de DF-e e o evento
 * do Ambiente Nacional) e o ADN da NFS-e exigem o e-CNPJ na conexão; o BB
 * pede nas APIs de conta em produção.
 *
 * Recebe chave e certificado em PEM (o certificado.js abre o .pfx), e NÃO o
 * .pfx: o OpenSSL 3 do Node recusa as cifras antigas que as ACs ainda usam
 * (armadilha já vencida no fiscal).
 *
 * `transporteHttps(cert)` devolve `(url, { metodo, cabecalhos, corpo }) =>
 * { status, cabecalhos, corpo (Buffer) }`. Os serviços recebem uma fábrica
 * de transporte — nos testes, uma função que devolve respostas de mentira.
 */
const https = require('https');

function erro(mensagem, status = 502, extra = null) {
  const e = new Error(mensagem);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** Erros de rede/TLS em português, dizendo com quem se tentava falar. */
function traduzirErro(e, destino = 'o servidor') {
  if (e?.status) return e;
  const codigo = String(e?.code || '');
  const msg = String(e?.message || '');
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|unable to get local issuer|CERT_HAS_EXPIRED|DEPTH_ZERO/i.test(msg + codigo)) {
    return erro(`O Node não confia no certificado de ${destino} (cadeia ICP-Brasil). Configure NFE_CA_PATH no .env com as raízes da ICP-Brasil.`, 502);
  }
  if (/alert|handshake|certificate required|bad certificate|EPROTO/i.test(msg + codigo)) {
    return erro(`${destino} recusou a conexão com o certificado da empresa (${msg || codigo}). Confira se o certificado está cadastrado/autorizado lá.`, 502);
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(codigo)) return erro(`Não foi possível achar ${destino} (sem internet ou endereço errado).`, 502);
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE/.test(codigo)) return erro(`${destino} não aceitou a conexão agora. Tente de novo em instantes.`, 502);
  return erro(`Falha de comunicação com ${destino}: ${msg || codigo || 'erro desconhecido'}`, 502);
}

/**
 * O transporte de verdade. `cert` null = sem certificado de cliente.
 * `ca` (conteúdo PEM) acrescenta raízes confiáveis (NFE_CA_PATH).
 */
function transporteHttps(cert = null, { timeoutMs = 45000, ca = null, destino = 'o servidor' } = {}) {
  return (url, { metodo = 'GET', cabecalhos = {}, corpo = null } = {}) => new Promise((resolve, reject) => {
    try {
      const agente = new https.Agent({
        ...(cert ? { key: cert.chavePrivadaPem, cert: [cert.certificadoPem, ...(cert.cadeiaPem || [])].join('\n') } : {}),
        minVersion: 'TLSv1.2',
        ...(ca ? { ca } : {}),
        keepAlive: false
      });
      const dados = corpo === null || corpo === undefined ? null : (Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo), 'utf8'));
      const req = https.request(url, {
        method: metodo,
        agent: agente,
        headers: { ...cabecalhos, ...(dados ? { 'Content-Length': dados.length } : {}) },
        timeout: timeoutMs
      }, res => {
        const partes = [];
        res.on('data', p => partes.push(p));
        res.on('end', () => resolve({ status: res.statusCode, cabecalhos: res.headers, corpo: Buffer.concat(partes) }));
      });
      req.on('timeout', () => req.destroy(erro(`${destino} não respondeu em ${Math.round(timeoutMs / 1000)} s.`, 504)));
      req.on('error', e => reject(traduzirErro(e, destino)));
      req.end(dados || undefined);
    } catch (e) {
      reject(traduzirErro(e, destino));
    }
  });
}

/** O corpo como texto (UTF-8). */
const texto = resposta => (Buffer.isBuffer(resposta?.corpo) ? resposta.corpo.toString('utf8') : String(resposta?.corpo ?? ''));

/** O corpo como JSON, ou `{ bruto }` quando não é. */
function json(resposta) {
  const t = texto(resposta);
  if (!t.trim()) return null;
  try { return JSON.parse(t); } catch (_) { return { bruto: t.slice(0, 2000) }; }
}

module.exports = { erro, traduzirErro, transporteHttps, texto, json };
