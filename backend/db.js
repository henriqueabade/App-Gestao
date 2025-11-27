require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });

const DEFAULT_WARMUP_RETRY_DELAY_MS = 5_000;
const AUTH_EARLY_REFRESH_SECONDS = 60;
const API_BASE_URL = 'https://api.santissimodecor.com.br/api';
const LOGIN_URL = 'https://api.santissimodecor.com.br/login';

let warmupPromise = null;
let warmupTimer = null;
let warmupGeneration = 0;
let currentConfigKey = null;
let authPromise = null;

const state = {
  ready: false,
  connecting: false,
  lastSuccessAt: 0,
  lastFailureAt: 0,
  lastAttemptAt: 0,
  nextAttemptAt: 0,
  consecutiveFailures: 0,
  lastError: null
};

const authState = {
  token: null,
  tokenExpiresAt: 0,
  pin: null
};

function logDebug(message, context) {
  if (process.env.DEBUG !== 'true') return;
  if (context && Object.keys(context).length) {
    console.debug(`[api-client] ${message}`, context);
  } else {
    console.debug(`[api-client] ${message}`);
  }
}

function buildConfig(pin) {
  const credentials = resolveCredentials();
  return {
    ...credentials,
    pin: typeof pin === 'string' ? pin.trim() : pin || null
  };
}

function buildConfigKey(config) {
  return JSON.stringify({
    login: config.login,
    pin: config.pin
  });
}

function resetWarmupState() {
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  warmupPromise = null;
  state.ready = false;
  state.connecting = false;
  state.lastError = null;
  state.nextAttemptAt = 0;
}

function markConnecting() {
  state.connecting = true;
  state.lastAttemptAt = Date.now();
}

function markSuccess() {
  state.ready = true;
  state.connecting = false;
  state.lastSuccessAt = Date.now();
  state.consecutiveFailures = 0;
  state.lastError = null;
  state.nextAttemptAt = 0;
}

function markFailure(err) {
  state.ready = false;
  state.connecting = false;
  state.lastFailureAt = Date.now();
  state.consecutiveFailures = Math.min(state.consecutiveFailures + 1, 1_000_000);
  state.lastError = err instanceof Error ? err : new Error(String(err));
  state.nextAttemptAt = Date.now() + DEFAULT_WARMUP_RETRY_DELAY_MS;
  scheduleWarmup(DEFAULT_WARMUP_RETRY_DELAY_MS);
}

function scheduleWarmup(delay = 0) {
  if (state.ready) return;
  if (warmupPromise) return;
  if (warmupTimer) {
    clearTimeout(warmupTimer);
  }
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    runWarmup().catch(() => {});
  }, Math.max(0, delay));
  if (typeof warmupTimer.unref === 'function') {
    warmupTimer.unref();
  }
}

function createNotReadyError() {
  const status = getStatus();
  const error = new Error('Conectando ao serviço de API...');
  error.code = 'db-connecting';
  error.retryAfter = Math.max(status.retryInMs || DEFAULT_WARMUP_RETRY_DELAY_MS, 1_000);
  error.reason = 'db-connecting';
  return error;
}

function isReady() {
  return state.ready === true;
}

function ensureWarmup() {
  if (!state.ready && !state.connecting && !warmupPromise) {
    scheduleWarmup(0);
  }
}

function getStatus() {
  const retryInMs = state.ready ? 0 : Math.max((state.nextAttemptAt || 0) - Date.now(), 0);
  return {
    ready: state.ready,
    connecting: state.connecting,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastAttemptAt: state.lastAttemptAt,
    nextAttemptAt: state.nextAttemptAt,
    retryInMs,
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError
      ? {
          message: state.lastError.message,
          code: state.lastError.code
        }
      : null
  };
}

function resolveCredentials() {
  const candidates = [
    { login: process.env.API_LOGIN_EMAIL || process.env.API_LOGIN, password: process.env.API_LOGIN_PASSWORD },
    { login: process.env.API_EMAIL, password: process.env.API_PASSWORD },
    { login: process.env.DB_USER, password: process.env.DB_PASSWORD }
  ];

  for (const candidate of candidates) {
    if (candidate.login && candidate.password) {
      return { login: candidate.login, password: candidate.password };
    }
  }

  throw new Error('Credenciais de API não configuradas');
}

