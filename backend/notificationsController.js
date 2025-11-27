const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const api = createApiClient(req);
    const items = await api.get('/api/notifications');
    res.json(Array.isArray(items) ? items : []);
  } catch (err) {
    console.error('Erro ao obter notificações:', err);
    res.status(err.status || 500).json({ error: 'Erro ao obter notificações' });
  }
});

module.exports = router;
