const express = require('express');
const pool = require('./db');

const router = express.Router();

// GET /api/usuarios/lista
router.get('/lista', async (req, res) => {
  try {
    const { busca = '', perfil = '', status = '' } = req.query;

    const filtros = [];
    const valores = [];

    if (busca) {
      valores.push(`%${busca.toLowerCase()}%`);
      filtros.push(`(lower(nome) LIKE $${valores.length} OR lower(email) LIKE $${valores.length})`);
    }

    if (perfil) {
      valores.push(perfil);
      filtros.push(`perfil = $${valores.length}`);
    }

    if (status) {
      const statuses = Array.isArray(status) ? status : status.split(',');
      const condicoesStatus = [];
      statuses.forEach(s => {
        if (s === 'ativo') condicoesStatus.push('verificado = true');
        else if (s === 'inativo') condicoesStatus.push('verificado = false');
        else if (s === 'aguardando') condicoesStatus.push('verificado IS NULL');
      });
      if (condicoesStatus.length) filtros.push(`(${condicoesStatus.join(' OR ')})`);
    }

    let query = 'SELECT id, nome, email, perfil, verificado FROM usuarios';
    if (filtros.length) query += ' WHERE ' + filtros.join(' AND ');
    query += ' ORDER BY nome';

    const result = await pool.query(query, valores);
    const usuarios = result.rows.map(u => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      perfil: u.perfil,
      status:
        u.verificado === true
          ? 'Ativo'
          : u.verificado === false
          ? 'Inativo'
          : 'Aguardando'
    }));
    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

module.exports = router;
