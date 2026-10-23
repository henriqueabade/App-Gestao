const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const zlib = require('node:zlib');
const forge = require('node-forge');

const redeSegura = require('./redeSegura');
const { INTERMEDIARIAS, RAIZES } = require('./listaEmudhra');

// PKI de teste criada na hora (nada de chave ou certificado no repositório):
// raiz → intermediária → folha, como as cadeias de verdade.
function parDeChaves() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const chave = forge.pki.privateKeyFromPem(pem);
  return { pem, chave, publica: forge.pki.setRsaPublicKey(chave.n, chave.e) };
}
let serie = 1;
function emitir({ assunto, emissor, chaveDoEmissor, publica, autoridade, nomes = [], ips = [] }) {
  const c = forge.pki.createCertificate();
  c.publicKey = publica;
  c.serialNumber = String(serie++).padStart(2, '0');
  c.validity.notBefore = new Date(Date.now() - 60_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: assunto }]);
  c.setIssuer([{ name: 'commonName', value: emissor }]);
  c.setExtensions(autoridade
    ? [{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]
    : [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [...nomes.map(value => ({ type: 2, value })), ...ips.map(ip => ({ type: 7, ip }))] }]);
  c.sign(chaveDoEmissor, forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}
function criarPki() {
  const raiz = parDeChaves();
  const inter = parDeChaves();
  const folha = parDeChaves();
  const raizPem = emitir({ assunto: 'Raiz de Teste', emissor: 'Raiz de Teste', chaveDoEmissor: raiz.chave, publica: raiz.publica, autoridade: true });
  const interPem = emitir({ assunto: 'Intermediaria de Teste', emissor: 'Raiz de Teste', chaveDoEmissor: raiz.chave, publica: inter.publica, autoridade: true });
  const folhaDe = (nomes, ips) => emitir({ assunto: nomes[0] || ips[0], emissor: 'Intermediaria de Teste', chaveDoEmissor: inter.chave, publica: folha.publica, nomes, ips });
  return {
    raizPem,
    interPem,
    chaveDaFolha: folha.pem,
    cadeia: (nomes = ['localhost'], ips = ['127.0.0.1']) => folhaDe(nomes, ips) + interPem
  };
}

function servidorHttps(pki, cadeia) {
  return new Promise(pronto => {
    const s = https.createServer({ key: pki.chaveDaFolha, cert: cadeia }, (_req, res) => res.end('ok'));
    s.listen(0, '127.0.0.1', () => pronto(s));
  });
}
function servidorHttp(responder) {
  return new Promise(pronto => {
    const s = http.createServer(responder);
    s.listen(0, '127.0.0.1', () => pronto(s));
  });
}
const fechar = s => new Promise(pronto => { s.close(pronto); s.closeAllConnections?.(); });

function conectar(opcoes) {
  return new Promise(pronto => {
    const s = tls.connect({ rejectUnauthorized: true, ...opcoes }, () => { s.end(); pronto({ ok: true }); });
    s.on('error', e => pronto({ ok: false, codigo: e.code, mensagem: e.message }));
  });
}

let pki;
let instalada;
test.before(() => {
  pki = criarPki();
  instalada = redeSegura.instalar();
});
test.after(() => {
  redeSegura._paraTestes.limpar();
  instalada.desinstalar();
});

test('lista eMudhra: as 8 intermediárias do Node 24.22.1 e as raízes G3, C1 e C3; a G1 continua', () => {
  assert.equal(INTERMEDIARIAS.length, 8);
  assert.deepEqual(RAIZES.map(r => r.nome), ['emSign ECC Root CA - G3', 'emSign Root CA - C1', 'emSign ECC Root CA - C3']);
  for (const e of [...INTERMEDIARIAS, ...RAIZES]) assert.match(e.spki, /^[0-9a-f]{64}$/);
  const nomeDaRaiz = pem => (new crypto.X509Certificate(pem).subject.split('\n').find(l => l.startsWith('CN=')) || '').slice(3);
  // A loja embutida perde só as bloqueadas (no Node 18 do Electron 28 ainda há G3, C1 e C3).
  const embutidas = tls.rootCertificates.map(nomeDaRaiz);
  const confiaveis = redeSegura.raizesConfiaveis().map(nomeDaRaiz);
  for (const nome of RAIZES.map(r => r.nome)) assert.ok(!confiaveis.includes(nome), `${nome} não pode ficar`);
  if (embutidas.includes('emSign Root CA - G1')) assert.ok(confiaveis.includes('emSign Root CA - G1'));
  assert.equal(embutidas.length - confiaveis.length, embutidas.filter(n => RAIZES.some(r => r.nome === n)).length);
});

test('nome do servidor: IP escrito de forma não canônica é reconhecido', () => {
  for (const h of ['127.1', '0x7f.0.0.1', '2130706433', '0177.0.0.1', '１２７.０.０.１', '127。0.0.1']) {
    assert.equal(redeSegura.hostIpNaoCanonico(h), true, h);
  }
  // "1.2.3.4." é IP canônico com ponto final: o Node já o confere como IP.
  for (const h of ['api.santissimodecor.com.br', 'api.bb.com.br', 'nfe.fazenda.mg.gov.br', '127.0.0.1', '1.2.3.4.', '::1', 'localhost', 'exemplo.com.', 'xn--nxasmq6b.com', '']) {
    assert.equal(redeSegura.hostIpNaoCanonico(h), false, h);
  }
});

