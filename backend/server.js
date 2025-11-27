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
const { normalizeToken } = require('./apiHttpClient');
const { getToken } = require('./tokenStore');

const DEFAULT_BEARER_TOKEN = normalizeToken(process.env.API_BEARER_TOKEN || '');

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
app.use('/api/notifications', notificationsRouter);
app.use(passwordResetRouter);
if (typeof usuariosRouter.handleAvatarRequest === 'function') {
  app.get('/users/:id/avatar', usuariosRouter.handleAvatarRequest);
}
app.use('/pdf', express.static(path.join(__dirname, '../src/pdf')));
app.use('/styles', express.static(path.join(__dirname, '../src/styles')));
app.use('/js', express.static(path.join(__dirname, '../src/js')));

app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

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
