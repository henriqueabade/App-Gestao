const express = require('express');
const pool = require('./db');

const router = express.Router();

// Obter detalhes de um contato
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, id_cliente, nome, cargo, telefone_fixo, telefone_celular, email FROM contatos_cliente WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contato não encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao buscar contato:', err);
    res.status(500).json({ error: 'Erro ao buscar contato' });
  }
});

// Atualizar um contato existente
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, cargo, telefone_fixo, telefone_celular, email } = req.body;
  try {
    await pool.query(
      'UPDATE contatos_cliente SET nome = $1, cargo = $2, telefone_fixo = $3, telefone_celular = $4, email = $5 WHERE id = $6',
      [nome, cargo, telefone_fixo, telefone_celular, email, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar contato:', err);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

module.exports = router;
