require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const { Pool } = require('pg');

let pool;
let queryGuard = () => true;
let guardOverrideDepth = 0;

const DEFAULT_MAX_CLIENTS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

function createConfig(pin) {
  const useSSL = process.env.DB_USE_SSL === 'true';
  const configuredPort = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: pin ? parseInt(pin, 10) : configuredPort,
    ssl: useSSL
      ? {
          rejectUnauthorized: false // Permite conectar com SSL mesmo sem certificado válido
        }
      : false,
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : DEFAULT_MAX_CLIENTS,
    idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT_MS
      ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)
      : DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT_MS
      ? parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)
      : DEFAULT_CONNECTION_TIMEOUT_MS,
    allowExitOnIdle: false,
    keepAlive: true
  };
}

function init(pin) {
  const required = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `Using default database configuration because environment variables ${missing.join(', ')} are not set.`
    );
  }
  pool = new Pool(createConfig(pin));
  pool.on('error', (err) => {
    console.error('Erro inesperado do cliente PostgreSQL:', err);
  });
  return pool;
}

function query(text, params) {
  if (!pool) init();
  if (guardOverrideDepth === 0) {
    try {
      if (!queryGuard()) {
        const error = new Error('database-access-disabled');
        error.code = 'offline';
        throw error;
      }
    } catch (guardError) {
      return Promise.reject(guardError);
    }
  }
  return pool.query(text, params);
}

function connect() {
  if (!pool) init();
  if (guardOverrideDepth === 0 && !queryGuard()) {
    const error = new Error('database-access-disabled');
    error.code = 'offline';
    return Promise.reject(error);
  }
  return pool.connect();
}

function setQueryGuard(fn) {
  if (typeof fn === 'function') {
    queryGuard = fn;
  } else {
    queryGuard = () => true;
  }
}

function withQueryGuardDisabled(fn) {
  if (typeof fn !== 'function') {
    return Promise.resolve();
  }
  guardOverrideDepth += 1;
  let result;
  try {
    result = fn();
  } catch (err) {
    guardOverrideDepth = Math.max(guardOverrideDepth - 1, 0);
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      guardOverrideDepth = Math.max(guardOverrideDepth - 1, 0);
    });
  }
  guardOverrideDepth = Math.max(guardOverrideDepth - 1, 0);
  return result;
}

// inicializa com variáveis de ambiente por padrão
init();

module.exports = { init, query, connect, setQueryGuard, withQueryGuardDisabled };
// Changelog:
// - 2024-05-17: configurado pool PG com keep-alive, limites reduzidos e timeouts para reduzir ruído e conexões ociosas.
// - 2024-08-27: adicionada guarda configurável e bypass controlado para suspender queries durante indisponibilidade.
