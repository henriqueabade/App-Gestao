require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_MAX_CLIENTS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;
const WARMUP_RETRY_DELAY_MS = 5_000;

const warmupLogPath = path.join(__dirname, 'db-warmup.log');

const CONNECTION_ERROR_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE'
]);

let pool;
let currentConfigKey = null;
let warmupPromise = null;
let warmupTimer = null;
let warmupGeneration = 0;

const state = {
  ready: false,
  connecting: false,
  lastSuccessAt: 0,
  lastFailureAt: 0,
  lastAttemptAt: 0,
  nextAttemptAt: 0,
  consecutiveFailures: 0,
  lastError: null
};

function logWarmup(level, message, extra) {
  const timestamp = new Date().toISOString();
  const normalizedLevel = String(level || 'info').toUpperCase();
  const serializedExtra =
    extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  const line = `[${timestamp}] [${normalizedLevel}] ${message}${serializedExtra}\n`;
  fs.promises
    .appendFile(warmupLogPath, line)
    .catch((err) => {
      if (process.env.DEBUG === 'true') {
        console.error('[db] falha ao registrar log de warmup:', err);
      }
    });
}

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

function isConnectionError(err) {
  if (!err) return false;
  if (err.code && CONNECTION_ERROR_CODES.has(err.code)) {
    return true;
  }
  const message = String(err.message || '').toLowerCase();
  return (
    message.includes('connection refused') ||
    message.includes('terminating connection') ||
    message.includes('server closed the connection') ||
    message.includes('timeout') ||
    message.includes('could not connect') ||
    message.includes('connection reset')
  );
}

function buildConfigKey(config) {
  return JSON.stringify({
    user: config.user,
    host: config.host,
    database: config.database,
    port: config.port,
    ssl: Boolean(config.ssl),
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis
  });
}

function resetWarmupState() {
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  warmupPromise = null;
  state.ready = false;
  state.connecting = false;
  state.lastError = null;
  state.nextAttemptAt = 0;
}

function scheduleWarmup(delay = 0) {
  if (state.ready) return;
  if (warmupPromise) return;
  if (warmupTimer) {
    clearTimeout(warmupTimer);
  }
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    runWarmup().catch(() => {});
  }, Math.max(0, delay));
  if (typeof warmupTimer.unref === 'function') {
    warmupTimer.unref();
  }
}

function markConnecting() {
  state.connecting = true;
  state.lastAttemptAt = Date.now();
}

function markSuccess() {
  state.ready = true;
  state.connecting = false;
  state.lastSuccessAt = Date.now();
  state.consecutiveFailures = 0;
  state.lastError = null;
  state.nextAttemptAt = 0;
  logWarmup('info', 'Conexão com o banco estabelecida', {
    attemptAt: state.lastAttemptAt,
    successAt: state.lastSuccessAt
  });
}

function markFailure(err) {
  state.ready = false;
  state.connecting = false;
  state.lastFailureAt = Date.now();
  state.consecutiveFailures = Math.min(state.consecutiveFailures + 1, 1_000_000);
  state.lastError = err instanceof Error ? err : new Error(String(err));
  state.nextAttemptAt = Date.now() + WARMUP_RETRY_DELAY_MS;
  logWarmup('warn', 'Falha ao conectar ao banco', {
    message: state.lastError.message,
    code: state.lastError.code,
    attemptAt: state.lastAttemptAt
  });
  scheduleWarmup(WARMUP_RETRY_DELAY_MS);
}

function runWarmup() {
  if (!pool) init();
  if (!pool) return Promise.reject(new Error('Pool não inicializado'));
  if (state.ready) return Promise.resolve();
  if (warmupPromise) return warmupPromise;

  const generation = warmupGeneration;

  warmupPromise = (async () => {
    markConnecting();
    try {
      await pool.query('SELECT 1');
      if (generation === warmupGeneration) {
        markSuccess();
      }
    } catch (err) {
      if (generation === warmupGeneration) {
        markFailure(err);
      }
      throw err;
    } finally {
      warmupPromise = null;
    }
  })();

  warmupPromise.catch(() => {});
  return warmupPromise;
}

function init(pin) {
  const required = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(
      `Using default database configuration because environment variables ${missing.join(', ')} are not set.`
    );
  }

  const config = createConfig(pin);
  const configKey = buildConfigKey(config);

  if (pool && configKey === currentConfigKey) {
    return pool;
  }

  warmupGeneration += 1;
  resetWarmupState();

  if (pool) {
    pool.removeAllListeners('error');
    pool.end().catch((err) => {
      if (process.env.DEBUG === 'true') {
        console.error('[db] falha ao encerrar pool anterior:', err);
      }
    });
  }

  pool = new Pool(config);
  currentConfigKey = configKey;
  pool.on('error', (err) => {
    logWarmup('error', 'Erro inesperado do cliente PostgreSQL', {
      message: err?.message,
      code: err?.code
    });
    markFailure(err);
  });

  logWarmup('info', 'Pool do banco reconfigurado', {
    host: config.host,
    port: config.port
  });

  scheduleWarmup(0);
  return pool;
}

function isReady() {
  return state.ready === true;
}

function ensureWarmup() {
  if (!pool) init();
  if (!state.ready && !state.connecting && !warmupPromise) {
    scheduleWarmup(0);
  }
}

function getStatus() {
  const retryInMs = state.ready
    ? 0
    : Math.max((state.nextAttemptAt || 0) - Date.now(), 0);
  return {
    ready: state.ready,
    connecting: state.connecting,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastAttemptAt: state.lastAttemptAt,
    nextAttemptAt: state.nextAttemptAt,
    retryInMs,
    consecutiveFailures: state.consecutiveFailures,
    lastError: state.lastError
      ? {
          message: state.lastError.message,
          code: state.lastError.code
        }
      : null
  };
}

function createNotReadyError() {
  const status = getStatus();
  const error = new Error('Conectando ao banco...');
  error.code = 'db-connecting';
  error.retryAfter = Math.max(status.retryInMs || WARMUP_RETRY_DELAY_MS, 1_000);
  return error;
}

function query(text, params) {
  if (!pool) init();
  if (!state.ready) {
    ensureWarmup();
    throw createNotReadyError();
  }

  return pool.query(text, params).catch((err) => {
    if (isConnectionError(err)) {
      markFailure(err);
    }
    throw err;
  });
}

function connect() {
  if (!pool) init();
  if (!state.ready) {
    ensureWarmup();
    throw createNotReadyError();
  }

  return pool.connect().catch((err) => {
    if (isConnectionError(err)) {
      markFailure(err);
    }
    throw err;
  });
}

async function ping() {
  try {
    await runWarmup();
    return true;
  } catch (err) {
    markFailure(err);
    return false;
  }
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

module.exports = {
  init,
  query,
  connect,
  isReady,
  ensureWarmup,
  getStatus,
  createNotReadyError,
  ping
};
// Changelog:
// - 2024-05-17: configurado pool PG com keep-alive, limites reduzidos e timeouts para reduzir ruído e conexões ociosas.
// - 2024-07-XX: adicionado warmup tolerante com tentativas em background e timeout ampliado.
