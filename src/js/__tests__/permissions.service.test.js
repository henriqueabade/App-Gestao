const test = require('node:test');
const assert = require('node:assert/strict');

const SERVICE_MODULE = require.resolve('../../js/services/permissions.js');

function setupStorage() {
  const storage = new Map();
  return {
    storage,
    api: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
    },
  };
}

function setupEnvironment() {
  const session = setupStorage();
  const local = setupStorage();
  session.api.setItem('currentUser', JSON.stringify({ perfil: 'Admin', role: 'admin' }));

  const listeners = new Map();

  global.window = {
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener: (event) => listeners.delete(event),
    dispatchEvent: () => {},
    apiConfig: {
      resolveUrl: (url) => url,
    },
  };
  global.document = undefined;
  global.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.sessionStorage = session.api;
  global.localStorage = local.api;

  return { listeners };
}

function createResponse({ status, body, etag }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (name) => {
        if (name.toLowerCase() === 'etag') {
          return etag ?? null;
        }
        return null;
      },
    },
  };
}

function loadServiceModule() {
  delete require.cache[SERVICE_MODULE];
  require('../../js/services/permissions.js');
  return window.permissionsService;
}

test('permissions service caches bootstrap and respeita 304', async () => {
  setupEnvironment();

  const responses = [
    createResponse({
      status: 200,
      etag: '"etag-123"',
      body: {
        menu: [
          {
            code: 'Dashboard',
            label: 'Dashboard',
            order: 2,
          },
          {
            code: 'Usuarios',
            label: 'Usuários',
            order: 1,
            children: [
              { code: 'Usuarios:Listar', label: 'Lista de Usuários', page: 'usuarios' },
            ],
          },
        ],
        features: {
          usuarios: [
            {
              code: 'editar',
              permitted: true,
              scopes: { view: true, editar: false },
              aliases: ['edit-users'],
            },
          ],
        },
        columns: {
          usuarios: {
            default: {
              columns: [
                {
                  code: 'nome',
                  mask: '***',
                  can_sort: false,
                  can_filter: true,
                  export_perm: false,
                  visibility: 'visible',
                },
              ],
            },
          },
        },
      },
    }),
    createResponse({
      status: 304,
      body: {},
    }),
  ];

  const fetchCalls = [];
  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return responses[Math.min(fetchCalls.length - 1, responses.length - 1)];
  };

  const service = loadServiceModule();
  assert.ok(service, 'serviço carregado');

  const first = await service.loadBootstrap();
  assert.ok(first, 'payload carregado');
  assert.strictEqual(fetchCalls.length, 1);

  const menu = service.getMenu();
  assert.strictEqual(menu.length, 2, 'menu contém duas entradas');
  assert.strictEqual(menu[0].code, 'usuarios', 'menu normalizado e ordenado');
  assert.strictEqual(menu[1].code, 'dashboard');

  assert.ok(service.isFeatureEnabled('usuarios', 'editar', { scope: 'view' }), 'feature habilitada para escopo view');
  assert.strictEqual(service.isFeatureEnabled('usuarios', 'editar', { scope: 'editar' }), false);

  const columns = service.getColumns('usuarios', 'default');
  assert.strictEqual(columns.length, 1);
  const [nomeColumn] = columns;
  assert.strictEqual(nomeColumn.mask, '***');
  assert.strictEqual(nomeColumn.canSort, false);
  assert.strictEqual(nomeColumn.canFilter, true);
  assert.strictEqual(nomeColumn.exportPerm, false);

  await service.loadBootstrap();
  assert.strictEqual(fetchCalls.length, 1, 'cache reutilizado sem nova requisição');

  const refreshed = await service.loadBootstrap({ forceRefresh: true });
  assert.ok(refreshed, 'cache retornado após 304');
  assert.strictEqual(fetchCalls.length, 2, 'nova requisição realizada com forceRefresh');
  assert.strictEqual(refreshed, first, 'resposta 304 mantém referência do cache');
});
