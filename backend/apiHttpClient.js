const { getToken, clearToken } = require('./tokenStore');

const RAW_API_BASE_URL =
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'https://api.santissimodecor.com.br';
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');
const DEFAULT_BEARER_TOKEN = normalizeToken(
  process.env.API_BEARER_TOKEN || process.env.DEFAULT_API_TOKEN || 'test-token'
);

function appendQueryParam(searchParams, key, value) {
  if (Array.isArray(value)) {
    value.forEach(item => {
      if (item === undefined || item === null || item === '') return;
      searchParams.append(key, String(item));
    });
    return;
  }

  if (value === undefined || value === null || value === '') return;
  searchParams.append(key, String(value));
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendQueryParam(searchParams, key, value));
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

function normalizeToken(rawToken) {
  if (typeof rawToken !== 'string') return '';
  const trimmed = rawToken.trim();
  if (!trimmed) return '';
  if (/^Bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^Bearer\s+/i, '').trim();
  }
  return trimmed;
}

function createApiClient(req) {
  function resolveBearer() {
    const stored = normalizeToken(getToken());
    return normalizeToken(req?.headers?.authorization || '') || stored || DEFAULT_BEARER_TOKEN;
  }

  async function send(method, path, { query, body } = {}) {
    const bearer = resolveBearer();
    if (!bearer) {
      const error = new Error('Token de autenticação ausente');
      error.status = 401;
      throw error;
    }

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${API_BASE_URL}${normalizedPath}${buildQueryString(query)}`;
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      const error = new Error(`Falha na requisição ${method} ${normalizedPath}: ${response.status}`);
      error.status = response.status;
      error.body = data;

      if (
        response.status === 401 &&
        bearer &&
        typeof data?.error === 'string' &&
        data.error.toLowerCase().includes('token inválido')
      ) {
        clearToken();
      }

      throw error;
    }

    return data;
  }

  return {
    get: (path, options = {}) => send('GET', path, options),
    post: (path, body, options = {}) => send('POST', path, { ...options, body }),
    put: (path, body, options = {}) => send('PUT', path, { ...options, body }),
    delete: (path, options = {}) => send('DELETE', path, options)
  };
}

module.exports = {
  createApiClient,
  normalizeToken
};
