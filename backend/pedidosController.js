const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

// Lista pedidos com filtro opcional por cliente
router.get('/', async (req, res) => {
  const { clienteId } = req.query;
  try {
    const api = createApiClient(req);
    const pedidos = await api.get('/api/pedidos', {
      query: {
        ...(clienteId ? { cliente_id: `eq.${clienteId}` } : {}),
        order: 'id.desc'
      }
    });

    res.json(Array.isArray(pedidos) ? pedidos : []);
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar pedidos' });
  }
});

// Atualiza o status de um pedido
router.put('/:id/status', async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const payload = { situacao: status };
    if (status === 'Enviado') {
      payload.data_envio = new Date().toISOString();
    } else if (status === 'Entregue') {
      payload.data_entrega = new Date().toISOString();
    }
    await api.put(`/api/pedidos/${id}`, payload);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar status do pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do pedido' });
  }
}); // <--- Faltava este '});' para fechar a rota e a função async

// Obtém um pedido específico com itens e parcelas
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const pedido = await api.get(`/api/pedidos/${id}`);
    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/pedidos_itens', { query: { pedido_id: `eq.${id}` } }),
      api.get('/api/pedido_parcelas', { query: { pedido_id: `eq.${id}`, order: 'numero_parcela' } })
    ]);
    pedido.itens = itens || [];
    pedido.parcelas_detalhes = parcelas || [];
    res.json(pedido);
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar pedido' });
  }
});
module.exports = router;
