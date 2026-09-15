// Configuração exclusiva do processo principal/backend. Nunca exportar ao renderer.
const path = require('path');
const testing = Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test');
const databaseKeys = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'DB_PASSWORD'];
const loaded = testing ? {} : require('dotenv').config({
  path: path.resolve(__dirname, '../.env'), quiet: true, processEnv: {}
}).parsed || {};
for (const [key, value] of Object.entries(loaded)) {
  if (!databaseKeys.includes(key) && process.env[key] === undefined) process.env[key] = value;
}
// Credenciais em memória privada, fora do ambiente herdado pelos renderers.
const privateDatabaseEnv = {};
for (const key of databaseKeys) {
  privateDatabaseEnv[key] = process.env[key] ?? loaded[key];
  delete process.env[key];
}

function readMode(env = process.env) {
  const mode = String(env.BANCO || 'PROD').trim().toUpperCase() || 'PROD';
  if (!['PROD', 'DEV'].includes(mode)) {
    throw new Error('BANCO inválido. Configure PROD ou DEV e reinicie o aplicativo.');
  }
  return mode;
}

function readDatabaseConfig(env = privateDatabaseEnv) {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) {
    if (!String(env[key] || '').trim()) throw new Error(`Configure ${key} no .env para usar BANCO=DEV.`);
  }
  if (typeof env.DB_PASSWORD !== 'string') throw new Error('Configure DB_PASSWORD no .env para usar BANCO=DEV.');
  const port = Number(env.DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT inválida.');
  return {
    host: env.DB_HOST.trim(), port, user: env.DB_USER.trim(),
    database: env.DB_NAME.trim(), password: env.DB_PASSWORD,
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 15000, query_timeout: 17000, allowExitOnIdle: true
  };
}

const mode = readMode();
module.exports = { mode, isDev: mode === 'DEV', readMode, readDatabaseConfig };
