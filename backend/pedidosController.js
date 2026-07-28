const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');

const router = express.Router();

// Lista pedidos com filtro opcional por cliente
router.get('/', exigirPermissao('ped.view'), async (req, res) => {
  const { clienteId } = req.query;
  try {
    const api = createApiClient(req);
    const pedidos = await api.get('/api/pedidos', {
      query: clienteId ? { cliente_id: clienteId, order: 'id.desc' } : { order: 'id.desc' }
    });

    res.json(Array.isArray(pedidos) ? pedidos : []);
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar pedidos' });
  }
});

// Atualiza o status de um pedido
router.put('/:id/status', exigirPermissao('ped.status.confirm'), async (req, res) => {
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
router.get('/:id', exigirPermissao('ped.view.details'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const pedido = await api.get(`/api/pedidos/${id}`);
    if (!pedido || pedido.error === 'Not found') {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }),
      api.get('/api/pedido_parcelas', { query: { pedido_id: id, order: 'numero_parcela' } })
    ]);
    const itensPedido = Array.isArray(itens) ? itens : [];
    const produtoIds = [...new Set(itensPedido.map(item => Number(item.produto_id)).filter(Number.isFinite))];
    let insumosPorProduto = new Map();

    if (produtoIds.length) {
      try {
        const vinculos = await api.get('/api/produtos_insumos', {
          query: { produto_id: `in.(${produtoIds.join(',')})`, order: 'ordem_insumo' }
        });
        const insumoIds = [...new Set((vinculos || []).map(item => Number(item.insumo_id)).filter(Number.isFinite))];
        const materias = insumoIds.length
          ? await api.get('/api/materia_prima', { query: { id: `in.(${insumoIds.join(',')})` } })
          : [];
        const materiaPorId = new Map((materias || []).map(materia => [Number(materia.id), materia]));

        insumosPorProduto = (vinculos || []).reduce((map, vinculo) => {
          const materia = materiaPorId.get(Number(vinculo.insumo_id)) || {};
          const produtoId = Number(vinculo.produto_id);
          const lista = map.get(produtoId) || [];
          lista.push({
            id: vinculo.id,
            insumo_id: vinculo.insumo_id,
            nome: materia.nome || 'Insumo não identificado',
            processo: materia.processo || 'Sem processo',
            unidade: materia.unidade || '',
            quantidade: Number(vinculo.quantidade || 0),
            preco_unitario: Number(materia.preco_unitario || 0),
            ordem: Number(vinculo.ordem_insumo || 0)
          });
          map.set(produtoId, lista);
          return map;
        }, new Map());
      } catch (insumosErr) {
        // O pedido continua disponível mesmo se dados produtivos antigos estiverem incompletos.
        console.warn('Não foi possível carregar os insumos dos produtos do pedido:', insumosErr.message);
      }
    }

    pedido.itens = itensPedido.map(item => ({
      ...item,
      insumos: insumosPorProduto.get(Number(item.produto_id)) || []
    }));
    pedido.parcelas_detalhes = parcelas || [];
    res.json(pedido);
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar pedido' });
  }
});
module.exports = router;
