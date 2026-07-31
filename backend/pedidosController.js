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
// A permissão depende do destino: Enviado -> despachar, Entregue -> entregue,
// qualquer outro -> confirmar.
function permissaoDeStatus(req) {
  const destino = String(req.body?.status || '').trim().toLowerCase();
  // O CANCELAMENTO tambem chega por aqui (o modal envia status: 'Cancelado').
  // Sem esta linha, quem tinha apenas "confirmar pedido" conseguiria cancelar e
  // disparar a realocacao de estoque.
  if (destino === 'cancelado') return 'ped.cancel';
  if (destino === 'enviado') return 'ped.status.ship';
  if (destino === 'entregue') return 'ped.status.deliver';
  return 'ped.status.confirm';
}

/**
 * Cada status tem a SUA coluna de data. O cancelamento estava de fora: o pedido
 * virava "Cancelado" e `data_cancelamento` continuava nula, então o balão que
 * aparece ao passar o mouse sobre o status só sabia dizer quando a produção
 * tinha começado — nunca quando o pedido foi cancelado.
 */
function payloadDeStatus(status, agora = new Date()) {
  const payload = { situacao: status };
  const quando = agora.toISOString();
  if (status === 'Enviado') {
    payload.data_envio = quando;
  } else if (status === 'Entregue') {
    payload.data_entrega = quando;
  } else if (status === 'Cancelado') {
    payload.data_cancelamento = quando;
  }
  return payload;
}

router.put('/:id/status', exigirPermissao(permissaoDeStatus), async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const payload = payloadDeStatus(status);
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
    pedido.itens = itens || [];
    pedido.parcelas_detalhes = parcelas || [];
    res.json(pedido);
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar pedido' });
  }
});
/**
 * DELETE /pedidos/:id  — exclusão restrita (ação visível só ao Sup Admin).
 * Remove itens e parcelas antes do pedido, para não deixar órfãos.
 */
router.delete('/:id', exigirPermissao('ped.delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    const [itens, parcelas] = await Promise.all([
      api.get('/api/pedidos_itens', { query: { pedido_id: id } }).catch(() => []),
      api.get('/api/pedido_parcelas', { query: { pedido_id: id } }).catch(() => [])
    ]);
    for (const item of Array.isArray(itens) ? itens : []) {
      if (item?.id) await api.delete(`/api/pedidos_itens/${item.id}`).catch(() => {});
    }
    for (const parc of Array.isArray(parcelas) ? parcelas : []) {
      if (parc?.id) await api.delete(`/api/pedido_parcelas/${parc.id}`).catch(() => {});
    }

    await api.delete(`/api/pedidos/${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir pedido:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir pedido' });
  }
});

module.exports = router;
// Exposto para teste: a regra "cada status grava a sua data" precisa de guarda
// própria, sem depender de subir banco.
module.exports.payloadDeStatus = payloadDeStatus;
