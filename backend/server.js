// carrega variáveis do .env sem mensagens informativas
require('dotenv').config({ quiet: true });

// importa libs só uma vez
const express               = require('express');
const cors                  = require('cors');
const path                  = require('path');
const clientesRouter        = require('./clientesController');
const passwordResetRouter   = require('./passwordResetRoutes');
const usuariosRouter        = require('./usuariosController');
const transportadorasRouter = require('./transportadorasController');
const orcamentosRouter      = require('./orcamentosController');
const pedidosRouter         = require('./pedidosController');
const notificationsRouter   = require('./notificationsController');
const db                    = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

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

// Endpoint simples para verificar a disponibilidade do servidor
app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/healthz', (_req, res) => {
  const status = db.getStatus();
  if (!status.ready) {
    db.ensureWarmup();
  }

  const dbStatus = status.ready ? 'ready' : status.connecting ? 'connecting' : 'error';
  const payload = {
    internet: true,
    db_ok: status.ready,
    db_ready: status.ready,
    db_status: dbStatus,
    connecting: status.connecting,
    next_retry_in_ms: status.retryInMs,
    last_success_at: status.lastSuccessAt || null,
    last_failure_at: status.lastFailureAt || null,
    consecutive_failures: status.consecutiveFailures
  };

  if (status.lastError) {
    payload.last_error = status.lastError;
  }

  res.status(200).json(payload);
});

app.get('/healthz/db', (_req, res) => {
  const status = db.getStatus();
  if (!status.ready) {
    db.ensureWarmup();
  }

  const dbStatus = status.ready ? 'ready' : status.connecting ? 'connecting' : 'error';
  const payload = {
    internet: true,
    db_ok: status.ready,
    db_ready: status.ready,
    db_status: dbStatus,
    connecting: status.connecting,
    next_retry_in_ms: status.retryInMs
  };

  if (status.lastError) {
    payload.last_error = status.lastError;
  }

  res.status(200).json(payload);
});

app.get('/reset-password', (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/login/reset-password.html'));
});
app.get('/resetPasswordRenderer.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/login/resetPasswordRenderer.js'));
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
// Changelog:
// - 2024-05-17: adicionadas rotas /healthz e /healthz/db para monitoramento e reaproveitamento leve do servidor.
// - 2024-06-09: adicionado aquecimento inicial do pool com SELECT 1 para reduzir falso offline-db.
// - 2024-07-XX: atualizado /healthz para relatar estado do banco e manter resposta 200.
