const db = require('./db');
const { createApiClient } = require('./apiHttpClient');
const { setToken, clearToken, getToken } = require('./tokenStore');

const RAW_API_BASE_URL =
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'https://api.santissimodecor.com.br';
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');

function extractUserIdFromToken(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return null;

  const bearerMatch = raw.match(/^Bearer\s+(.+)/i);
  const stripped = bearerMatch ? bearerMatch[1].trim() : raw;
  const numeric = Number(stripped);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  const jwtParts = stripped.split('.');
  if (jwtParts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString('utf-8'));
      const candidates = [payload?.id, payload?.usuarioId, payload?.userId, payload?.sub];
      for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch (_) {}
  }

  return null;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

async function registrarUsuario(nome, email, senha) {
  const api = createApiClient();
  const payload = {
    nome,
    email: normalizeEmail(email),
    senha
  };
  const created = await api.post('/api/usuarios', payload);
  return created;
}

async function loginUsuario(email, senha) {
  const normalizedEmail = normalizeEmail(email);
  try {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, senha })
    });

    let data = null;
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      const error = new Error(data?.message || 'Falha ao autenticar.');
      error.code = response.status === 401 ? 'auth-failed' : 'login-error';
      if (response.status === 401) {
        error.reason = 'user-auth';
      }
      throw error;
    }

    if (data?.token) {
      setToken(data.token);
      db.init({ tokenProvider: getToken });
    }

    const userFromLogin = data?.usuario || data?.user || {};
    const userIdFromLogin = userFromLogin?.id;
    const userIdFromToken = data?.token ? extractUserIdFromToken(data.token) : null;
    const userId = userIdFromLogin || userIdFromToken || null;

    if (!userId) {
      const error = new Error('Não foi possível identificar o usuário autenticado.');
      error.code = 'user-details-missing';
      throw error;
    }

    let userDetails = null;

    try {
      const api = createApiClient();
      userDetails = await api.get(`/api/usuarios/${userId}`);
    } catch (userFetchError) {
      console.error('Erro ao buscar usuário autenticado:', userFetchError);
      const error = new Error('Não foi possível carregar os dados do usuário autenticado.');
      error.code = 'user-details-fetch-failed';
      error.cause = userFetchError;
      throw error;
    }

    if (!userDetails) {
      const error = new Error('Dados do usuário autenticado não disponíveis.');
      error.code = 'user-details-empty';
      throw error;
    }

    const user = { ...userFromLogin, ...userDetails };
    const perfil =
      user.perfil ||
      user.tipo_perfil ||
      user.tipoPerfil ||
      user.perfil_nome ||
      user.perfilNome ||
      user.role ||
      null;
    return {
      id: user.id,
      nome: user.nome,
      perfil,
      email: user.email,
      token: data?.token || null
    };
  } catch (err) {
    if (err instanceof TypeError) {
      err.reason = 'offline';
    }
    throw err;
  }
}

function isPinError() {
  return false;
}

function isNetworkError(err) {
  if (!err) return false;
  if (err.reason === 'offline') return true;
  if (err instanceof TypeError) return true;
  return false;
}

function ensureDatabaseReady() {
  return true;
}

function waitForDatabaseReady() {
  return Promise.resolve(true);
}

function clearAuthentication() {
  clearToken();
  db.init(null);
}

module.exports = {
  registrarUsuario,
  loginUsuario,
  isPinError,
  isNetworkError,
  ensureDatabaseReady,
  waitForDatabaseReady,
  clearAuthentication
};
