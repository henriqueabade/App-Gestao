// carrega variáveis do .env
require('dotenv').config();

// importa libs só uma vez
const express               = require('express');
const cors                  = require('cors');
const path                  = require('path');
const clientesRouter        = require('./clientesController');
const passwordResetRouter   = require('./passwordResetRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/clientes', clientesRouter);
app.use(passwordResetRouter);

app.get('/reset-password', (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/login/reset-password.html'));
});
app.get('/resetPasswordRenderer.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/login/resetPasswordRenderer.js'));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  if (!process.env.PORT) console.warn('PORT not set, defaulting to 3000');
  app.listen(PORT, () => console.log(`API server running on port ${PORT}`));
}

module.exports = app;
