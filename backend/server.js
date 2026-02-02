// carrega variáveis do .env sem mensagens informativas
require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const path = require('path');
const clientesRouter = require('./clientesController');
const passwordResetRouter = require('./passwordResetRoutes');
const usuariosRouter = require('./usuariosController');
const transportadorasRouter = require('./transportadorasController');
const orcamentosRouter = require('./orcamentosController');
const pedidosRouter = require('./pedidosController');
const notificationsRouter = require('./notificationsController');
const db = require('./db');
const { normalizeToken } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');

const DEFAULT_BEARER_TOKEN = normalizeToken(
  process.env.API_BEARER_TOKEN || process.env.DEFAULT_API_TOKEN || 'test-token'
);

db.init({ tokenProvider: getToken });

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

app.use((req, _res, next) => {
  if (!req.headers.authorization) {
    const stored = getToken();
    if (stored) {
      req.headers.authorization = `Bearer ${normalizeToken(stored)}`;
    } else if (DEFAULT_BEARER_TOKEN) {
      req.headers.authorization = `Bearer ${DEFAULT_BEARER_TOKEN}`;
    }
  }
  next();
});

app.use('/api/clientes', clientesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/transportadoras', transportadorasRouter);
app.use('/api/orcamentos', orcamentosRouter);
app.use('/api/pedidos', pedidosRouter);

const { createApiClient } = require('./apiHttpClient');
const apiCache = new Map();
const CACHE_TTL_MS = Number.parseInt(process.env.API_TABLE_CACHE_TTL_MS || '0', 10);

function getTableCache(table) {
  if (!apiCache.has(table)) {
    apiCache.set(table, new Map());
  }
  return apiCache.get(table);
}

function buildCacheKey(query = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null || item === '') return;
        entries.push([key, String(item)]);
      });
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    entries.push([key, String(value)]);
  }

  if (!entries.length) return '';
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return entries.map(([key, value]) => `${key}=${value}`).join('&');
}

function readCache(table, cacheKey) {
  const tableCache = apiCache.get(table);
  if (!tableCache) return null;
  const entry = tableCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    tableCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function writeCache(table, cacheKey, value) {
  const tableCache = getTableCache(table);
  const expiresAt = CACHE_TTL_MS > 0 ? Date.now() + CACHE_TTL_MS : null;
  tableCache.set(cacheKey, { value, expiresAt });
}

function invalidateCache(table) {
  if (!table) {
    apiCache.clear();
    return;
  }
  apiCache.delete(table);
}

app.get('/api/contatos_cliente', async (req, res) => {
  try {
    // Cria o cliente com base na requisição atual (injeta token automaticamente)
    const api = createApiClient(req);

    const query = req._parsedUrl.search || '';

    // Agora sim, o cliente possui o método .get()
    const data = await api.get(`/api/contatos_cliente${query}`);

    res.status(200).json(data);
  } catch (err) {
    console.error('Erro no proxy /api/contatos_cliente:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao buscar contatos do cliente' });
  }
});

app.use('/api/notifications', notificationsRouter);
app.use(passwordResetRouter);
app.use('/pdf', express.static(path.join(__dirname, '../src/pdf')));
app.use('/styles', express.static(path.join(__dirname, '../src/styles')));
app.use('/js', express.static(path.join(__dirname, '../src/js')));

app.get('/api/:table', async (req, res) => {
  const { table } = req.params;
  if (!table) {
    res.status(400).json({ error: 'Tabela inválida' });
    return;
  }

  try {
    const api = createApiClient(req);
    const cacheKey = buildCacheKey(req.query);
    const cached = readCache(table, cacheKey);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const data = await api.get(`/api/${table}`, { query: req.query });
    writeCache(table, cacheKey, data);
    res.status(200).json(data);
  } catch (err) {
    console.error('Erro no proxy /api/:table:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao buscar dados' });
  }
});

app.post('/api/:table', async (req, res) => {
  const { table } = req.params;
  if (!table) {
    res.status(400).json({ error: 'Tabela inválida' });
    return;
  }

  try {
    const api = createApiClient(req);
    const created = await api.post(`/api/${table}`, req.body);
    invalidateCache(table);
    res.status(201).json(created);
  } catch (err) {
    console.error('Erro no proxy POST /api/:table:', err);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Erro interno ao salvar dados' });
  }
});

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

async function runHealthCheck() {
  const dbStatus = db.getStatus();
  const health = await db.healthCheck();
  const ok = Boolean(health?.ok && dbStatus.ready);
  const statusCode = ok ? 200 : health?.statusCode || 503;

  return {
    statusCode,
    status: ok ? 'ok' : 'error',
    db_ready: ok,
    db_ok: ok,
    db_status: ok ? 'ready' : 'error',
    last_error: health?.lastError || dbStatus.lastError || null,
    last_success_at: dbStatus.lastSuccessAt || null,
    last_failure_at: dbStatus.lastFailureAt || null,
    token_ready: dbStatus.ready
  };
}

async function handleHealthz(req, res) {
  try {
    const payload = await runHealthCheck();
    res.status(payload.statusCode).json({
      status: payload.status,
      db_ok: payload.db_ok,
      db_ready: payload.db_ready,
      db_status: payload.db_status,
      last_error: payload.last_error,
      last_success_at: payload.last_success_at,
      last_failure_at: payload.last_failure_at,
      token_ready: payload.token_ready
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db_ok: false,
      db_ready: false,
      db_status: 'error',
      last_error: { message: err?.message || 'health-check-error' }
    });
  }
}

app.get('/healthz', handleHealthz);
app.get('/healthz/combined', handleHealthz);
app.get('/healthz/db', handleHealthz);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  if (!process.env.PORT) console.warn('PORT not set, defaulting to 3000');
  const DEBUG = process.env.DEBUG === 'true';
  const server = app.listen(PORT, () => {
    if (DEBUG) console.log(`API server running on port ${PORT}`);
  });
  try {
    const keepAliveTimeout = 65_000;
    server.keepAliveTimeout = Math.max(server.keepAliveTimeout ?? 0, keepAliveTimeout);
    server.headersTimeout = Math.max(server.headersTimeout ?? 0, keepAliveTimeout + 5_000);
  } catch (err) {
    if (process.env.DEBUG === 'true') {
      console.warn('[server] unable to adjust keep-alive timeouts:', err);
    }
  }
}

module.exports = app;
