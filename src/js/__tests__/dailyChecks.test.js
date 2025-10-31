const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function createStorage() {
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
}

function createElementStub() {
  const noop = () => {};
  const stub = {
    classList: {
      add: noop,
      remove: noop,
      toggle: noop,
      contains: () => false,
    },
    style: {},
    dataset: {},
  };
  return new Proxy(stub, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'appendChild' || prop === 'removeChild' || prop === 'addEventListener' || prop === 'removeEventListener' || prop === 'setAttribute' || prop === 'removeAttribute' || prop === 'focus' || prop === 'blur') {
        return noop;
      }
      if (prop === 'getBoundingClientRect') {
        return () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
      }
      if (prop === 'querySelector') {
        return () => createElementStub();
      }
      if (prop === 'querySelectorAll') {
        return () => [];
      }
      if (prop === 'innerHTML' || prop === 'innerText' || prop === 'textContent') {
        return target[prop] || '';
      }
      return noop;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function setupEnvironment() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;
  const originalRIC = global.requestIdleCallback;
  const originalCIC = global.cancelIdleCallback;
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalLocalStorage = global.localStorage;
  const originalSessionStorage = global.sessionStorage;
  const originalCustomEvent = global.CustomEvent;

  const timers = [];
  global.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  global.clearTimeout = (id) => {
    if (id >= 1 && id <= timers.length) {
      timers[id - 1] = null;
    }
  };

  const rafCallbacks = [];
  global.requestAnimationFrame = (fn) => {
    rafCallbacks.push(fn);
    return rafCallbacks.length;
  };
  global.cancelAnimationFrame = (id) => {
    if (id >= 1 && id <= rafCallbacks.length) {
      rafCallbacks[id - 1] = null;
    }
  };

  const idleCallbacks = [];
  global.requestIdleCallback = (fn) => {
    idleCallbacks.push(fn);
    return idleCallbacks.length;
  };
  global.cancelIdleCallback = (id) => {
    if (id >= 1 && id <= idleCallbacks.length) {
      idleCallbacks[id - 1] = null;
    }
  };

  const runTimers = async () => {
    while (timers.length) {
      const fn = timers.shift();
      if (typeof fn === 'function') {
        await fn();
      }
    }
    while (rafCallbacks.length) {
      const fn = rafCallbacks.shift();
      if (typeof fn === 'function') {
        fn();
      }
    }
    while (idleCallbacks.length) {
      const fn = idleCallbacks.shift();
      if (typeof fn === 'function') {
        fn();
      }
    }
  };

  const windowHandlers = {};
  const documentHandlers = {};

  const addWindowHandler = (event, handler) => {
    if (!windowHandlers[event]) windowHandlers[event] = [];
    windowHandlers[event].push(handler);
  };

  const addDocumentHandler = (event, handler) => {
    if (!documentHandlers[event]) documentHandlers[event] = [];
    documentHandlers[event].push(handler);
  };

  const localStorage = createStorage();
  const sessionStorage = createStorage();
  sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'Admin', id: 'tester' }));

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      async json() {
        return { notifications: [] };
      },
    };
  };

  if (typeof global.structuredClone !== 'function') {
    global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
  }

  global.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };

  const updateCalls = [];
  const electronLogouts = { open: 0, show: 0, logout: 0 };

  const windowStub = {
    handlers: windowHandlers,
    addEventListener: addWindowHandler,
    removeEventListener: () => {},
    dispatchEvent: () => {},
    apiConfig: {
      async getApiBaseUrl() {
        return 'http://localhost:3000';
      },
    },
    showToast: () => {},
    stopServerCheck: () => {
      windowStub.stopServerCheck.called = true;
    },
    electronAPI: {
      async getUpdateStatus({ refresh } = {}) {
        updateCalls.push(refresh === true);
        return { status: 'up-to-date' };
      },
      onUpdateStatus: () => {},
      onPublishStatus: () => {},
      onPublishError: () => {},
      async openLoginHidden() {
        electronLogouts.open += 1;
      },
      async showLogin() {
        electronLogouts.show += 1;
      },
      async logout() {
        electronLogouts.logout += 1;
      },
      async saveState() {
        return true;
      },
    },
    collectState: () => ({ from: 'test' }),
    showToast(message) {
      windowStub.showToast.lastMessage = message;
    },
    __notificationsInternals: undefined,
  };
  windowStub.stopServerCheck.called = false;
  windowStub.showToast.lastMessage = null;

  const documentStub = {
    documentElement: createElementStub(),
    body: createElementStub(),
    addEventListener: addDocumentHandler,
    removeEventListener: () => {},
    createElement: () => createElementStub(),
    createDocumentFragment: () => createElementStub(),
    getElementById: () => createElementStub(),
    querySelector: () => createElementStub(),
    querySelectorAll: () => [],
  };

  global.window = windowStub;
  global.document = documentStub;
  global.localStorage = localStorage;
  global.sessionStorage = sessionStorage;

  return {
    runTimers,
    windowHandlers,
    documentHandlers,
    fetchCalls,
    updateCalls,
    electronLogouts,
    restore: () => {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
      global.requestAnimationFrame = originalRAF;
      global.cancelAnimationFrame = originalCAF;
      global.requestIdleCallback = originalRIC;
      global.cancelIdleCallback = originalCIC;
      global.fetch = originalFetch;
      if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
      if (originalDocument === undefined) delete global.document; else global.document = originalDocument;
      if (originalLocalStorage === undefined) delete global.localStorage; else global.localStorage = originalLocalStorage;
      if (originalSessionStorage === undefined) delete global.sessionStorage; else global.sessionStorage = originalSessionStorage;
      if (originalCustomEvent === undefined) delete global.CustomEvent; else global.CustomEvent = originalCustomEvent;
    },
  };
}

