const express = require('express');
const db = require('./db');

const router = express.Router();

// Lista todos os pedidos
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.numero, c.nome_fantasia AS cliente, to_char(p.data_emissao,'DD/MM/YYYY') AS data_emissao,
              p.valor_final, p.parcelas, p.situacao, p.dono,
              to_char(p.data_aprovacao,'DD/MM/YYYY') AS data_aprovacao,
              to_char(p.data_envio,'DD/MM/YYYY') AS data_envio,
              to_char(p.data_entrega,'DD/MM/YYYY') AS data_entrega,
              to_char(p.data_cancelamento,'DD/MM/YYYY') AS data_cancelamento
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
    const baseQuery = 'UPDATE pedidos SET situacao = $1';
    let query = baseQuery;
    if (status === 'Enviado') {
      query += ', data_envio = NOW()';
    } else if (status === 'Entregue') {
      query += ', data_entrega = NOW()';
    }
    query += ' WHERE id = $2';
    await db.query(query, [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar status do pedido:', err);
    res.status(500).json({ error: 'Erro ao atualizar status do pedido' });
  }
}); // <--- Faltava este '});' para fechar a rota e a função async

// Obtém um pedido específico com itens e parcelas
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  try {
    const { rows } = await client.query('SELECT * FROM pedidos WHERE id=$1', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const pedido = rows[0];
    const { rows: itens } = await client.query(
      'SELECT * FROM pedidos_itens WHERE pedido_id=$1',
      [id]
    );
    const { rows: parcelas } = await client.query(
      'SELECT * FROM pedido_parcelas WHERE pedido_id=$1 ORDER BY numero_parcela',
      [id]
    );
    pedido.itens = itens;
    pedido.parcelas_detalhes = parcelas;
    res.json(pedido);
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
    res.status(500).json({ error: 'Erro ao buscar pedido' });
  } finally {
    client.release();
  }
});
module.exports = router;
