const test = require('node:test');
const assert = require('node:assert/strict');

function createElementMock() {
  const classes = new Set();
  return {
    classList: {
      add: (...tokens) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
      contains: (token) => classes.has(token),
    },
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    classes,
  };
}

test('fetchNotificationsWithRetry accepts { items: [] } payloads', async () => {
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
  storage.set('user', JSON.stringify({ perfil: 'Admin' }));

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

  const fetchResponses = [
    {
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: 1, message: 'Olá' }] }),
    },
  ];
  let callCount = 0;
  global.fetch = async () => {
    const response = fetchResponses[Math.min(callCount, fetchResponses.length - 1)];
    callCount += 1;
    return response;
  };

  require('../../js/notifications.js');
  assert.ok(typeof listeners.DOMContentLoaded === 'function', 'DOMContentLoaded listener registered');
  listeners.DOMContentLoaded();

  const api = window.__notificationsInternals;
  assert.ok(api, 'internals exposed');
  assert.ok(typeof api.fetchNotificationsWithRetry === 'function');

  const result = await api.fetchNotificationsWithRetry(0);
  assert.deepStrictEqual(result, [{ id: 1, message: 'Olá' }]);
});