function triggerHandlers(list, event) {
  const handlers = list[event] || [];
  handlers.forEach((handler) => {
    if (typeof handler === 'function') {
      handler();
    }
  });
}

async function loadModules(env) {
  const dateKeyPath = path.join(__dirname, '..', 'utils', 'date-key.js');
  delete require.cache[require.resolve(dateKeyPath)];
  require(dateKeyPath);

  const dailyRunPath = path.join(__dirname, '..', 'utils', 'daily-run.js');
  delete require.cache[require.resolve(dailyRunPath)];
  require(dailyRunPath);

  const notificationsPath = path.join(__dirname, '..', 'notifications.js');
  delete require.cache[require.resolve(notificationsPath)];
  require(notificationsPath);
  triggerHandlers(env.windowHandlers, 'DOMContentLoaded');
  await env.runTimers();

  const menuPath = path.join(__dirname, '..', 'menu.js');
  delete require.cache[require.resolve(menuPath)];
  require(menuPath);
  await env.runTimers();
  await new Promise((resolve) => setImmediate(resolve));

  const sessionPath = path.join(__dirname, '..', 'auth', 'session.js');
  delete require.cache[require.resolve(sessionPath)];
  require(sessionPath);
  await env.runTimers();
}

test('primeira abertura do dia realiza apenas um fetch e um refresh de atualizações', async () => {
  const env = setupEnvironment();
  try {
    await loadModules(env);

    const updates = window.AppUpdates;
    assert.ok(updates, 'AppUpdates disponível');
    updates.setUserProfile({ id: 'tester' });
    await env.runTimers();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(env.fetchCalls.length, 1, 'apenas um fetch de notificações');
    const refreshCalls = env.updateCalls.filter(Boolean);
    assert.equal(refreshCalls.length, 1, 'apenas um refresh de atualizações');

    window.__notificationsInternals.refreshNotifications({ respectDaily: true });
    window.__updatesInternals.scheduleAutoCheck({ respectDaily: true });
    await env.runTimers();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(env.fetchCalls.length, 1, 'nenhum fetch extra após segunda abertura');
    const refreshCallsAfter = env.updateCalls.filter(Boolean);
    assert.equal(refreshCallsAfter.length, 1, 'nenhum refresh extra após segunda abertura');
  } finally {
    env.restore();
  }
});

test('logout automático após 30 minutos exibe aviso e volta ao login', async () => {
  const env = setupEnvironment();
  try {
    await loadModules(env);
    window.AppUpdates.setUserProfile({ id: 'tester' });
    await env.runTimers();

    env.fetchCalls.length = 0;
    env.updateCalls.length = 0;
    window.__sessionInternals.forceTimeout();
    await env.runTimers();
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(window.stopServerCheck.called, 'verificação de rede interrompida');
    assert.equal(env.electronLogouts.open, 1);
    assert.equal(env.electronLogouts.show, 1);
    assert.equal(env.electronLogouts.logout, 1);
    assert.equal(window.showToast.lastMessage, 'Você foi desconectado por inatividade.');
    assert.equal(env.fetchCalls.length, 0, 'nenhum fetch após logout');
    const refreshCalls = env.updateCalls.filter(Boolean);
    assert.equal(refreshCalls.length, 0, 'nenhum refresh após logout');
  } finally {
    env.restore();
  }
});

test('alteração de dia reinicia verificações diárias', async () => {
  const env = setupEnvironment();
  try {
    await loadModules(env);
    window.AppUpdates.setUserProfile({ id: 'tester' });
    await env.runTimers();
    await new Promise((resolve) => setImmediate(resolve));

    env.fetchCalls.length = 0;
    env.updateCalls.length = 0;

    const todayKey = window.dateUtils.getTodayKey();
    const notificationsKey = window.dailyRun.getScopedKey('menu.notifications.lastCheckAt', { id: 'tester' });
    const updatesKey = window.dailyRun.getScopedKey('menu.updates.lastCheckAt', { id: 'tester' });
    window.dailyRun.writeFlag('menu.notifications.lastCheckAt', { id: 'tester' }, '1999-12-31');
    window.dailyRun.writeFlag('menu.updates.lastCheckAt', { id: 'tester' }, '1999-12-31');

    window.__notificationsInternals.refreshNotifications({ respectDaily: true });
    window.__updatesInternals.scheduleAutoCheck({ respectDaily: true });
    await env.runTimers();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(env.fetchCalls.length, 1, 'novo fetch após mudança de dia');
    const refreshCalls = env.updateCalls.filter(Boolean);
    assert.equal(refreshCalls.length, 1, 'novo refresh após mudança de dia');

    assert.equal(global.localStorage.getItem(notificationsKey), todayKey);
    assert.equal(global.localStorage.getItem(updatesKey), todayKey);
  } finally {
    env.restore();
  }
});
