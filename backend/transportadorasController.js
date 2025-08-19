const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/transportadoras/:clienteId
router.get('/:clienteId', async (req, res) => {
  const { clienteId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, nome FROM transportadora WHERE id_cliente = $1 ORDER BY nome',
      [clienteId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar transportadoras:', err);
    res.status(500).json({ error: 'Erro ao listar transportadoras' });
  }
});

module.exports = router;
