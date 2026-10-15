const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const BOOTSTRAP = MAIN.slice(0, MAIN.indexOf("const { isDev: useLocalDatabase }"));
const PRONTO = MAIN.slice(MAIN.indexOf('app.whenReady().then(async () => {'), MAIN.indexOf("app.on('window-all-closed'"));

function funcao(nome) {
  let inicio = MAIN.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `${nome} existe no main`);
  if (MAIN.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
  return MAIN.slice(inicio, MAIN.indexOf('\n}\n', inicio) + 3);
}

test('segunda execução perde o lock e encerra antes de importar backend, criar IPC, janela ou servidor', () => {
  const chamadas = [];
  const app = {
    getPath: () => '/dados/app',
    setPath: (nome, valor) => chamadas.push(['caminho', nome, valor]),
    requestSingleInstanceLock: () => { chamadas.push(['lock']); return false; },
    quit: () => chamadas.push(['sair'])
  };
  const requireFalso = nome => {
    chamadas.push(['require', nome]);
    if (nome === 'electron') return { app };
    if (nome === 'path') return path;
    if (nome === 'fs') return { mkdirSync() {} };
    throw new Error(`A segunda execução não deve carregar ${nome}`);
  };
  const contexto = vm.createContext({ requireFalso, console });
  vm.runInContext(`(function(require) { ${MAIN}\n})(requireFalso);`, contexto);
  assert.deepEqual(chamadas.filter(c => c[0] === 'require').map(c => c[1]), ['electron', 'path', 'fs']);
  assert.ok(chamadas.findIndex(c => c[0] === 'caminho') < chamadas.findIndex(c => c[0] === 'lock'));
  assert.deepEqual(chamadas.at(-1), ['sair']);
});

function janela({ minimizada = false } = {}) {
  const eventos = [];
  const win = new EventEmitter();
  Object.assign(win, {
    eventos,
    isDestroyed: () => false,
    isMinimized: () => minimizada,
    restore: () => { minimizada = false; eventos.push('restaurar'); },
    show: () => eventos.push('mostrar'),
    focus: () => eventos.push('focar'),
    webContents: Object.assign(new EventEmitter(), { send: canal => eventos.push(canal) })
  });
  return win;
}

function processoPrincipal() {
  let liberar;
  let fimDaInicializacao;
  const pronto = new Promise(r => { liberar = r; });
  const eventos = [];
  const app = Object.assign(new EventEmitter(), {
    getPath: () => '/dados/app', setPath() {}, requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: fn => { fimDaInicializacao = pronto.then(fn); return fimDaInicializacao; } })
  });
  const electron = { app, screen: Object.assign(new EventEmitter(), {}), session: { defaultSession: {} } };
  const contexto = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, process: { env: {} },
    setTimeout, clearTimeout,
    require: nome => {
      if (nome === 'electron') return electron;
      if (nome === 'path') return path;
      if (nome === 'fs') return { mkdirSync() {} };
      if (nome === './backend/menuDeContexto') return { configurarCorretor() {} };
      throw new Error(`Módulo inesperado no teste: ${nome}`);
    },
    preferenciasWindows: { ler: () => ({ avisosNoWindows: true }), lerCategorias: () => ({}) },
    aplicarInicioComWindows() {}, criarBandeja() {}, iniciarAvisosNoWindows() {},
    handleDisplaysChanged() {}, showStartupBanner() {}, initializeAutoUpdater() {}, refreshConnectionMonitorActivityState() {},
    findAvailablePort: async porta => { eventos.push('sondar-porta'); return porta; },
    startApiServerOnPort: async () => eventos.push('iniciar-api'),
    handleApiServerError: async err => { throw err; },
    dialog: { showErrorBox: () => { throw new Error('Diálogo de erro inesperado'); } },
    eventos
  });
  vm.runInContext(`(function() { ${BOOTSTRAP}
    const DEFAULT_API_PORT = 3000, MAX_PORT = 65535;
    let configuredApiPort, stateFile, displayFile, arquivoDePreferencias, preferencias, arquivoDasCategorias, categoriasDoSino;
    const iniciouEmSegundoPlano = true;
    let dashboardWindow = null, loginWindow = null, loginWindowReady = false, avisoPendente = null;
    function createLoginWindow() {
      if (!loginWindow) { eventos.push('criar-login'); loginWindow = this.novaJanela(); loginWindowReady = true; }
    }
    ${funcao('abrirPrograma')}
    ${funcao('revealLoginWindow')}
    this.definirDashboard = win => { dashboardWindow = win; };
    this.definirLogin = win => { loginWindow = win; loginWindowReady = true; };
    ${PRONTO}
  }).call(this);`, contexto);
  contexto.novaJanela = janela;
  return {
    app, contexto, eventos,
    iniciar: async () => { liberar(); await fimDaInicializacao; },
    dashboard: win => contexto.definirDashboard(win),
    login: win => contexto.definirLogin(win)
  };
}

