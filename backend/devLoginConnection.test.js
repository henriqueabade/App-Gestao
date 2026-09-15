const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { newDb } = require('pg-mem');
process.env.BANCO = 'DEV';
const { createLocalDataClient } = require('./localDataClient');
const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');

function functionSource(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return main.slice(main.slice(start - 6, start) === 'async ' ? start - 6 : start, main.indexOf('\n}', start) + 2);
}
function fixture() {
  const memory = newDb();
  // Os nomes presentes no PostgreSQL local, sem os aliases *_em/ultima_acao.
  memory.public.none(`CREATE TABLE usuarios (
    id integer PRIMARY KEY, nome text, status text, email text, senha text, perfil text,
    ultima_entrada timestamp, ultima_saida timestamp, ultima_alteracao timestamp,
    local_ultima_alteracao text, especificacao_ultima_alteracao text
  ); INSERT INTO usuarios(id,nome,status) VALUES(1,'Teste','ativo')`);
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  return { pool, api: createLocalDataClient(pool) };
}

test('checagem pós-login e warmup usam SELECT 1 em DEV, sem procurar tabela status', async () => {
  const { api } = fixture();
  const context = vm.createContext({
    getAuthorizedApiClient: () => api, currentUserSession: { id: 1 },
    mapApiErrorToReason: () => null, ensureDatabaseReady: () => true,
    AUTO_LOGIN_DB_WAIT_TIMEOUT_MS: 100, AUTO_LOGIN_DB_RETRY_MIN_DELAY_MS: 1,
    AUTO_LOGIN_DB_RETRY_MAX_DELAY_MS: 10
  });
  vm.runInContext(functionSource('checkDatabaseAndCurrentUser') + '\n' + functionSource('waitForAutoLoginDatabaseReady'), context);
  for (let i = 0; i < 3; i++) {
    assert.equal((await context.checkDatabaseAndCurrentUser()).success, true);
    assert.equal((await context.waitForAutoLoginDatabaseReady({ id: 1 })).ready, true);
  }
  await api.put('/usuarios/1', { status: 'aguardando_aprovacao' });
  assert.equal((await context.checkDatabaseAndCurrentUser()).reason, 'admin-disabled');
  const failing = createLocalDataClient({ query: async () => { throw new Error('banco indisponível'); } });
  await assert.rejects(failing.get('/status'), /banco indisponível/);
});

test('fluxo real do handler de login mantém sessão e conexão após registrar entrada e atividade', async t => {
  const { pool } = fixture();
  const database = require('./localDatabase');
  t.mock.method(database, 'query', pool.query.bind(pool));
  t.mock.method(global, 'fetch', async () => assert.fail('DEV tentou acessar API externa'));
  const hash = await require('bcrypt').hash('senha-de-teste', 4);
  await pool.query('UPDATE usuarios SET email=$1, senha=$2, perfil=$3 WHERE id=1', ['teste@example.invalid', hash, 'Sup Admin']);
  const backend = require('./backend');
  const activity = require('./userActivity');
  const tokenStore = require('./tokenStore');
  t.after(() => tokenStore.clearToken());
  const handlers = {};
  const context = vm.createContext({
    Date, useLocalDatabase: true, currentUserSession: null,
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    require: name => require(name.replace('./backend/', './')),
    ...backend, ...activity,
    getToken: tokenStore.getToken,
    getAuthorizedApiClient: () => require('./apiHttpClient').createApiClient(),
    setCurrentUserSession: user => { context.currentUserSession = user; },
    lerTentativas: () => 0, LOGIN_MAX_TENTATIVAS: 3, limparTentativasLogin() {},
    mapApiErrorToReason: () => null,
    console: { error: (...args) => assert.fail(String(args)) }
  });
  vm.runInContext(functionSource('requestAuthenticatedProfile') + '\n' + functionSource('checkDatabaseAndCurrentUser'), context);
  const start = main.indexOf("ipcMain.handle('login-usuario'");
  vm.runInContext(main.slice(start, main.indexOf('\n});', start) + 4), context);
  const result = await handlers['login-usuario'](null, { email: 'teste@example.invalid', password: 'senha-de-teste' });
  assert.equal(result.success, true);
  assert.equal(result.user.id, 1);
  assert.equal(context.currentUserSession.id, 1);
  assert.ok(!JSON.stringify(result).includes(hash));
  assert.ok((await pool.query('SELECT ultima_entrada FROM usuarios WHERE id=1')).rows[0].ultima_entrada);
  for (let i = 0; i < 3; i++) assert.equal((await context.checkDatabaseAndCurrentUser()).success, true);
  await activity.registrarUltimaAlteracao(1, { modulo: 'Produtos', descricao: 'Teste' });
  assert.equal((await context.checkDatabaseAndCurrentUser()).success, true);
  assert.equal(require('./localAuth').verifyToken(tokenStore.getToken()).id, 1);
});

