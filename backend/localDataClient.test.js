const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

process.env.BANCO = 'DEV';
const { readMode, readDatabaseConfig } = require('./dataConfig');
const { createLocalDataClient } = require('./localDataClient');
const realDatabase = require('./localDatabase');

function fixture() {
  const memory = newDb();
  memory.public.none(`
    CREATE TABLE clientes (id serial PRIMARY KEY, nome text, ativo boolean, criado_em timestamptz DEFAULT now());
    CREATE TABLE perm_cli (modelo_id integer PRIMARY KEY, ativo boolean);
    CREATE TABLE tabela_fixa (id_prod integer PRIMARY KEY, vlr_prod numeric);
    CREATE TABLE usuarios (id serial PRIMARY KEY, nome text, email text, senha text, perfil text, status text, foto_usuario text);
    CREATE TABLE ia_extracoes (id serial PRIMARY KEY, dados jsonb, tags text[]);
  `);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  return { pool, api: createLocalDataClient(pool) };
}

test('modo padrão PROD; configuração DEV valida sem revelar valores', () => {
  assert.equal(readMode({}), 'PROD');
  assert.equal(readMode({ BANCO: ' dev ' }), 'DEV');
  assert.throws(() => readMode({ BANCO: 'segredo-invalido' }), error => !error.message.includes('segredo-invalido'));
  assert.throws(() => readDatabaseConfig({}), /DB_HOST/);
  const env = { DB_HOST: 'localhost', DB_USER: 'app', DB_NAME: 'teste', DB_PASSWORD: ' senha com espaços ' };
  assert.equal(readDatabaseConfig(env).password, env.DB_PASSWORD);
  assert.equal(readDatabaseConfig(env).port, 5432);
  assert.throws(() => readDatabaseConfig({ ...env, DB_PORT: '5432x' }), /DB_PORT/);
});

test('CRUD DEV usa SQL parametrizado, filtros, ordenação, paginação e datas JSON', async () => {
  const { api } = fixture();
  const one = await api.post('/api/clientes', { nome: "O'Brien", ativo: true });
  const two = await api.post('/clientes', { nome: 'Segundo', ativo: false });
  assert.equal(typeof one.criado_em, 'string');
  assert.equal((await api.get('/clientes', { query: { nome: "eq.O'Brien" } }))[0].id, one.id);
  assert.deepEqual((await api.get('/clientes', { query: { id: [one.id, two.id], select: 'id', order: 'id.desc', limit: 1 } })), [{ id: two.id }]);
  assert.deepEqual(await api.get('/clientes?id=1&id=2', { query: { select: 'id', order: 'id', offset: 1 } }), [{ id: two.id }]);
  await api.put(`/clientes/${one.id}`, { nome: 'Atualizado', ausente: undefined });
  assert.equal((await api.get(`/clientes/${one.id}`)).nome, 'Atualizado');
  assert.equal((await api.get(`/clientes/${two.id}`)).nome, 'Segundo');
  await api.patch(`/clientes/${one.id}`, { nome: null });
  assert.equal((await api.get('/clientes', { query: { nome: 'is.null' } })).length, 1);
  await api.delete(`/clientes/${one.id}`);
  assert.equal(await api.get(`/clientes/${one.id}`), null);
  assert.equal((await api.get('/clientes')).length, 1);
});

test('chaves de permissões e tabela fixa seguem o contrato dos controllers', async () => {
  const { api } = fixture();
  await api.post('/perm_cli', { modelo_id: 7, ativo: false });
  await api.put('/perm_cli/7', { ativo: true });
  assert.equal((await api.get('/perm_cli/7')).ativo, true);
  await api.post('/tabela_fixa', { id_prod: 12, vlr_prod: 50 });
  await api.put('/tabela_fixa/12', { vlr_prod: 75 });
  assert.equal(Number((await api.get('/tabela_fixa/12')).vlr_prod), 75);
  await api.delete('/tabela_fixa/12');
  assert.equal(await api.get('/tabela_fixa/12'), null);
});

test('arrays JSONB e arrays PostgreSQL preservam seus tipos na gravação', async () => {
  const { api } = fixture();
  const row = await api.post('/ia_extracoes', { dados: [{ texto: 'Item' }], tags: ['um', 'dois'] });
  assert.deepEqual(row.dados, [{ texto: 'Item' }]);
  assert.deepEqual(row.tags, ['um', 'dois']);
});

