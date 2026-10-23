const test = require('node:test');
const assert = require('node:assert/strict');
const acessoLocal = require('./acessoLocal');
const { instalarNaSessao, respostaEmBrotli } = require('./sessoesElectron');

/** Sessão falsa: guarda os ouvintes que a proteção registra. */
function sessaoFalsa() {
  const ganchos = {};
  return {
    ganchos,
    webRequest: {
      onBeforeSendHeaders: (_filtro, fn) => { ganchos.antes = fn; },
      onHeadersReceived: (_filtro, fn) => { ganchos.cabecalhos = fn; }
    },
    setCertificateVerifyProc: fn => { ganchos.certificado = fn; }
  };
}

const respostaDe = (gancho, detalhes) => new Promise(r => gancho(detalhes, r));

test('Brotli na resposta: Content-Encoding (Linux) e X-Content-Encoding-Over-Network (Windows)', () => {
  assert.equal(respostaEmBrotli({ 'content-encoding': ['br'] }), true);
  assert.equal(respostaEmBrotli({ 'X-Content-Encoding-Over-Network': ['br'] }), true);
  assert.equal(respostaEmBrotli({ 'Content-Encoding': 'gzip' }), false);
  assert.equal(respostaEmBrotli({ 'X-Content-Encoding-Over-Network': ['gzip'] }), false);
  assert.equal(respostaEmBrotli({}), false);
});

test('a sessão cancela o br de fora no formato do Windows e deixa o backend local e o gzip passarem', async () => {
  acessoLocal.ativar(3001);
  try {
    const s = sessaoFalsa();
    const avisos = [];
    instalarNaSessao(s, { avisar: m => avisos.push(m) });
    const deFora = await respostaDe(s.ganchos.cabecalhos, { url: 'http://127.0.0.1:55555/x', responseHeaders: { 'Transfer-Encoding': ['chunked'], 'X-Content-Encoding-Over-Network': ['br'] } });
    assert.deepEqual(deFora, { cancel: true });
    assert.equal(avisos.length, 1);
    const gzip = await respostaDe(s.ganchos.cabecalhos, { url: 'https://cdn.example/x.js', responseHeaders: { 'X-Content-Encoding-Over-Network': ['gzip'] } });
    assert.deepEqual(gzip, {});
    const local = await respostaDe(s.ganchos.cabecalhos, { url: 'http://127.0.0.1:3001/api/x', responseHeaders: { 'content-encoding': ['br'] } });
    assert.deepEqual(local, {}, 'o backend local do próprio programa não é afetado');
  } finally {
    acessoLocal._desativar();
  }
});