test('Brotli: o zlib não descomprime nada (sync, callback, fluxo e classe)', async () => {
  const br = zlib.brotliCompressSync(Buffer.from('olá mundo')); // conteúdo comum (a compressão segue liberada)
  assert.throws(() => zlib.brotliDecompressSync(br), { code: 'ERR_BROTLI_DESATIVADO' });
  await new Promise(pronto => zlib.brotliDecompress(br, erro => { assert.equal(erro?.code, 'ERR_BROTLI_DESATIVADO'); pronto(); }));
  for (const fluxo of [zlib.createBrotliDecompress(), new zlib.BrotliDecompress()]) {
    await new Promise(pronto => {
      fluxo.on('data', () => assert.fail('não pode sair dado descomprimido'));
      fluxo.on('error', e => { assert.equal(e.code, 'ERR_BROTLI_DESATIVADO'); pronto(); });
      fluxo.end(br);
    });
  }
  if (typeof DecompressionStream === 'function' && process.versions.node.split('.')[0] >= 24) {
    assert.throws(() => new DecompressionStream('brotli'), { code: 'ERR_BROTLI_DESATIVADO' });
    assert.ok(new DecompressionStream('gzip'));
  }
  // A compressão (que não tem a falha) continua.
  assert.ok(zlib.brotliCompressSync(Buffer.from('ok')).length > 0);
});

test('fetch: pede só gzip/deflate, recusa br antes do corpo (mesmo se o servidor ignorar) e gzip segue', async () => {
  const recebidos = [];
  const corpoBr = zlib.brotliCompressSync(Buffer.from('{"ok":"br"}'));
  const corpoGz = zlib.gzipSync(Buffer.from('{"ok":"gzip"}'));
  const s = await servidorHttp((req, res) => {
    recebidos.push(req.headers['accept-encoding']);
    if (req.url === '/gz') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); return res.end(corpoGz); }
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' }); return res.end(corpoBr);
  });
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/gz`)).json(), { ok: 'gzip' });
    await assert.rejects(fetch(`${base}/br`), { code: 'ERR_BROTLI_DESATIVADO' });
    await assert.rejects(fetch(`${base}/br`, { headers: { 'Accept-Encoding': 'br, gzip' } }), { code: 'ERR_BROTLI_DESATIVADO' });
    for (let i = 0; i < 5; i++) await fetch(`${base}/br`).catch(() => null); // o processo não cai
    assert.deepEqual(recebidos, ['gzip, deflate', 'gzip, deflate', 'gzip', 'gzip, deflate', 'gzip, deflate', 'gzip, deflate', 'gzip, deflate', 'gzip, deflate']);
  } finally {
    await fechar(s);
  }
  assert.equal(redeSegura.semBrotli('br;q=1.0, gzip;q=0.8'), 'gzip;q=0.8');
  assert.equal(redeSegura.semBrotli('br'), 'identity');
  assert.equal(redeSegura.temBrotli('gzip, BR'), true);
  assert.equal(redeSegura.temBrotli('gzip'), false);
});

test('TLS: cadeia válida passa; com a intermediária ou a raiz bloqueada é recusada (tls, https e fetch)', async () => {
  const valido = await servidorHttps(pki, pki.cadeia());
  try {
    // ca explícito (como a SEFAZ com as raízes da ICP-Brasil)
    assert.deepEqual(await conectar({ host: '127.0.0.1', port: valido.address().port, servername: 'localhost', ca: pki.raizPem }), { ok: true });
    // loja padrão (fetch, BB, API): a raiz de teste entra só por este gancho de teste
    redeSegura._paraTestes.confiarEmRaiz(pki.raizPem);
    assert.equal(await (await fetch(`https://127.0.0.1:${valido.address().port}/`)).text(), 'ok');
  } finally {
    await fechar(valido);
  }

  // Outro servidor (outra origem): o fetch reaproveita conexão e sessão TLS já
  // conferidas, e no programa a lista vale desde a partida.
  const s = await servidorHttps(pki, pki.cadeia());
  const porta = s.address().port;
  try {
    redeSegura._paraTestes.bloquear(pki.interPem, 'Intermediaria de Teste');
    const r1 = await conectar({ host: '127.0.0.1', port: porta, servername: 'localhost', ca: pki.raizPem });
    assert.equal(r1.ok, false);
    assert.equal(r1.codigo, 'CERT_REVOKED');
    assert.match(r1.mensagem, /Intermediaria de Teste/);
    await assert.rejects(fetch(`https://127.0.0.1:${porta}/x`), e => e.cause?.code === 'CERT_REVOKED');
    await new Promise(pronto => https.get({ host: '127.0.0.1', port: porta, servername: 'localhost', ca: pki.raizPem, agent: false }, () => assert.fail('aceitou'))
      .on('error', e => { assert.equal(e.code, 'CERT_REVOKED'); pronto(); }));

    redeSegura._paraTestes.limpar();
    redeSegura._paraTestes.bloquear(pki.raizPem, 'Raiz de Teste');
    const r2 = await conectar({ host: '127.0.0.1', port: porta, servername: 'localhost', ca: pki.raizPem });
    assert.equal(r2.ok, false); // a raiz bloqueada sai da lista ca e a cadeia não fecha
  } finally {
    redeSegura._paraTestes.limpar();
    await fechar(s);
  }
});

test('TLS: host "127.1" com certificado de nome "127.1" é recusado (CVE-2026-106069/-106072)', async () => {
  const s = await servidorHttps(pki, pki.cadeia(['127.1'], []));
  try {
    const r = await conectar({ host: '127.0.0.1', port: s.address().port, servername: '127.1', ca: pki.raizPem });
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'ERR_TLS_CERT_ALTNAME_INVALID');
    assert.match(r.mensagem, /não canônica/);
  } finally {
    await fechar(s);
  }
});

test('keep-alive: o Agent global do http/https não reaproveita conexão', () => {
  assert.equal(http.globalAgent.keepAlive, false);
  assert.equal(https.globalAgent.keepAlive, false);
});
