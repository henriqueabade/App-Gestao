require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });

const { AsyncLocalStorage } = require('async_hooks');

const RAW_API_BASE_URL =
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'https://api.santissimodecor.com.br';
const NORMALIZED_API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');
const API_BASE_URL = NORMALIZED_API_BASE_URL.endsWith('/api')
  ? NORMALIZED_API_BASE_URL
  : `${NORMALIZED_API_BASE_URL}/api`;

const requestContext = new AsyncLocalStorage();
let defaultTokenProvider = null;

const state = {
  ready: false,
  lastSuccessAt: 0,
  lastFailureAt: 0,
  lastAttemptAt: 0,
  lastError: null
};

function logDebug(message, context) {
  if (process.env.DEBUG !== 'true') return;
  if (context && Object.keys(context).length) {
    console.debug(`[api-client] ${message}`, context);
  } else {
    console.debug(`[api-client] ${message}`);
  }
}

function normalizeToken(token) {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  const bearerMatch = trimmed.match(/^Bearer\s+(.+)/i);
  return bearerMatch ? bearerMatch[1] : trimmed;
}

async function resolveToken(options = {}) {
  const providedToken = normalizeToken(options.token);
  if (providedToken) return providedToken;

  if (typeof options.tokenProvider === 'function') {
    const candidate = normalizeToken(await options.tokenProvider());
    if (candidate) return candidate;
  }

  const storeToken = normalizeToken(requestContext.getStore()?.token);
  if (storeToken) return storeToken;

  if (typeof defaultTokenProvider === 'function') {
    return normalizeToken(await defaultTokenProvider());
  }

  return null;
}

function updateStateSuccess() {
  state.ready = true;
  state.lastSuccessAt = Date.now();
  state.lastError = null;
}

function updateStateFailure(err) {
  state.ready = false;
  state.lastFailureAt = Date.now();
  const normalizedError = err instanceof Error ? err : new Error(String(err));
  state.lastError = {
    message: normalizedError.message,
    code: normalizedError.code,
    reason: normalizedError.reason,
    status: normalizedError.status
  };
}

function buildQueryString(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        searchParams.append(key, String(item));
      }
    } else {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

async function request(method, path, options = {}) {
  const token = await resolveToken(options);
  if (!token) {
    const error = new Error('Token de autenticação ausente.');
    error.code = 'auth-missing';
    error.reason = 'user-auth';
    throw error;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const qs = buildQueryString(options.query || {});
  const url = `${API_BASE_URL}${normalizedPath}${qs}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`
  };

  state.lastAttemptAt = Date.now();

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401 && !options.skipRetry) {
    logDebug('Token inválido, tentando renovar e refazer a requisição');
    const refreshedToken = await resolveToken({ ...options, skipRetry: true });
    if (refreshedToken && refreshedToken !== token) {
      headers.Authorization = `Bearer ${refreshedToken}`;
      return request(method, path, { ...options, headers, skipRetry: true, token: refreshedToken });
    }
  }

  if (!response.ok) {
    const error = new Error(`Erro na requisição ${method} ${normalizedPath}: ${response.status}`);
    error.code = 'api-request-failed';
    error.status = response.status;
    error.body = await safeJson(response);
    updateStateFailure(error);
    throw error;
  }

  updateStateSuccess();
  return safeJson(response);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function query(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body || options.data;
  return request(method, path, { ...options, body });
}

function get(path, options) {
  return query(path, { ...options, method: 'GET' });
}

function post(path, body, options) {
  return query(path, { ...options, method: 'POST', body });
}

function patch(path, body, options) {
  return query(path, { ...options, method: 'PATCH', body });
}

function put(path, body, options) {
  return query(path, { ...options, method: 'PUT', body });
}

function del(path, options) {
  return query(path, { ...options, method: 'DELETE' });
}

async function connect(options = {}) {
  const token = await resolveToken(options);
  if (!token) {
    throw createNotReadyError();
  }
  const boundOptions = { ...options, token };
  return {
    query: (path, localOptions = {}) => query(path, { ...boundOptions, ...localOptions }),
    get: (path, localOptions = {}) => get(path, { ...boundOptions, ...localOptions }),
    post: (path, body, localOptions = {}) => post(path, body, { ...boundOptions, ...localOptions }),
    put: (path, body, localOptions = {}) => put(path, body, { ...boundOptions, ...localOptions }),
    delete: (path, localOptions = {}) => del(path, { ...boundOptions, ...localOptions })
  };
}

function runWithToken(token, fn) {
  const normalized = normalizeToken(token);
  if (!normalized) return fn();
  return requestContext.run({ token: normalized }, fn);
}

function init(config) {
  if (!config) {
    defaultTokenProvider = null;
    state.ready = false;
    return;
  }

  if (typeof config === 'string') {
    defaultTokenProvider = () => normalizeToken(config);
  } else if (typeof config.tokenProvider === 'function') {
    defaultTokenProvider = config.tokenProvider;
  } else if (config.token) {
    defaultTokenProvider = () => normalizeToken(config.token);
  } else {
    defaultTokenProvider = null;
  }

  state.ready = Boolean(defaultTokenProvider);
}

function isReady() {
  return Boolean(requestContext.getStore()?.token || defaultTokenProvider);
}

function ensureWarmup() {
  if (!isReady()) {
    throw createNotReadyError();
  }
}

function getStatus() {
  return {
    ready: isReady(),
    connecting: false,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastAttemptAt: state.lastAttemptAt,
    nextAttemptAt: 0,
    retryInMs: isReady() ? 0 : 1_000,
    consecutiveFailures: state.lastError ? 1 : 0,
    lastError: state.lastError
  };
}

function createNotReadyError() {
  const error = new Error('Token de autenticação ausente.');
  error.code = 'auth-missing';
  error.reason = 'user-auth';
  error.retryAfter = 1_000;
  return error;
}

async function healthCheck(options = {}) {
  try {
    await request('GET', '/health', { ...options, skipRetry: true });
    updateStateSuccess();
    return { ok: true, status: 'ok', statusCode: 200, lastError: null };
  } catch (err) {
    updateStateFailure(err);
    const normalized = err instanceof Error ? err : new Error(String(err));
    const statusCode = Number.isFinite(normalized.status)
      ? normalized.status
      : Number.isFinite(normalized.statusCode)
        ? normalized.statusCode
        : normalized.code === 'auth-missing' || normalized.reason === 'user-auth'
          ? 401
          : normalized.reason === 'offline'
            ? 502
            : 503;

    return {
      ok: false,
      status: 'error',
      statusCode,
      lastError: {
        message: normalized.message,
        code: normalized.code,
        reason: normalized.reason,
        status: statusCode
      }
    };
  }
}

async function ping(options = {}) {
  const result = await healthCheck(options);
  return result.ok;
}

module.exports = {
  init,
  query,
  connect,
  isReady,
  ensureWarmup,
  getStatus,
  createNotReadyError,
  healthCheck,
  ping,
  get,
  post,
  patch,
  put,
  delete: del,
  runWithToken
};
