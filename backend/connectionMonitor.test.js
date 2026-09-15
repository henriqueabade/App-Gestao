const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const https = require('node:https');

const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, source.indexOf('\n}', start) + 2);
}

function createHarness(mode, port) {
  const logouts = [];
  const logs = [];
  let lookups = 0;
  // Reproduz a resolução observada no Electron do usuário. O Node mais novo
  // tenta outras famílias automaticamente e escondia o defeito nos testes.
  class ElectronIPv6Agent extends http.Agent {
    constructor(options) {
      super({ ...options, autoSelectFamily: false, lookup: (_hostname, _options, callback) => {
        lookups++;
        callback(null, '::1', 6);
      } });
    }
  }
  const context = vm.createContext({
    URL, Buffer, Date, Error, setTimeout, clearTimeout, console,
    http: { ...http, Agent: ElectronIPv6Agent }, https,
    useLocalDatabase: mode === 'DEV', currentApiPort: port,
    configuredApiPort: 3000, DEFAULT_API_PORT: 3000,
    process: { env: { API_PROTOCOL: 'https', API_HOST: 'api.example.invalid', CONNECTION_MONITOR_BASE_URL: 'https://monitor.example.invalid' } },
    DEBUG: false, backendAgentInstance: null, backendAgentKey: null,
    netState: 'offline', lastMonitorHeartbeatAt: 0,
    lastConnectionStatusPayload: null, currentUserSession: { id: 1 },
    CONNECTION_DEEP_STARTUP_DELAY_MS: 0, CONNECTION_DEEP_INTERVAL_MS: 1,
    CONNECTION_MONITOR_AGENT_KEEP_ALIVE_MS: 65000,
    CONNECTION_MONITOR_HEARTBEAT_INTERVAL_MS: 600000,
    CONNECTION_MONITOR_TIMEOUT_MS: 1500, CONNECTION_HEALTH_TIMEOUT_MS: 1500,
    CONNECTION_DB_TIMEOUT_MS: 1500, CONNECTION_DB_FAILURE_THRESHOLD: 3,
    CONNECTION_MONITOR_INTERVAL_MS: 10000, SESSION_FORCE_LOGOUT_DEBOUNCE_MS: 5000,
    shouldMonitorBeActive: () => true,
    appendConnectionMonitorLog: item => logs.push(item),
    broadcastConnectionStatusPayload() {}, broadcastNetworkStatus() {},
    broadcastSessionForceLogout: item => logouts.push(item),
    isNetworkError: error => error?.code === 'ECONNREFUSED',
    mapApiErrorToReason: () => null,
    getAuthorizedApiClient: () => ({ get: async () => ({ id: 1, status: 'ativo' }) }),
    ipcMain: { handle: (_name, fn) => { context.runtimeConfig = fn; } }
  });
  const names = ['getLocalApiBaseUrl', 'resolveBackendHealthBaseUrl', 'destroyHttpAgent',
    'ensureBackendAgent', 'requestWithAgent', 'formatMonitorError', 'applyNetState',
    'checkDatabaseAndCurrentUser', 'createConnectionMonitor'];
  vm.runInContext(names.map(extract).join('\n'), context);
  const start = source.indexOf("ipcMain.handle('get-runtime-config'");
  vm.runInContext(source.slice(start, source.indexOf('\n});', start) + 4), context);
  return { context, logouts, logs, lookups: () => lookups };
}

for (const mode of ['DEV', 'PROD']) {
  test(`monitor completo em ${mode}: servidor IPv4 permanece online após login e múltiplas checagens`, async t => {
    const paths = [];
    const server = http.createServer((req, res) => {
      paths.push(req.url);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', db_ok: true, db_ready: true }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const harness = createHarness(mode, port);
    const { context } = harness;
    t.after(() => { context.ensureBackendAgent(null); server.closeAllConnections(); server.close(); });

    // Antes, exatamente esse destino causava ECONNREFUSED ::1:porta.
    const legacyAgent = new context.http.Agent({ keepAlive: false });
    try {
      await assert.rejects(context.requestWithAgent(new URL(`http://localhost:${port}/healthz`), { agent: legacyAgent }), { code: 'ECONNREFUSED' });
    } finally { legacyAgent.destroy(); }
    const priorLookups = harness.lookups();

    const expected = `http://127.0.0.1:${port}`;
    assert.equal(context.runtimeConfig().apiBaseUrl, expected);
    assert.equal(context.resolveBackendHealthBaseUrl(), expected);
    const monitor = context.createConnectionMonitor();
    for (const triggeredBy of ['server-start', 'window-show', 'renderer-request', 'timer', 'manual']) {
      const result = await monitor.requestImmediateCheck({ triggeredBy, allowWhilePaused: true, forceDeep: true });
      assert.equal(result.state, 'online', JSON.stringify(result));
      assert.equal(result.shouldLogout, false);
    }
    assert.equal(harness.logouts.length, 0);
    assert.equal(harness.lookups(), priorLookups, 'o caminho corrigido não depende da resolução de localhost');
    assert.equal(paths.filter(p => p === '/healthz').length, 5);
    assert.equal(paths.filter(p => p === '/healthz/db').length, 5);
  });
}

test('queda real do servidor continua sendo detectada pelo monitor', async t => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const { context, logouts } = createHarness('DEV', port);
  t.after(() => context.ensureBackendAgent(null));
  const monitor = context.createConnectionMonitor();
  const result = await monitor.requestImmediateCheck({ allowWhilePaused: true });
  assert.equal(result.state, 'offline');
  assert.equal(result.lastError.code, 'ECONNREFUSED');
  assert.equal(logouts.length, 1);
});

test('CSP das telas permite o endereço IPv4 local nas portas alternativas', () => {
  for (const file of ['src/html/menu.html', 'src/html/configuracoes.html', 'src/html/usuarios.html', 'src/pdf/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/, file);
  }
});
