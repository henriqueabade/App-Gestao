const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

// GET /api/transportadoras/:clienteId
router.get('/:clienteId', async (req, res) => {
  const { clienteId } = req.params;
  try {
    const api = createApiClient(req);
    const result = await api.get('/api/transportadoras', {
      query: { id_cliente: clienteId, order: 'transportadora' }
    });
    res.json(Array.isArray(result) ? result.map((row) => ({ id: row.id, nome: row.transportadora })) : []);
  } catch (err) {
    console.error('Erro ao listar transportadoras:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar transportadoras' });
  }
});

module.exports = router;
