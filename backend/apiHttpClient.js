const API_BASE_URL = 'https://api.santissimodecor.com.br/api';
const DEFAULT_BEARER_TOKEN = normalizeToken(process.env.API_BEARER_TOKEN || 'test-token');

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
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
  const bearer = normalizeToken(req?.headers?.authorization || '') || DEFAULT_BEARER_TOKEN;
  if (!bearer) {
    const error = new Error('Token de autenticação ausente');
    error.status = 401;
    throw error;
  }

  async function send(method, path, { query, body } = {}) {
    const url = `${API_BASE_URL}${path}${buildQueryString(query)}`;
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
      const error = new Error(`Falha na requisição ${method} ${path}: ${response.status}`);
      error.status = response.status;
      error.body = data;
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
  createApiClient
};
