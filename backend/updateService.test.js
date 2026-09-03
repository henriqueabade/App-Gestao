const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const Module = require('module');

function createUpdateServiceWithMocks({ initialResult }) {
  const originalLoad = Module._load;
  const mockAutoUpdater = new EventEmitter();
  let nextResult = initialResult;

  Object.assign(mockAutoUpdater, {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: async () => nextResult,
    downloadUpdate: async () => {},
    quitAndInstall: () => {}
  });

  const mockApp = {
    isReady: () => true,
    whenReady: () => Promise.resolve(),
    isPackaged: true
  };

  const mockBrowserWindow = {
    getAllWindows: () => []
  };

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: mockApp, BrowserWindow: mockBrowserWindow };
    }
    if (request === 'electron-updater') {
      return { autoUpdater: mockAutoUpdater };
    }
    return originalLoad(request, parent, isMain);
  };

  const updateService = require('./updateService');

  function restore() {
    Module._load = originalLoad;
    delete require.cache[require.resolve('./updateService')];
  }

  return {
    updateService,
    mockAutoUpdater,
    setNextResult: value => {
      nextResult = value;
    },
    restore
  };
}

test('updateService clears latestVersion when transitioning to up-to-date', async () => {
  const context = createUpdateServiceWithMocks({
    initialResult: { updateInfo: { version: '2.0.0' } }
  });
  const { updateService, setNextResult, restore } = context;
  const statuses = [];
  const unsubscribe = updateService.onStatusChange(payload => {
    statuses.push(payload.status);
  });

  try {
    await updateService.checkForUpdates();
    const availableStatus = updateService.getUpdateStatus();
    assert.strictEqual(availableStatus.status, 'update-available');
    assert.strictEqual(availableStatus.latestVersion, '2.0.0');

    setNextResult({ updateInfo: null });
    await updateService.checkForUpdates();
    const finalStatus = updateService.getUpdateStatus();
    assert.strictEqual(finalStatus.status, 'up-to-date');
    assert.strictEqual(finalStatus.latestVersion, null);
    assert.strictEqual(finalStatus.downloadProgress, null);

    assert.ok(statuses.includes('update-available'));
    assert.ok(statuses.includes('up-to-date'));
  } finally {
    unsubscribe();
    restore();
  }
});

// ---------------------------------------------------------------------------
// A MENSAGEM PRECISA APONTAR A CAUSA CERTA
//
// O app instalado pede o feed ao GitHub sem credencial. Se a release está num
// repositório privado, a resposta é 404 — e o cliente via "servidor de
// atualização indisponível", como se o servidor estivesse fora. Publicar
// funcionava (quem publica tem token) e baixar não; a mensagem mandava procurar
// o defeito no lugar errado.
// ---------------------------------------------------------------------------

test('404 e 403 não são tratados como servidor fora do ar', () => {
  const amb = createUpdateServiceWithMocks({ initialResult: null });
  const servico = amb.updateService;
  // `decorateError` é interno; o efeito aparece no status depois de um erro.
  const casos = [
    'HttpError: 404 Not Found',
    'HttpError: 403 Forbidden'
  ];

  for (const mensagem of casos) {
    const decorado = servico.__testes__.decorateError(new Error(mensagem));
    assert.strictEqual(decorado.code, 'feed-inacessivel', mensagem);
    assert.match(decorado.friendlyMessage, /repositório privado/);
  }
  amb.restore();
});

test('sem internet continua sendo sem internet', () => {
  const amb = createUpdateServiceWithMocks({ initialResult: null });
  const servico = amb.updateService;
  const decorado = servico.__testes__.decorateError(new Error('ERR_INTERNET_DISCONNECTED'));
  assert.strictEqual(decorado.code, 'offline');
  amb.restore();
});

test('feed não configurado continua com a mensagem própria', () => {
  const amb = createUpdateServiceWithMocks({ initialResult: null });
  const servico = amb.updateService;
  const decorado = servico.__testes__.decorateError(new Error('no available update'));
  assert.strictEqual(decorado.code, 'no-feed');
  amb.restore();
});
