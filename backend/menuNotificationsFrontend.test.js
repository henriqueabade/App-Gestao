const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// O sino passou a ler os avisos por usuário do histórico social
// (/api/notificacoes). A antiga /api/notifications nunca existiu na API.
test('fetchNotificationsWithRetry lê /api/notificacoes e devolve os itens', async (t) => {
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
    if (url.endsWith('/api/notificacoes')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            nao_lidas: 1,
            itens: [
              {
                id: 7,
                tipo: 'comentario',
                titulo: 'Ana comentou na prospecção ACME',
                mensagem: 'Liguei hoje',
                origem: 'prospeccao',
                registro_id: 3,
                lida: false,
                criado_em: new Date().toISOString(),
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
  assert.deepEqual(fetchedPaths, ['/api/notificacoes']);
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, 1);
  assert.equal(result[0].titulo, 'Ana comentou na prospecção ACME');

  // Formatos aceitos e contagem de não lidos.
  const { lerResposta, quando } = window.__notificationsInternals;
  assert.deepEqual(lerResposta({ itens: [{ id: 1, lida: false }], nao_lidas: 4, sql_pendente: true }), { lista: [{ id: 1, lida: false }], naoLidas: 4, sqlPendente: true });
  assert.equal(lerResposta([{ id: 1, lida: false }, { id: 2, lida: true }]).naoLidas, 1);
  assert.deepEqual(lerResposta(null), { lista: [], naoLidas: 0, sqlPendente: false });

  // Tempo relativo do aviso.
  const agora = new Date(2026, 8, 18, 15, 0, 0);
  assert.equal(quando(new Date(2026, 8, 18, 14, 59, 40), agora), 'agora');
  assert.equal(quando(new Date(2026, 8, 18, 14, 55, 0), agora), 'há 5 min');
  assert.equal(quando(new Date(2026, 8, 18, 12, 0, 0), agora), 'há 3 h');
  assert.match(quando(new Date(2026, 8, 17, 14, 30, 0), agora), /^ontem às 14:30$/);
  assert.match(quando(new Date(2026, 8, 12, 10, 5, 0), agora), /^12\/09 às 10:05$/);
  assert.match(quando(new Date(2025, 11, 30, 9, 0, 0), agora), /^30\/12\/2025 às 09:00$/);
  assert.equal(quando('não é data', agora), '');
});
