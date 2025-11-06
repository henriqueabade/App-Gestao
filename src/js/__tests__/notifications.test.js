const test = require('node:test');
const assert = require('node:assert/strict');

const NOTIFICATIONS_MODULE = require.resolve('../../js/notifications.js');

function createElementMock() {
  const classes = new Set();
  const attributes = new Map();
  return {
    classList: {
      add: (...tokens) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
      contains: (token) => classes.has(token),
    },
    setAttribute: (name, value) => {
      attributes.set(name, String(value));
    },
    getAttribute: (name) => {
      if (!attributes.has(name)) {
        return null;
      }
      return attributes.get(name);
    },
    removeAttribute: (name) => {
      attributes.delete(name);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    classes,
  };
}

function setupBaseEnvironment({
  perfil = 'Admin',
  permissionService = null,
} = {}) {
  const btn = createElementMock();
  const badge = createElementMock();
  const listeners = {};

  const windowMock = {
    addEventListener: (event, handler) => {
      listeners[event] = handler;
    },
    removeEventListener: () => {},
    dispatchEvent: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    apiConfig: {
      getApiBaseUrl: () => Promise.resolve('https://example.com/'),
    },
    document: {
      getElementById: (id) => {
        if (id === 'notificationBtn') return btn;
        if (id === 'notificationBadge') return badge;
        return null;
      },
    },
    permissionsService: permissionService || undefined,
  };

  const storage = new Map();
  const storageApi = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  };
  storage.set('user', JSON.stringify({ perfil }));

  global.window = windowMock;
  global.document = windowMock.document;
  global.navigator = { onLine: true };
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.sessionStorage = storageApi;
  global.localStorage = storageApi;

  return { btn, badge, listeners, storage, storageApi, windowMock };
}

function mockFetchQueue(responses) {
  let callCount = 0;
  global.fetch = async () => {
    const index = Math.min(callCount, responses.length - 1);
    callCount += 1;
    return responses[index];
  };
  return () => callCount;
}

function loadNotificationsModule() {
  delete require.cache[NOTIFICATIONS_MODULE];
  require('../../js/notifications.js');
}

test('fetchNotificationsWithRetry accepts { items: [] } payloads', async () => {
  const permissionService = {
    loadBootstrap: async () => {},
    isFeatureEnabled: (module, feature) => module === 'notifications' && feature === 'notifications',
    getMenu: () => [],
    getFeaturesForModule: () => [],
    findFeature: () => null,
  };

  const { btn, badge, listeners } = setupBaseEnvironment({
    perfil: 'Admin',
    permissionService,
  });

  const fetchResponses = [
    {
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: 1, message: 'Olá' }] }),
    },
  ];

  const fetchCallCount = mockFetchQueue(fetchResponses);

  loadNotificationsModule();
  assert.ok(typeof listeners.DOMContentLoaded === 'function', 'DOMContentLoaded listener registrado');
  await listeners.DOMContentLoaded();

  assert.strictEqual(fetchCallCount(), 1, 'fetch chamado uma vez');
  assert.ok(!btn.classList.contains('opacity-50'), 'botão permanece habilitado');
  assert.strictEqual(btn.getAttribute('aria-disabled'), null, 'aria-disabled não definido');

  const api = window.__notificationsInternals;
  assert.ok(api, 'internals expostos');
  assert.ok(typeof api.fetchNotificationsWithRetry === 'function');

  const result = await api.fetchNotificationsWithRetry(0);
  assert.deepStrictEqual(result, [{ id: 1, message: 'Olá' }]);
});

test('notificações ficam desabilitadas quando permissão é negada', async () => {
  const permissionService = {
    loadBootstrap: async () => {},
    isFeatureEnabled: () => false,
    getMenu: () => [],
    getFeaturesForModule: () => [],
    findFeature: () => null,
  };

  const { btn, badge, listeners } = setupBaseEnvironment({
    perfil: 'Operacional',
    permissionService,
  });

  mockFetchQueue([
    {
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    },
  ]);

  loadNotificationsModule();
  assert.ok(typeof listeners.DOMContentLoaded === 'function');
  await listeners.DOMContentLoaded();

  assert.ok(btn.classList.contains('pointer-events-none'));
  assert.ok(btn.classList.contains('opacity-50'));
  assert.strictEqual(btn.getAttribute?.('aria-disabled') || btn.ariaDisabled, 'true');
  assert.ok(badge.classList.contains('hidden'));
});
