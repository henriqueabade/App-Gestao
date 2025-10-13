const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('fetchNotificationsWithRetry usa rota principal quando necessário', async (t) => {
  const originalGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    fetch: global.fetch,
    localStorage: global.localStorage,
    sessionStorage: global.sessionStorage,
    structuredClone: global.structuredClone,
    CustomEvent: global.CustomEvent,
  };

  t.after(() => {
    Object.entries(originalGlobals).forEach(([key, value]) => {
      if (value === undefined) {
        delete global[key];
      } else {
        global[key] = value;
      }
    });
  });

  const storageFactory = () => {
    const store = new Map();
    return {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      clear() {
        store.clear();
      },
    };
  };

  global.localStorage = storageFactory();
  global.sessionStorage = storageFactory();
  global.sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'Admin' }));

  if (typeof global.structuredClone !== 'function') {
    global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
  }

  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };

  const handlers = {};
  const noop = () => {};

  const btnStub = {
    classList: {
      add: noop,
      remove: noop,
    },
    setAttribute: noop,
    addEventListener: noop,
    style: {},
  };

  const badgeStub = {
    classList: {
      add: noop,
      remove: noop,
    },
    style: {},
  };

  global.document = {
    getElementById(id) {
      if (id === 'notificationBtn') return btnStub;
      if (id === 'notificationBadge') return badgeStub;
      return null;
    },
  };

  global.navigator = { onLine: true };

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);
    if (url.endsWith('/api/notifications/menu')) {
      return { ok: false, status: 404 };
    }
    if (url.endsWith('/api/notifications')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            notifications: [
              {
                id: 'abc',
                message: 'Nova tarefa',
                date: Date.now(),
                category: 'tasks',
              },
            ],
          };
        },
      };
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const windowStub = {
    handlers,
    addEventListener(event, handler) {
      handlers[event] = handler;
    },
    dispatchEvent: noop,
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout,
    clearTimeout,
    apiConfig: {
      async getApiBaseUrl() {
        return 'http://localhost:1234';
      },
    },
  };

  global.window = windowStub;

  const notificationsPath = path.join(__dirname, '..', 'src', 'js', 'notifications.js');
  delete require.cache[require.resolve(notificationsPath)];
  require(notificationsPath);

  const domHandler = handlers.DOMContentLoaded;
  assert.equal(typeof domHandler, 'function', 'handler de DOMContentLoaded não registrado');
  domHandler();

  await new Promise((resolve) => setImmediate(resolve));
  fetchCalls.length = 0;

  const fetchFn = window.__notificationsInternals?.fetchNotificationsWithRetry;
  assert.equal(typeof fetchFn, 'function', 'Função de busca de notificações não exposta');

  const result = await fetchFn(0);

  const fetchedPaths = fetchCalls.map((url) => new URL(url).pathname);
  assert.deepEqual(fetchedPaths, ['/api/notifications/menu', '/api/notifications']);
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 1);
  assert.equal(result[0].message, 'Nova tarefa');
});
