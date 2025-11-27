const db = require('./db');
const { createApiClient } = require('./apiHttpClient');
const { setToken, clearToken, getToken } = require('./tokenStore');

const RAW_API_BASE_URL =
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'http://localhost:3000';
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');

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

    const user = data?.usuario || data?.user || {};
    return {
      id: user.id,
      nome: user.nome,
      perfil: user.perfil,
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