test('entrada, alteração e saída gravam os campos existentes sem exigir aliases', async () => {
  const { api } = fixture();
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'userActivity.js'), 'utf8'), {
    module, Date, require: name => { assert.equal(name, './db'); return api; },
    console: { error: (...args) => assert.fail(String(args)) }
  });
  const activity = module.exports;
  await activity.registrarUltimaEntrada(1, '2026-09-15T10:00:00Z');
  assert.equal(await activity.registrarUltimaAlteracao(1, {
    timestamp: '2026-09-15T10:05:00Z', modulo: 'Produtos', descricao: 'Atualizou produto'
  }), true);
  await activity.registrarUltimaSaida(1, { saida: '2026-09-15T10:10:00Z' });
  const row = await api.get('/usuarios/1');
  assert.equal(row.ultima_entrada, '2026-09-15T10:00:00.000Z');
  assert.equal(row.ultima_saida, '2026-09-15T10:10:00.000Z');
  assert.equal(row.ultima_alteracao, '2026-09-15T10:05:00.000Z');
  assert.equal(row.local_ultima_alteracao, 'Produtos');
  assert.equal(row.especificacao_ultima_alteracao, 'Atualizou produto');
  // Compatibilidade de atividade não deve esconder erro em gravação de negócio.
  await assert.rejects(api.put('/usuarios/1', { campo_inexistente: 'erro' }));
});

test('monitor DEV ignora configurações remotas e usa HTTP/IPv4 na porta atual', () => {
  const context = vm.createContext({ useLocalDatabase: true, currentApiPort: 4567,
    configuredApiPort: 3000, DEFAULT_API_PORT: 3000,
    process: { env: { API_PROTOCOL: 'https', API_HOST: 'api.example.invalid', CONNECTION_MONITOR_BASE_URL: 'https://example.invalid' } }
  });
  vm.runInContext(functionSource('resolveBackendHealthBaseUrl'), context);
  assert.equal(context.resolveBackendHealthBaseUrl(), 'http://127.0.0.1:4567');
});

test('consulta de perfil antes do login retorna null sem gerar erro IPC', () => {
  const start = main.indexOf("ipcMain.handle('perfil:obter'");
  let handler;
  let token = null;
  let called = 0;
  vm.runInNewContext(main.slice(start, main.indexOf('\n});', start) + 4), {
    ipcMain: { handle: (_name, fn) => { handler = fn; } },
    getToken: () => token, requestAuthenticatedProfile: () => { called++; return { id: 1 }; }
  });
  assert.equal(handler(), null);
  assert.equal(called, 0);
  token = 'sessao-ficticia';
  assert.equal(handler().id, 1);
});

test('auto-login DEV exige sessão assinada em memória e identidade correspondente', async () => {
  const start = main.indexOf("ipcMain.handle('auto-login'");
  let handler;
  let id = null;
  let warmed = 0;
  vm.runInNewContext(main.slice(start, main.indexOf('\n});', start) + 4), {
    ipcMain: { handle: (_name, fn) => { handler = fn; } }, useLocalDatabase: true,
    getToken: () => 'fake', require: () => ({ verifyToken: () => { if (!id) throw new Error('Sem sessão'); return { id }; } }),
    waitForAutoLoginDatabaseReady: () => { warmed++; return { ready: false, error: new Error('parar após warmup') }; },
    console: { error() {} }, isNetworkError: () => false, isPinError: () => false
  });
  assert.equal((await handler(null, { user: { id: 1 } })).code, 'auth-failed');
  id = 2;
  assert.equal((await handler(null, { user: { id: 1 } })).code, 'auth-failed');
  assert.equal(warmed, 0);
  id = 1;
  await handler(null, { user: { id: 1 } });
  assert.equal(warmed, 1);
});

test('erro SQL não derruba disponibilidade; queda real de conexão continua sendo detectada', async () => {
  const module = { exports: {} };
  let failure = null;
  class Pool {
    on() {}
    async query() { if (failure) throw failure; return { rows: [{ ok: 1 }] }; }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'localDatabase.js'), 'utf8'), {
    module, process: { env: {} },
    require: name => name === './dataConfig' ? { isDev: true, readDatabaseConfig: () => ({}) } : { Pool }
  });
  const db = module.exports;
  await db.query('SELECT 1');
  for (const code of ['42703', '42P01', '23505', '22P02']) {
    failure = { code, message: 'CREDENCIAL-PRIVADA', detail: 'SQL-PRIVADO' };
    await assert.rejects(db.query('query'), error => error.status !== 503 && error.reason === 'db-query' && !error.stack.includes('PRIVAD'));
    assert.equal(db.isReady(), true);
    assert.equal(db.getStatus().lastError, null);
  }
  for (const code of ['ECONNREFUSED', 'EPIPE', 'EPERM', '08006', '28P01', '57P01']) {
    failure = { code };
    await assert.rejects(db.query('SELECT 1'), { status: 503, reason: 'db' });
    assert.equal(db.isReady(), false);
  }
  failure = null;
  assert.equal((await db.healthCheck()).ok, true);
  assert.equal(db.isReady(), true);
});
