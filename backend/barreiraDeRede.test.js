const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const barreira = require('./barreiraDeRede');

// TEST-NET-3 (RFC 5737): endereço que nunca é de ninguém.
const DE_FORA = '203.0.113.10';

function conectar(opcoes) {
  return new Promise(resolve => {
    const s = net.connect(opcoes);
    s.once('connect', () => { s.destroy(); resolve('conectou'); });
    s.once('error', e => resolve(e));
  });
}

test('lê o destino de todas as formas de Socket#connect', () => {
  assert.deepEqual(barreira.destinoDe([{ host: 'a.b', port: 1 }]), { host: 'a.b', porta: 1 });
  assert.deepEqual(barreira.destinoDe([[{ host: 'a.b', port: 2 }, () => {}]]), { host: 'a.b', porta: 2 });
  assert.deepEqual(barreira.destinoDe([{ port: 3 }]), { host: 'localhost', porta: 3 });
  assert.deepEqual(barreira.destinoDe([4, 'c.d']), { host: 'c.d', porta: 4 });
  assert.equal(barreira.destinoDe([{ path: '/tmp/x.sock' }]).local, true);
  assert.equal(barreira.destinoDe(['/tmp/x.sock']).local, true);
});

test('permitido: só o próprio computador, salvo os hosts liberados', () => {
  assert.equal(barreira.permitido({ host: '127.0.0.1' }), true);
  assert.equal(barreira.permitido({ host: 'localhost' }), true);
  assert.equal(barreira.permitido({ host: 'api.santissimodecor.com.br' }), false);
  assert.equal(barreira.permitido({ host: 'api.hm.bb.com.br' }, ['api.hm.bb.com.br']), true);
  assert.equal(barreira.permitido({ host: 'API.HM.BB.COM.BR.' }, ['api.hm.bb.com.br']), true);
});

test('com a barreira, nada sai do computador: TCP, HTTP, fetch, PostgreSQL e SMTP', async t => {
  const avisos = [];
  const ligada = barreira.instalar({ avisar: m => avisos.push(m) });
  t.after(() => ligada.desinstalar());

  // O próprio computador continua acessível.
  const servidor = http.createServer((req, res) => res.end('ok'));
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  t.after(() => servidor.close());
  const { port } = servidor.address();
  assert.equal(await conectar({ host: '127.0.0.1', port }), 'conectou');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');

  // De fora, não: o erro é da barreira, não de rede.
  const tcp = await conectar({ host: DE_FORA, port: 443 });
  assert.equal(tcp.code, barreira.CODIGO);
  const viaHttp = await new Promise(resolve => http.get(`http://${DE_FORA}/`, () => resolve('respondeu')).on('error', resolve));
  assert.equal(viaHttp.code, barreira.CODIGO);
  // Por nome (domínio reservado da IANA: mesmo se a barreira falhasse, não é serviço de ninguém).
  const porNome = await new Promise(resolve => http.get('http://servico-de-fora.example.com/', () => resolve('respondeu')).on('error', resolve));
  assert.equal(porNome.code, barreira.CODIGO);
  await assert.rejects(fetch(`https://${DE_FORA}/`), e => e.cause && e.cause.code === barreira.CODIGO);

  const { Client } = require('pg');
  const pg = new Client({ host: DE_FORA, port: 5432, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 3000 });
  await assert.rejects(pg.connect(), e => e.code === barreira.CODIGO);

  const nodemailer = require('nodemailer');
  const smtp = nodemailer.createTransport({ host: DE_FORA, port: 587, connectionTimeout: 3000 });
  await assert.rejects(smtp.verify(), e => e.code === barreira.CODIGO || /barreira-de-rede/.test(String(e.message)));

  assert.ok(avisos.every(a => a.startsWith('[barreira-de-rede]')) && avisos.length >= 5);
});

test('regras do Chromium: tudo vira NOTFOUND, menos localhost e os liberados', () => {
  assert.equal(barreira.regrasDoChromium(), 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1');
  assert.equal(barreira.regrasDoChromium(['api.hm.bb.com.br']), 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE api.hm.bb.com.br');
});