test('bloqueia injeção em nomes, projeções e ordem; valores maliciosos são dados', async () => {
  const { api } = fixture();
  const attack = "x'); DROP TABLE clientes; --";
  await api.post('/clientes', { nome: attack });
  assert.equal((await api.get('/clientes', { query: { nome: attack } })).length, 1);
  for (const query of [{ select: '* FROM usuarios;--' }, { order: 'id; DROP TABLE clientes' }, { 'id OR 1=1': 1 }, { limit: '-1' }]) {
    await assert.rejects(api.get('/clientes', { query }), { status: 400 });
  }
  await assert.rejects(api.get('/clientes;DROP TABLE usuarios'), { status: 400 });
  await assert.rejects(api.get('/pg_settings'), { status: 400 });
  await assert.rejects(api.get('/public.usuarios'), { status: 400 });
  await assert.rejects(api.put('/clientes', { nome: 'Todos' }), { status: 400 });
  await assert.rejects(api.delete('/clientes'), { status: 400 });
  assert.equal((await api.get('/clientes')).length, 1);
});

test('foto local respeita coluna TEXT e não chama a API de produção', async () => {
  const { api } = fixture();
  const user = await api.post('/usuarios', { nome: 'Teste' });
  const avatar = 'data:image/png;base64,iVBORw0KGgo=';
  const updated = await api.put(`/api/usuarios/${user.id}/avatar`, { avatar, avatar_version: 123 });
  assert.equal(updated.foto_usuario, avatar);
  await api.delete(`/api/usuarios/${user.id}/avatar`);
  assert.equal((await api.get(`/usuarios/${user.id}`)).foto_usuario, null);
});

test('erros do driver e payloads públicos não incluem credenciais nem SQL', async () => {
  const secret = 'SENHA-NAO-PODE-VAZAR';
  const raw = { code: '28P01', message: secret, detail: secret, password: secret, query: secret, host: secret };
  const safe = realDatabase.safeDatabaseError(raw);
  assert.ok(!String(safe.stack).includes(secret));
  assert.ok(!JSON.stringify(safe).includes(secret));
  const { sanitizarSaida } = require('./sanitizarSaida');
  assert.deepEqual(sanitizarSaida({ nome: 'Público', senha: secret, nested: { DB_HOST: secret, DB_PASSWORD: secret, token_hash: secret } }), { nome: 'Público', nested: {} });
  await assert.rejects(realDatabase.query('SELECT 1'), error => error.code === 'db-unavailable');
  assert.equal((await realDatabase.healthCheck()).ok, false);
});

test('login DEV consulta banco isolado, usa bcrypt e bloqueia conta inativa e JWT forjado', async t => {
  const { pool } = fixture();
  t.mock.method(realDatabase, 'query', pool.query.bind(pool));
  t.mock.method(global, 'fetch', async () => { throw new Error('DEV tentou acessar HTTP'); });
  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash('senha-teste', 4);
  await pool.query('INSERT INTO usuarios (nome,email,senha,perfil,status) VALUES ($1,$2,$3,$4,$5)', ['Usuário Teste', 'teste@example.invalid', hash, 'Sup Admin', 'ativo']);
  const backend = require('./backend');
  const user = await backend.loginUsuario(' TESTE@example.invalid ', 'senha-teste');
  assert.equal(user.id, 1);
  assert.equal(user.perfil, 'Sup Admin');
  assert.ok(!JSON.stringify(user).includes(hash));
  const auth = require('./localAuth');
  assert.equal(auth.verifyToken(user.token).id, 1);
  assert.throws(() => auth.verifyToken('test-token'), { status: 401 });
  assert.throws(() => auth.verifyToken(user.token + 'x'), { status: 401 });
  await assert.rejects(backend.loginUsuario('teste@example.invalid', 'errada'), { code: 'auth-failed' });
  await pool.query('UPDATE usuarios SET status = $1', ['aguardando_aprovacao']);
  await assert.rejects(backend.loginUsuario('teste@example.invalid', 'senha-teste'), { code: 'inactive-user' });
  assert.equal(require('./tokenStore').getToken(), null);
});

