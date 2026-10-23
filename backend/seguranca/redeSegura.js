/**
 * Proteções de rede do processo principal para as falhas divulgadas em
 * 20-23/10/2026, enquanto o runtime do programa (Electron 28: Node 18.18.2 e
 * Chromium 120) não tem a correção. Instalada uma vez, no começo do main.js,
 * antes de qualquer módulo abrir conexão. Ver docs/seguranca-outubro-2026.md.
 *
 * 1. Brotli (CVE-2026-111497): o Node do Electron usa a brotli do Chromium, e a
 *    do Chromium 120 não tem a correção. Nenhum descompressor Brotli roda aqui:
 *    o zlib devolve um fluxo que falha sem decodificar nada, e o fetch pede só
 *    gzip/deflate e recusa a resposta br antes de ler o corpo (o servidor pode
 *    ignorar o Accept-Encoding, e o fetch descomprimiria assim mesmo).
 * 2. eMudhra/emSign: as autoridades de listaEmudhra.js saem da loja de
 *    confiança de toda conexão TLS e, se aparecerem na cadeia verificada, a
 *    conexão é recusada (mesma regra do Node 24.22.1).
 * 3. Nome do servidor (CVE-2026-106069, -106072, -105483): host que só vira IP
 *    depois de normalizado (127.1, 0x7f.0.0.1, dígitos de largura total) é
 *    recusado, como no Node 24.22.1.
 * 4. Keep-alive (CVE-2026-105481, no Agent do http/https): o Agent global não
 *    reaproveita conexão. No Node 18 já é assim; no Node 24 (Electron 45), não.
 *
 * Nada aqui afrouxa a verificação: a checagem do próprio Node continua
 * rodando, e o que se soma só recusa a mais. Cada parte se desliga em
 * instalar({ ... }) quando o runtime trouxer a correção.
 */
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const zlib = require('zlib');
const fs = require('fs');
const { Transform } = require('stream');
const { domainToASCII } = require('url');
const { INTERMEDIARIAS, RAIZES } = require('./listaEmudhra');

const ACEITO = 'gzip, deflate';
const BLOQUEADAS = new Map([...INTERMEDIARIAS, ...RAIZES].map(e => [e.spki, e.nome]));
// Só os testes acrescentam (chave e raiz de uma PKI de teste).
const bloqueadasDeTeste = new Map();
const raizesDeTeste = [];

let instalada = null;
let contexto = null;

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

/** SHA-256 (hex) do SubjectPublicKeyInfo de um certificado em PEM ou DER; null se não ler. */
function spkiDe(certificado) {
  try {
    const x = new crypto.X509Certificate(certificado);
    return crypto.createHash('sha256').update(x.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  } catch (_) {
    return null;
  }
}

/** Nome da autoridade bloqueada, ou null. */
function bloqueada(spki) {
  return BLOQUEADAS.get(spki) || bloqueadasDeTeste.get(spki) || null;
}

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Uma lista `ca` (texto, Buffer ou array, PEM com vários certificados) sem as autoridades bloqueadas. */
function semBloqueadas(ca) {
  const itens = [];
  for (const item of [].concat(ca)) {
    if (item == null) continue;
    const texto = Buffer.isBuffer(item) ? item.toString('latin1') : String(item);
    const pems = texto.match(PEM);
    if (pems) itens.push(...pems);
    else itens.push(item); // DER ou formato que só o Node entende: fica como veio
  }
  return itens.filter(c => !bloqueada(spkiDe(c)));
}

/** Raízes embutidas no Node (+ NODE_EXTRA_CA_CERTS, se houver), sem as bloqueadas. */
function raizesConfiaveis() {
  const extras = [];
  if (process.env.NODE_EXTRA_CA_CERTS) {
    try { extras.push(fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'latin1')); } catch (_) { /* o Node também só avisa */ }
  }
  return semBloqueadas([...tls.rootCertificates, ...extras, ...raizesDeTeste]);
}

/** Contexto TLS padrão (criado uma vez: montar um com ~140 raízes custa ~10 ms). */
function contextoPadrao() {
  if (!contexto) contexto = tls.createSecureContext({ ca: raizesConfiaveis() });
  return contexto;
}

function erroDeCadeia(nome) {
  const e = new Error(`Certificado recusado: a cadeia passa por uma autoridade bloqueada (incidente eMudhra/emSign, outubro de 2026): ${nome}.`);
  e.code = 'CERT_REVOKED';
  return e;
}

