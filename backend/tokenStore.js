const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '..', 'data', 'authToken.json');

let currentToken = null;

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
    }
  } catch (err) {
    currentToken = null;
  }
}

function setToken(token) {
  currentToken = typeof token === 'string' && token.trim() ? token.trim() : null;
  if (currentToken) {
    persistToken(currentToken);
  } else {
    clearToken();
  }
}

function getToken() {
  return currentToken;
}

function clearToken() {
  currentToken = null;
  try {
    fs.rmSync(TOKEN_PATH, { force: true });
  } catch (err) {
    console.error('Não foi possível limpar o token salvo', err);
  }
}

loadPersistedToken();

module.exports = { setToken, getToken, clearToken };
