const express = require('express');
const db = require('./db');

const router = express.Router();

// Lista todos os pedidos
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.numero, c.nome_fantasia AS cliente, to_char(p.data_emissao,'DD/MM/YYYY') AS data_emissao,
              p.valor_final, p.parcelas, p.situacao, p.dono
         FROM pedidos p
         LEFT JOIN clientes c ON c.id = p.cliente_id
        ORDER BY p.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(500).json({ error: 'Erro ao listar pedidos' });
  }
});

// Atualiza o status de um pedido
router.put('/:id/status', async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  try {
    await db.query('UPDATE pedidos SET situacao = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar status do pedido:', err);
    res.status(500).json({ error: 'Erro ao atualizar status do pedido' });
  }
});

module.exports = router;
