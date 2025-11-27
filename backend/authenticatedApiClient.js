const { createApiClient } = require('./apiHttpClient');

function getAuthorizationHeader(req) {
  const raw = req?.get?.('authorization') || '';
  return raw.trim();
}

function requireAuthApiClient(req) {
  const header = getAuthorizationHeader(req);
  if (!header) {
    const error = new Error('Token de autenticação ausente');
    error.status = 401;
    throw error;
  }

  try {
    return createApiClient({ headers: { authorization: header } });
  } catch (err) {
    if (err && !err.status) {
      err.status = 401;
    }
    throw err;
  }
}

module.exports = {
  requireAuthApiClient
};