test('atalho durante início em segundo plano aguarda a API e cria uma única janela de login', async () => {
  const p = processoPrincipal();
  assert.equal(p.app.listenerCount('second-instance'), 1, 'listener existe antes de whenReady');
  p.app.emit('second-instance');
  p.app.emit('second-instance');
  assert.deepEqual(p.eventos, [], 'não abre janela ou servidor antes de pronto');
  await p.iniciar();
  assert.deepEqual(p.eventos, ['sondar-porta', 'iniciar-api', 'criar-login']);
  p.app.emit('second-instance');
  p.app.emit('activate');
  assert.equal(p.eventos.filter(e => e === 'criar-login').length, 1);
  assert.equal(p.eventos.filter(e => e === 'iniciar-api').length, 1);
});

test('atalho restaura o dashboard autenticado escondido/minimizado e não abre login nem outro servidor', async () => {
  const p = processoPrincipal();
  await p.iniciar();
  const dashboard = janela({ minimizada: true });
  p.dashboard(dashboard);
  p.app.emit('second-instance');
  assert.deepEqual(dashboard.eventos, ['restaurar', 'mostrar', 'focar']);
  assert.deepEqual(p.eventos, ['sondar-porta', 'iniciar-api']);
});

test('sem sessão o atalho restaura a janela de login que já existe', async () => {
  const p = processoPrincipal();
  await p.iniciar();
  const login = janela({ minimizada: true });
  p.login(login);
  p.app.emit('second-instance');
  assert.deepEqual(login.eventos, ['restaurar', 'mostrar', 'focar', 'activate-tab']);
  assert.deepEqual(p.eventos, ['sondar-porta', 'iniciar-api']);
});

function portas(configuredApiPort) {
  const erros = [];
  const contexto = vm.createContext({
    net, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    apiServer: { listen: (...args) => http.createServer((_req, res) => res.end('teste')).listen(...args) },
    ensureConnectionMonitor: () => ({ requestImmediateCheck: async () => {} }),
    refreshConnectionMonitorActivityState() {},
    dialog: { showErrorBox: (...args) => erros.push(args) }, configuredApiPort
  });
  vm.runInContext(`
    const DEFAULT_API_PORT = 3000, MAX_PORT = 65535, CONNECTION_SERVER_KEEP_ALIVE_MS = 65000, DEBUG = false;
    let apiServerInstance = null, currentApiPort = null;
    ${['checkPortAvailability', 'findAvailablePort', 'startApiServerOnPort', 'handleApiServerError', 'closeApiServer', 'getLocalApiBaseUrl'].map(funcao).join('\n')}
  `, contexto);
  return { contexto, erros };
}

async function servidorExterno(porta = 0) {
  const servidor = net.createServer();
  await new Promise((resolve, reject) => { servidor.once('error', reject); servidor.listen(porta, '127.0.0.1', resolve); });
  return servidor;
}

test('primeira instância usa próxima porta livre quando outro programa ocupa a configurada', async () => {
  const externo = await servidorExterno();
  const portaOcupada = externo.address().port;
  const { contexto, erros } = portas(portaOcupada);
  try {
    const livre = await contexto.findAvailablePort(portaOcupada);
    assert.ok(livre > portaOcupada);
    const servidor = await contexto.startApiServerOnPort(livre);
    assert.equal(servidor.address().port, livre);
    assert.equal(contexto.getLocalApiBaseUrl(), `http://127.0.0.1:${livre}`);
    assert.equal(externo.listening, true, 'não encerra nem reaproveita o servidor de outro programa');
    assert.deepEqual(erros, []);
  } finally {
    await contexto.closeApiServer();
    await new Promise(r => externo.close(r));
  }
});

test('se a porta é ocupada entre sondagem e listen, EADDRINUSE tenta outra porta sem caixa de erro', async () => {
  const reserva = await servidorExterno();
  const candidata = reserva.address().port;
  await new Promise(r => reserva.close(r));
  const { contexto, erros } = portas(candidata);
  assert.equal(await contexto.findAvailablePort(candidata), candidata);
  const externo = await servidorExterno(candidata);
  try {
    let colisao;
    try { await contexto.startApiServerOnPort(candidata); } catch (err) { colisao = err; }
    assert.equal(colisao?.code, 'EADDRINUSE');
    await contexto.handleApiServerError(colisao);
    const efetiva = Number(contexto.getLocalApiBaseUrl().split(':').at(-1));
    assert.ok(efetiva > candidata);
    assert.deepEqual(erros, []);
  } finally {
    await contexto.closeApiServer();
    await new Promise(r => externo.close(r));
  }
});
