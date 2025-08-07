const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/usuarios/lista
router.get('/lista', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, verificado FROM usuarios ORDER BY nome'
    );
    const usuarios = result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      status: u.verificado ? 'Ativo' : 'Inativo'
    }));
    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

module.exports = router;
