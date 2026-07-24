const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

// Descobre a maior sequência numérica já usada em "numero" (ORC1, ORC2, ...).
// Precisa varrer TODOS os registros: usar apenas o último por id.desc gera
// colisões quando os números não são monotônicos com o id (ex.: ORC2 criado
// depois de ORC3), violando a constraint única "orcamentos_numero_key".
async function getMaxSequencia(api) {
  const lista = await api
    .get('/api/orcamentos', { query: { order: 'id.desc', limit: 5000 } })
    .catch(() => []);
  let maxSeq = 0;
  if (Array.isArray(lista)) {
    for (const orc of lista) {
      const n = parseInt(String(orc?.numero ?? '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

// Detecta a violação de chave única do campo "numero" vinda da API upstream.
function isDuplicateNumeroError(err) {
  const partes = [
    err?.body?.detalhe,
    err?.body?.detail,
    err?.body?.message,
    err?.body?.error,
    err?.message
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return partes.includes('orcamentos_numero_key') || partes.includes('duplicate key');
}

// Cria o orçamento gerando o próximo "numero" livre. Em caso de colisão
// (concorrência ou lacunas na sequência), incrementa e tenta novamente.
async function criarOrcamentoComNumero(api, body) {
  let sequencia = (await getMaxSequencia(api)) + 1;
  const maxTentativas = 20;

  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    const numero = `ORC${sequencia}`;
    try {
      const created = await api.post('/api/orcamentos', buildOrcamentoPayload(body, { numero }));
      return { created, numero };
    } catch (err) {
      if (isDuplicateNumeroError(err) && tentativa < maxTentativas - 1) {
        sequencia += 1;
        continue;
      }
      throw err;
    }
  }

  const error = new Error('Não foi possível gerar um número único para o orçamento.');
  error.status = 409;
  throw error;
}

function buildOrcamentoPayload(body = {}, { numero, situacao, dataAprovacao } = {}) {
  return {
    numero,
    cliente_id: body.cliente_id,
    contato_id: body.contato_id,
    data_emissao: body.data_emissao || new Date().toISOString(),
    situacao: situacao || body.situacao,
    parcelas: body.parcelas,
    tipo_parcela: body.tipo_parcela,
    forma_pagamento: body.forma_pagamento,
    transportadora: body.transportadora,
    desconto_pagamento: body.desconto_pagamento,
    desconto_especial: body.desconto_especial,
    desconto_total: body.desconto_total,
    valor_final: body.valor_final,
    observacoes: body.observacoes,
    validade: body.validade,
    prazo: body.prazo,
    dono: body.dono,
    data_aprovacao: dataAprovacao
  };
}

router.get('/', async (req, res) => {
  const { clienteId } = req.query;
  try {
    const api = createApiClient(req);
    const orcamentos = await api.get('/api/orcamentos', {
      query: clienteId ? { cliente_id: clienteId, order: 'id.desc' } : { order: 'id.desc' }
    });
    res.json(Array.isArray(orcamentos) ? orcamentos : []);
  } catch (err) {
    console.error('Erro ao listar orçamentos:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar orçamentos' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const orcamento = await api.get(`/api/orcamentos/${id}`);
    if (!orcamento || orcamento.error === 'Not found') {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
      api
        .get('/api/orcamento_parcelas', { query: { orcamento_id: id, order: 'numero_parcela' } })
        .catch(() => [])
    ]);
    res.json({
      ...orcamento,
      itens: Array.isArray(itens) ? itens : [],
      parcelas_detalhes: Array.isArray(parcelas) ? parcelas : []
    });
  } catch (err) {
    console.error('Erro ao buscar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao buscar orçamento' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const parcelasDetalhes = Array.isArray(body.parcelas_detalhes) ? body.parcelas_detalhes : [];

  try {
    const api = createApiClient(req);
    const { created, numero } = await criarOrcamentoComNumero(api, body);
    const orcamentoId = created?.id || created?.data?.id || created?.[0]?.id;

    for (const item of itens) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: orcamentoId });
    }

    for (let i = 0; i < parcelasDetalhes.length; i++) {
      const parcela = parcelasDetalhes[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: orcamentoId,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    res.json({ success: true, id: orcamentoId, numero });
  } catch (err) {
    console.error('Erro ao salvar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao salvar orçamento' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const itens = Array.isArray(body.itens) ? body.itens : [];
  const parcelasDetalhes = Array.isArray(body.parcelas_detalhes) ? body.parcelas_detalhes : [];

  try {
    const api = createApiClient(req);
    const situacoesComData = ['Aprovado', 'Rejeitado', 'Expirado'];
    const dataAprovacaoValor = situacoesComData.includes(body.situacao)
      ? new Date().toISOString()
      : null;

    await api.put(`/api/orcamentos/${id}`, buildOrcamentoPayload(body, {
      situacao: body.situacao,
      dataAprovacao: dataAprovacaoValor
    }));

    const itensExistentes = await api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []);
    if (Array.isArray(itensExistentes)) {
      for (const item of itensExistentes) {
        if (item?.id) {
          await api.delete(`/api/orcamentos_itens/${item.id}`);
        }
      }
    }
    for (const item of itens) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: id });
    }

    const parcelasExistentes = await api
      .get('/api/orcamento_parcelas', { query: { orcamento_id: id } })
      .catch(() => []);
    if (Array.isArray(parcelasExistentes)) {
      for (const parcela of parcelasExistentes) {
        if (parcela?.id) {
          await api.delete(`/api/orcamento_parcelas/${parcela.id}`);
        }
      }
    }

    for (let i = 0; i < parcelasDetalhes.length; i++) {
      const parcela = parcelasDetalhes[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: id,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    if (body.situacao === 'Aprovado') {
      try {
        await api.post(`/api/orcamentos/${id}/convert`);
      } catch (_) {}
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar orçamento' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { situacao } = req.body;
  try {
    const api = createApiClient(req);
    const situacoesComData = ['Aprovado', 'Rejeitado', 'Expirado'];
    const payload = {
      situacao,
      data_aprovacao: situacoesComData.includes(situacao) ? new Date().toISOString() : null
    };
    await api.put(`/api/orcamentos/${id}`, payload);
    if (situacao === 'Aprovado') {
      try {
        await api.post(`/api/orcamentos/${id}/convert`);
      } catch (_) {}
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao atualizar status do orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do orçamento' });
  }
});

router.post('/:id/clone', async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);
    const orcamento = await api.get(`/api/orcamentos/${id}`);
    if (!orcamento || orcamento.error === 'Not found') {
      return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    const [itens, parcelas] = await Promise.all([
      api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
      api.get('/api/orcamento_parcelas', { query: { orcamento_id: id } }).catch(() => [])
    ]);

    const { created, numero } = await criarOrcamentoComNumero(api, {
      ...orcamento,
      situacao: 'Rascunho',
      data_aprovacao: null
    });
    const novoId = created?.id || created?.data?.id || created?.[0]?.id;

    for (const item of Array.isArray(itens) ? itens : []) {
      await api.post('/api/orcamentos_itens', { ...item, orcamento_id: novoId, id: undefined });
    }
    for (let i = 0; i < (Array.isArray(parcelas) ? parcelas.length : 0); i++) {
      const parcela = parcelas[i];
      await api.post('/api/orcamento_parcelas', {
        ...parcela,
        orcamento_id: novoId,
        id: undefined,
        numero_parcela: parcela.numero_parcela || i + 1
      });
    }

    res.json({ success: true, id: novoId, numero });
  } catch (err) {
    console.error('Erro ao clonar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao clonar orçamento' });
  }
});

module.exports = router;