test('PROD continua usando HTTP e não carrega o driver/banco DEV', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const tokenPath = require.resolve('./backend/tokenStore');
    require.cache[tokenPath] = { exports: { getToken: () => 'fake' } };
    global.fetch = async url => { assert.equal(url, 'http://127.0.0.1:4999/api/clientes'); return {ok:true,json:async()=>[{id:99}]}; };
    const db = require('./backend/db');
    db.init('fake');
    Promise.all([db.get('/clientes'),require('./backend/apiHttpClient').createApiClient().get('/api/clientes')]).then(result=>{
      assert.equal(result[0][0].id,99); assert.equal(result[1][0].id,99);
      assert.ok(!require.cache[require.resolve('./backend/localDatabase')]);
      assert.ok(!require.cache[require.resolve('pg')]);
    }).catch(()=>process.exitCode=1);
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, BANCO: 'PROD', NODE_ENV: 'test', API_BASE_URL: 'http://127.0.0.1:4999' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('credenciais ficam fora do ambiente herdado pelo renderer', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const config = require('./backend/dataConfig');
    assert.equal(config.readDatabaseConfig().password, 'CREDENCIAL-FICTICIA');
    for (const key of ['DB_HOST','DB_PORT','DB_USER','DB_NAME','DB_PASSWORD']) assert.equal(process.env[key],undefined);
    require('./backend/publisher');
    assert.equal(process.env.DB_PASSWORD,undefined);
  `], { cwd: path.resolve(__dirname, '..'), env: {
    ...process.env, NODE_ENV: 'test', BANCO: 'DEV', DB_HOST: 'localhost', DB_PORT: '5432',
    DB_USER: 'teste', DB_NAME: 'teste', DB_PASSWORD: 'CREDENCIAL-FICTICIA'
  }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('servidor DEV exige sessão e não publica segredos, tabelas privadas ou erros SQL', async t => {
  const { pool } = fixture();
  t.mock.method(realDatabase, 'query', async (...args) => {
    try { return await pool.query(...args); }
    catch (error) { throw realDatabase.safeDatabaseError(error); }
  });
  await pool.query('INSERT INTO usuarios (nome,email,senha,perfil,status) VALUES ($1,$2,$3,$4,$5)',
    ['Teste', 'teste@example.invalid', 'HASH-PRIVADO', 'Sup Admin', 'ativo']);
  const tokenStore = require('./tokenStore');
  tokenStore.clearToken();
  const app = require('./server');
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => { server.closeAllConnections(); server.close(); tokenStore.clearToken(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const nativeFetch = global.fetch;
  t.mock.method(global, 'fetch', (url, options) => {
    assert.ok(String(url).startsWith(base), 'DEV tentou acessar servidor externo');
    return nativeFetch(url, options);
  });
  assert.equal((await fetch(`${base}/api/clientes`)).status, 401);
  const token = require('./localAuth').signToken(1);
  tokenStore.setToken(token);
  assert.equal((await fetch(`${base}/api/clientes`, { headers: { authorization: 'Bearer forjado' } })).status, 401);
  for (const table of ['ultimo_pin', 'password_reset_tokens', 'segredos', 'usuarios_login_cache']) {
    assert.equal((await fetch(`${base}/api/${table}`)).status, 403);
  }
  assert.equal((await fetch(`${base}/api/clientes`, { headers: { origin: 'https://externo.invalid' } })).status, 403);
  const user = await (await fetch(`${base}/api/usuarios/me`)).json();
  assert.equal(user.id, 1);
  assert.ok(!JSON.stringify(user).includes('HASH-PRIVADO'));
  const response = await fetch(`${base}/api/clientes?select=coluna_secreta`);
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(await response.json()).includes('coluna_secreta'));
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

test('instalador exclui .env e dados privados; bridge não exporta configuração DB', () => {
  const config = require('../electron-builder.config');
  for (const pattern of ['!**/.env', '!**/.env.*', '!**/data/**']) assert.ok(config.files.includes(pattern));
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const handler = main.match(/ipcMain.handle\('get-runtime-config',[\s\S]*?\n\}\);/)[0];
  assert.match(handler, /return \{ apiBaseUrl:/);
  assert.doesNotMatch(handler, /process.env|DB_|dataConfig/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), /DB_HOST|DB_PASSWORD|localDatabase|localDataClient/);
});

test('renderer não pode buscar .env pelo protocolo file, mas assets continuam acessíveis', () => {
  const { pathToFileURL } = require('url');
  const { isPrivateFile, protectSession } = require('./privateFileGuard');
  const url = file => pathToFileURL(path.resolve(__dirname, '..', file)).toString();
  for (const file of ['.env', '.env.local', '.ENV.PRODUCTION', 'data/authToken.json', '.env:stream']) {
    assert.equal(isPrivateFile(url(file)), true);
  }
  assert.equal(isPrivateFile(url('src/html/menu.html')), false);
  assert.equal(isPrivateFile(url('src/assets/Logo.ico')), false);
  let listener;
  let installs = 0;
  const session = { webRequest: { onBeforeRequest: (_filter, callback) => { installs++; listener = callback; } } };
  protectSession(session);
  protectSession(session);
  assert.equal(installs, 1);
  listener({ url: url('.env') }, result => assert.equal(result.cancel, true));
});
