/**
 * Segredos no banco (chaveMestra.js + segredoBanco.js): cifra AES-256-GCM com
 * a chave do .env; sem a chave nada é lido nem gravado; chave diferente ou
 * registro alterado não abre; o banco nunca vê o valor em claro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const chaveMestra = require('./chaveMestra');
const segredoBanco = require('./segredoBanco');

function apiFalsa() {
  const linhas = [];
  let proximoId = 1;
  return {
    linhas,
    async get(_p, { query = {} } = {}) { return linhas.filter(l => Object.entries(query).every(([c, v]) => String(l[c]) === String(v))); },
    async post(_p, body) { const l = { id: proximoId++, ...body }; linhas.push(l); return l; },
    async put(p, body) { const id = p.split('/').pop(); const l = linhas.find(x => String(x.id) === id); Object.assign(l, body); return l; },
    async delete(p) { const id = p.split('/').pop(); const i = linhas.findIndex(x => String(x.id) === id); if (i >= 0) linhas.splice(i, 1); return {}; }
  };
}

test('chave mestra: gerar dá 64 hex; carregar aceita hex ou base64 de 32 bytes e recusa o resto; cifrar/decifrar fecham', () => {
  const hex = chaveMestra.gerar();
  assert.match(hex, /^[0-9a-f]{64}$/);
  const chave = chaveMestra.carregar({ SEGREDOS_CHAVE_MESTRA: hex });
  assert.equal(chave.length, 32);
  assert.equal(chaveMestra.carregar({ SEGREDOS_CHAVE_MESTRA: chave.toString('base64') }).length, 32);
  assert.equal(chaveMestra.carregar({}), null);
  assert.equal(chaveMestra.carregar({ SEGREDOS_CHAVE_MESTRA: 'curta' }), null);
  const c = chaveMestra.cifrar(chave, 'senha-secreta');
  assert.equal(c.cifra, 'aes-256-gcm');
  assert.ok(!JSON.stringify(c).includes('senha-secreta'));
  assert.equal(chaveMestra.decifrar(chave, c), 'senha-secreta');
  assert.notEqual(chaveMestra.cifrar(chave, 'senha-secreta').valor, c.valor, 'IV novo a cada vez');
  assert.throws(() => chaveMestra.decifrar(chaveMestra.carregar({ SEGREDOS_CHAVE_MESTRA: chaveMestra.gerar() }), c));
  assert.throws(() => chaveMestra.decifrar(chave, { ...c, valor: Buffer.from('xx').toString('base64') }));
});

test('segredoBanco: guarda cifrado, lê de volta, atualiza no lugar, remove; sem chave não grava e avisa o que há', async () => {
  const chave = chaveMestra.gerar();
  const api = apiFalsa();
  const com = segredoBanco.criar({ env: { SEGREDOS_CHAVE_MESTRA: chave } });
  assert.equal(com.disponivel, true);
  assert.equal(await com.ler(api, 'certificado'), null);
  await com.guardar(api, 'certificado', { pfxBase64: 'QUJD', senha: 'segredo', nomeArquivo: 'a.pfx' }, { descricao: 'Certificado', usuarioId: 9 });
  assert.equal(api.linhas.length, 1);
  const bruto = JSON.stringify(api.linhas[0]);
  assert.ok(!bruto.includes('segredo') && !bruto.includes('QUJD'), 'nada em claro no banco');
  assert.equal(api.linhas[0].atualizado_por, 9);
  const lido = await com.ler(api, 'certificado');
  assert.deepEqual(lido.valor, { pfxBase64: 'QUJD', senha: 'segredo', nomeArquivo: 'a.pfx' });
  await com.guardar(api, 'certificado', { pfxBase64: 'REVG', senha: 'outra' });
  assert.equal(api.linhas.length, 1, 'atualiza a mesma linha');
  assert.equal((await com.ler(api, 'certificado')).valor.senha, 'outra');

  const sem = segredoBanco.criar({ env: {} });
  assert.equal(sem.disponivel, false);
  const aviso = await sem.ler(api, 'certificado');
  assert.equal(aviso.valor, null);
  assert.match(aviso.erro, /não tem a chave mestra/);
  await assert.rejects(sem.guardar(api, 'smtp_senha', { senha: 'x' }), e => e.status === 409 && /chave mestra/.test(e.message));

  const outra = segredoBanco.criar({ env: { SEGREDOS_CHAVE_MESTRA: chaveMestra.gerar() } });
  assert.match((await outra.ler(api, 'certificado')).erro, /chave diferente/);

  assert.equal(await com.remover(api, 'certificado'), true);
  assert.equal(api.linhas.length, 0);
  assert.equal(await com.remover(api, 'certificado'), false);
});
