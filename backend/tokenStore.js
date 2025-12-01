const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '..', 'data', 'authToken.json');
const TOKEN_REFRESH_INTERVAL_MS = Math.max(
  Number.parseInt(process.env.TOKEN_REFRESH_INTERVAL_MS || '5000', 10),
  1000
);

let currentToken = null;
let lastKnownMtimeMs = null;
let lastStatCheckAt = 0;

function persistToken(token) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ token }), 'utf-8');
  } catch (err) {
    console.error('Não foi possível salvar o token de autenticação', err);
  }
}

function loadPersistedToken() {
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.token === 'string' && parsed.token.trim()) {
      currentToken = parsed.token.trim();
    } else {
      currentToken = null;
    }
    const stats = fs.statSync(TOKEN_PATH);
    lastKnownMtimeMs = stats?.mtimeMs || null;
  } catch (err) {
    currentToken = null;
    lastKnownMtimeMs = null;
  }
}

function setToken(token) {
  currentToken = typeof token === 'string' && token.trim() ? token.trim() : null;
  if (currentToken) {
    persistToken(currentToken);
    try {
      const stats = fs.statSync(TOKEN_PATH);
      lastKnownMtimeMs = stats?.mtimeMs || null;
      lastStatCheckAt = Date.now();
    } catch (_) {
      lastKnownMtimeMs = null;
    }
  } else {
    clearToken();
  }
}

function getToken() {
  refreshTokenFromDisk();
  return currentToken;
}

function clearToken() {
  currentToken = null;
  lastKnownMtimeMs = null;
  try {
    fs.rmSync(TOKEN_PATH, { force: true });
  } catch (err) {
    console.error('Não foi possível limpar o token salvo', err);
  }
}

function refreshTokenFromDisk(force = false) {
  const now = Date.now();
  if (!force && now - lastStatCheckAt < TOKEN_REFRESH_INTERVAL_MS) {
    return;
  }

  lastStatCheckAt = now;

  let stats = null;
  try {
    stats = fs.statSync(TOKEN_PATH);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      currentToken = null;
      lastKnownMtimeMs = null;
      return;
    }
    return;
  }

  if (!stats || (lastKnownMtimeMs && stats.mtimeMs === lastKnownMtimeMs)) {
    return;
  }

  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    currentToken = parsed && typeof parsed.token === 'string' && parsed.token.trim()
      ? parsed.token.trim()
      : null;
    lastKnownMtimeMs = stats.mtimeMs;
  } catch (err) {
    currentToken = null;
    lastKnownMtimeMs = stats?.mtimeMs || lastKnownMtimeMs;
  }
}

loadPersistedToken();

module.exports = { setToken, getToken, clearToken, refreshTokenFromDisk };
