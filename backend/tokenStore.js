let currentToken = null;

function setToken(token) {
  currentToken = typeof token === 'string' && token.trim() ? token.trim() : null;
}

function getToken() {
  return currentToken;
}

function clearToken() {
  currentToken = null;
}

module.exports = { setToken, getToken, clearToken };
