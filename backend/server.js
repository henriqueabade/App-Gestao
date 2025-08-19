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

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/clientes', clientesRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/transportadoras', transportadorasRouter);
app.use('/api/orcamentos', orcamentosRouter);
app.use(passwordResetRouter);
app.use('/pdf', express.static(path.join(__dirname, '../src/pdf')));

// Endpoint simples para verificar a disponibilidade do servidor
app.get('/status', (_req, res) => {
  res.json({ status: 'ok' });
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
  app.listen(PORT, () => {
    if (DEBUG) console.log(`API server running on port ${PORT}`);
  });
}

module.exports = app;
