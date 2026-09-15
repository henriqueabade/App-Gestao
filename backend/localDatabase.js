const { readDatabaseConfig, isDev } = require('./dataConfig');

function isConnectionFailure(error) {
  const code = String(error?.code || '');
  // Um erro SQL respondido pelo servidor não significa perda de conexão.
  // Classe 08 e desligamento do servidor são falhas de disponibilidade.
  return !/^(?:[0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code) || code.startsWith('08') || code.startsWith('28') ||
    ['57P01', '57P02', '57P03', '53300', '53400', '58030'].includes(code);
}

function safeDatabaseError(original) {
  const messages = {
    '23505': 'Registro duplicado.',
    '23503': 'O registro possui dependências ou uma referência inválida.',
    '23502': 'Preencha todos os campos obrigatórios.',
    '22P02': 'Valor inválido para este campo.',
    '42P01': 'Tabela não disponível no banco DEV. Verifique o schema local.',
    '42703': 'Campo não disponível no banco DEV. Verifique o schema local.'
  };
  const code = String(original?.code || '');
  const unavailable = isConnectionFailure(original);
  const error = new Error(messages[code] || (unavailable
    ? 'Não foi possível acessar o banco DEV. Verifique a configuração e a conexão local.'
    : 'Não foi possível concluir a operação no banco DEV.'));
  error.code = Object.hasOwn(messages, code) ? code : unavailable ? 'db-unavailable' : 'db-query-failed';
  error.status = unavailable ? 503 : code === '23505' || code === '23503' ? 409 : code.startsWith('22') || code === '23502' ? 400 : 500;
  error.reason = unavailable ? 'db' : 'db-query';
  // Nunca anexar cause, detail, SQL, parâmetros ou o erro original.
  return error;
}

let pool;
const state = { ready: false, lastSuccessAt: 0, lastFailureAt: 0, lastAttemptAt: 0, lastError: null };
function getPool() {
  if (!isDev) throw new Error('Acesso direto ao banco permitido somente em BANCO=DEV.');
  // Testes devem injetar um banco isolado; jamais usar as credenciais reais do .env.
  if (process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') throw new Error('Conexão ao banco real bloqueada durante testes.');
  if (!pool) {
    const config = readDatabaseConfig();
    const { Pool } = require('pg');
    pool = new Pool(config);
    pool.on('error', recordFailure);
  }
  return pool;
}
function recordFailure(err) {
  const safe = safeDatabaseError(err);
  if (!isConnectionFailure(err)) {
    state.ready = true;
    state.lastError = null;
    return safe;
  }
  state.ready = false;
  state.lastFailureAt = Date.now();
  state.lastError = { message: safe.message, code: safe.code, reason: safe.reason };
  return safe;
}
async function execute(target, text, values) {
  state.lastAttemptAt = Date.now();
  try {
    const result = await target().query(text, values);
    state.ready = true;
    state.lastSuccessAt = Date.now();
    state.lastError = null;
    return result;
  } catch (err) { throw recordFailure(err); }
}
const query = (text, values) => execute(getPool, text, values);
async function connect() {
  try {
    const client = await getPool().connect();
    return { query: (text, values) => execute(() => client, text, values), release: () => client.release() };
  } catch (err) { throw recordFailure(err); }
}
async function healthCheck() {
  try {
    await query('SELECT 1');
    return { ok: true, status: 'ok', statusCode: 200, lastError: null };
  } catch (_) {
    return { ok: false, status: 'error', statusCode: 503, lastError: state.lastError };
  }
}
module.exports = {
  query, connect, healthCheck, safeDatabaseError, isConnectionFailure,
  init: () => {}, isReady: () => state.ready,
  getStatus: () => ({ ...state, connecting: false, retryInMs: state.ready ? 0 : 1000 }),
  ensureWarmup: healthCheck, ping: async () => (await healthCheck()).ok,
  createNotReadyError: () => safeDatabaseError(),
  end: async () => { if (pool) { await pool.end(); pool = null; state.ready = false; } }
};
