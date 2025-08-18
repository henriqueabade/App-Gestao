const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/usuarios/lista
router.get('/lista', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nome, email, verificado, perfil FROM usuarios ORDER BY nome'
    );
    const usuarios = result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      status: u.verificado ? 'Ativo' : 'Inativo'
    }));
    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// GET /api/usuarios/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT perfil FROM usuarios WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    res.json({ perfil: result.rows[0].perfil });
  } catch (err) {
    console.error('Erro ao obter perfil do usuário:', err);
    res.status(500).json({ error: 'Erro ao obter perfil do usuário' });
  }
});

module.exports = router;