function decodeTokenExpiry(token) {
  if (!token || typeof token !== 'string') return 0;
  const parts = token.split('.');
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (payload && typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch (err) {
    logDebug('Falha ao decodificar exp do token', { message: err?.message });
  }
  return 0;
}

async function authenticate(config) {
  if (authPromise) return authPromise;

  authPromise = (async () => {
    const body = { login: config.login, password: config.password };
    const response = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = new Error(`Falha ao autenticar: ${response.status}`);
      error.code = 'auth-failed';
      throw error;
    }

    const data = await response.json();
    const token = data?.token || data?.access_token || data?.jwt;
    if (!token) {
      throw new Error('Resposta de login sem token');
    }

    const expiresAt = decodeTokenExpiry(token);
    authState.token = token;
    authState.tokenExpiresAt = expiresAt;
    return token;
  })();

  try {
    return await authPromise;
  } finally {
    authPromise = null;
  }
}

function tokenIsValid() {
  if (!authState.token) return false;
  if (!authState.tokenExpiresAt) return true;
  const expiresInMs = authState.tokenExpiresAt - Date.now();
  return expiresInMs > AUTH_EARLY_REFRESH_SECONDS * 1000;
}

async function getToken(config) {
  if (tokenIsValid()) return authState.token;
  try {
    const token = await authenticate(config);
    markSuccess();
    return token;
  } catch (err) {
    markFailure(err);
    throw err;
  }
}

async function runWarmup() {
  if (state.ready) return;
  if (warmupPromise) return warmupPromise;

  const generation = warmupGeneration;

  warmupPromise = (async () => {
    markConnecting();
    const config = buildConfig(authState.pin);
    try {
      await getToken(config);
      if (generation === warmupGeneration) {
        await lightweightHealthCheck(config);
        markSuccess();
      }
    } catch (err) {
      if (generation === warmupGeneration) {
        markFailure(err);
      }
      throw err;
    } finally {
      warmupPromise = null;
    }
  })();

  warmupPromise.catch(() => {});
  return warmupPromise;
}

async function lightweightHealthCheck(config) {
  try {
    await request('GET', '/health', { config, skipRetry: true });
  } catch (err) {
    if (err?.status === 404) {
      // Se o endpoint não existir, considere que a autenticação já prova disponibilidade
      return true;
    }
    throw err;
  }
  return true;
}

async function request(method, path, options = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const config = options.config || buildConfig(authState.pin);
  let token = authState.token;

  if (!tokenIsValid()) {
    token = await getToken(config);
  }

  const url = `${API_BASE_URL}${normalizedPath}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`
  };

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && !options.skipRetry) {
    authState.token = null;
    authState.tokenExpiresAt = 0;
    token = await getToken(config);
    headers.Authorization = `Bearer ${token}`;
    return request(method, path, { ...options, headers, skipRetry: true });
  }

  if (!response.ok) {
    const error = new Error(`Erro na requisição ${method} ${normalizedPath}: ${response.status}`);
    error.code = 'api-request-failed';
    error.status = response.status;
    error.body = await safeJson(response);
    throw error;
  }

  return safeJson(response);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

function init(pin) {
  const config = buildConfig(pin);
  authState.pin = config.pin;
  const configKey = buildConfigKey(config);
  if (currentConfigKey === configKey && authState.token) {
    return;
  }

  warmupGeneration += 1;
  resetWarmupState();
  currentConfigKey = configKey;
  scheduleWarmup(0);
}

async function ping() {
  try {
    await runWarmup();
    return true;
  } catch (err) {
    markFailure(err);
    return false;
  }
}

async function query(path, options = {}) {
  if (!state.ready) {
    ensureWarmup();
    throw createNotReadyError();
  }
  const method = options.method || 'GET';
  const body = options.body || options.data;
  return request(method, path, { body, headers: options.headers });
}

async function connect() {
  await runWarmup();
  return {
    query,
    get,
    post,
    put,
    delete: del
  };
}

function get(path, options) {
  return query(path, { ...options, method: 'GET' });
}

function post(path, body, options) {
  return query(path, { ...options, method: 'POST', body });
}

function put(path, body, options) {
  return query(path, { ...options, method: 'PUT', body });
}

function del(path, options) {
  return query(path, { ...options, method: 'DELETE' });
}

// inicializa com variáveis de ambiente por padrão
init();

module.exports = {
  init,
  query,
  connect,
  isReady,
  ensureWarmup,
  getStatus,
  createNotReadyError,
  ping,
  get,
  post,
  put,
  delete: del
};