/** Erro se alguma chave da cadeia verificada (folha até a raiz da loja) estiver bloqueada. */
function conferirCadeia(certificado) {
  const vistos = new Set();
  for (let c = certificado; c && c.raw && !vistos.has(c.fingerprint256); c = c.issuerCertificate) {
    vistos.add(c.fingerprint256);
    const spki = spkiDe(c.raw);
    // Como no Node: chave que não se lê não passa.
    if (!spki) return erroDeCadeia(`chave ilegível em ${c.subject?.CN || 'certificado sem nome'}`);
    const nome = bloqueada(spki);
    if (nome) return erroDeCadeia(nome);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Nome do servidor
// ---------------------------------------------------------------------------

const semPontoFinal = h => String(h || '').replace(/\.+$/, '');

/** Host que não é IP escrito do jeito canônico, mas vira IP ao ser normalizado. */
function hostIpNaoCanonico(host) {
  const h = semPontoFinal(host);
  if (!h || net.isIP(h)) return false;
  // O Node 24.22.1 testa o domainToASCII; o parser de URL também desdobra os
  // IPv4 abreviados (127.1, 0x7f.1), que o domainToASCII do Node 18 não desdobra.
  const formas = [];
  try { formas.push(domainToASCII(h)); } catch (_) { /* sem forma ASCII */ }
  try { formas.push(new URL(`https://${h}/`).hostname); } catch (_) { /* não é host */ }
  return formas.some(f => net.isIP(semPontoFinal(f).replace(/^\[|\]$/g, '')) !== 0);
}

function erroDeHost(host) {
  const e = new Error(`Host recusado: "${host}" é um endereço IP escrito de forma não canônica.`);
  e.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
  e.reason = 'Host is a non-canonical IP address';
  e.host = host;
  return e;
}

const MARCA = Symbol('identidadeSegura');

/** checkServerIdentity que soma as recusas desta rodada à checagem original. */
function identidadeSegura(original, opcoes) {
  if (original[MARCA]) return original;
  const conferir = function checkServerIdentity(hostname, certificado) {
    if (opcoes.hostCanonico && hostIpNaoCanonico(hostname)) return erroDeHost(hostname);
    const erro = original(hostname, certificado);
    if (erro) return erro;
    return opcoes.emudhra ? conferirCadeia(certificado) : undefined;
  };
  conferir[MARCA] = true;
  return conferir;
}

// Opções que mexem no contexto TLS: com elas o Node monta um contexto próprio.
const DO_CONTEXTO = ['ca', 'cert', 'key', 'pfx', 'passphrase', 'ciphers', 'minVersion', 'maxVersion',
  'secureProtocol', 'ecdhCurve', 'sigalgs', 'dhparam', 'honorCipherOrder', 'crl', 'clientCertEngine',
  'privateKeyEngine', 'privateKeyIdentifier', 'secureOptions', 'sessionIdContext', 'ticketKeys', 'sessionTimeout'];

function opcoesSeguras(opcoes, config, identidadeOriginal) {
  const o = { ...opcoes };
  const original = typeof o.checkServerIdentity === 'function' ? o.checkServerIdentity : identidadeOriginal;
  o.checkServerIdentity = identidadeSegura(original, config);
  if (!config.emudhra || o.secureContext) return o; // contexto de quem chamou: a cadeia ainda é conferida acima
  if (o.ca) o.ca = semBloqueadas(o.ca);
  else if (DO_CONTEXTO.some(k => o[k] !== undefined)) o.ca = raizesConfiaveis();
  else o.secureContext = contextoPadrao();
  return o;
}

// ---------------------------------------------------------------------------
// Brotli
// ---------------------------------------------------------------------------

function erroBrotli() {
  const e = new Error('Conteúdo comprimido em Brotli recusado (CVE-2026-111497, runtime sem correção).');
  e.code = 'ERR_BROTLI_DESATIVADO';
  return e;
}

// Lançar erro dentro do fetch do Node 18 derruba o processo (o undici não pega):
// por isso o descompressor é um fluxo que falha no primeiro dado.
function fluxoQueRecusa() {
  return new Transform({
    transform(_dado, _codificacao, feito) { feito(erroBrotli()); },
    flush(feito) { feito(erroBrotli()); }
  });
}

/** Algum token "br" numa lista de codificações (Content-Encoding / Accept-Encoding). */
function temBrotli(valor) {
  return String(valor || '').toLowerCase().split(',').some(t => t.split(';')[0].trim() === 'br');
}

function semBrotli(valor) {
  if (!valor) return ACEITO;
  const resto = String(valor).split(',').filter(t => t.split(';')[0].trim().toLowerCase() !== 'br').map(t => t.trim()).filter(Boolean);
  return resto.length ? resto.join(', ') : 'identity';
}

function trocar(alvo, nome, valor, desfazer) {
  const antes = Object.getOwnPropertyDescriptor(alvo, nome);
  if (!antes) return;
  Object.defineProperty(alvo, nome, { ...antes, value: valor });
  desfazer.push(() => Object.defineProperty(alvo, nome, antes));
}

function desligarBrotli(desfazer) {
  trocar(zlib, 'createBrotliDecompress', () => fluxoQueRecusa(), desfazer);
  trocar(zlib, 'brotliDecompressSync', () => { throw erroBrotli(); }, desfazer);
  trocar(zlib, 'brotliDecompress', (_dados, opcoes, pronto) => {
    const cb = typeof opcoes === 'function' ? opcoes : pronto;
    process.nextTick(() => { if (typeof cb === 'function') cb(erroBrotli()); });
  }, desfazer);
  trocar(zlib, 'BrotliDecompress', new Proxy(zlib.BrotliDecompress, {
    construct: () => fluxoQueRecusa(),
    apply: () => fluxoQueRecusa()
  }), desfazer);
  // Node 24: DecompressionStream('brotli') (no Node 18 o formato nem existe).
  const Original = globalThis.DecompressionStream;
  if (typeof Original === 'function') {
    trocar(globalThis, 'DecompressionStream', new Proxy(Original, {
      construct(alvo, args, novo) {
        if (String(args[0]).toLowerCase() === 'brotli') throw erroBrotli();
        return Reflect.construct(alvo, args, novo);
      }
    }), desfazer);
  }
}

function fetchSeguro(original) {
  return async function fetch(entrada, init) {
    const opcoes = init ? { ...init } : {};
    const base = opcoes.headers ?? (typeof Request === 'function' && entrada instanceof Request ? entrada.headers : undefined);
    const cabecalhos = new Headers(base);
    cabecalhos.set('accept-encoding', semBrotli(cabecalhos.get('accept-encoding')));
    opcoes.headers = cabecalhos;
    const resposta = await original(entrada, opcoes);
    if (temBrotli(resposta.headers.get('content-encoding'))) {
      try { await resposta.body?.cancel(); } catch (_) { /* já fechado */ }
      throw erroBrotli();
    }
    return resposta;
  };
}

// ---------------------------------------------------------------------------
// Instalação
// ---------------------------------------------------------------------------

/**
 * Liga as proteções (uma vez por processo). Desligue uma parte só quando o
 * runtime do programa trouxer a correção dela.
 */
function instalar({ brotli = true, emudhra = true, hostCanonico = true, keepAlive = true } = {}) {
  if (instalada) return instalada;
  const config = { brotli, emudhra, hostCanonico, keepAlive };
  const desfazer = [];

  if (brotli) {
    desligarBrotli(desfazer);
    if (typeof globalThis.fetch === 'function') trocar(globalThis, 'fetch', fetchSeguro(globalThis.fetch), desfazer);
  }

  if (emudhra || hostCanonico) {
    const identidadeOriginal = tls.checkServerIdentity;
    const connectOriginal = tls.connect;
    trocar(tls, 'checkServerIdentity', identidadeSegura(identidadeOriginal, config), desfazer);
    trocar(tls, 'connect', function connect(...args) {
      const i = args.findIndex(a => a && typeof a === 'object');
      if (i >= 0) args[i] = opcoesSeguras(args[i], config, identidadeOriginal);
      else {
        // tls.connect(porta[, host][, callback]) sem opções.
        const posicao = args.findIndex(a => typeof a === 'function');
        args.splice(posicao >= 0 ? posicao : args.length, 0, opcoesSeguras({}, config, identidadeOriginal));
      }
      return connectOriginal.apply(this, args);
    }, desfazer);
  }

  if (keepAlive) {
    for (const [modulo, Agente] of [[http, http.Agent], [https, https.Agent]]) {
      const antes = modulo.globalAgent;
      if (antes && antes.keepAlive) {
        modulo.globalAgent = new Agente({ keepAlive: false });
        desfazer.push(() => { modulo.globalAgent = antes; });
      }
    }
  }

  instalada = {
    config,
    desinstalar() {
      while (desfazer.length) desfazer.pop()();
      contexto = null;
      instalada = null;
    }
  };
  return instalada;
}

/** Ganchos só para os testes: uma PKI de teste no lugar das autoridades reais. */
const _paraTestes = {
  bloquear(pem, nome = 'autoridade de teste') { bloqueadasDeTeste.set(spkiDe(pem), nome); contexto = null; },
  confiarEmRaiz(pem) { raizesDeTeste.push(pem); contexto = null; },
  limpar() { bloqueadasDeTeste.clear(); raizesDeTeste.length = 0; contexto = null; }
};

module.exports = {
  instalar,
  spkiDe,
  bloqueada,
  temBrotli,
  semBrotli,
  hostIpNaoCanonico,
  raizesConfiaveis,
  ACEITO,
  _paraTestes
};
