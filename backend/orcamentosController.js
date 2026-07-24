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

// ---------------------------------------------------------------------------
// Conversão de orçamento em pedido.
//
// A API upstream NÃO possui o endpoint /api/orcamentos/:id/convert (retorna
// 404). A conversão é feita aqui: cria-se um registro em "pedidos" (ligado ao
// orçamento por "orcamento_id") espelhando os dados e copiam-se itens/parcelas.
// ---------------------------------------------------------------------------

// Maior sequência numérica já usada em pedidos (PED1, PED2, ...).
async function getMaxSequenciaPedido(api) {
  const lista = await api
    .get('/api/pedidos', { query: { order: 'id.desc', limit: 5000 } })
    .catch(() => []);
  let maxSeq = 0;
  if (Array.isArray(lista)) {
    for (const ped of lista) {
      const n = parseInt(String(ped?.numero ?? '').replace(/\D/g, ''), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return maxSeq;
}

function isDuplicatePedidoNumeroError(err) {
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
  return partes.includes('pedidos_numero_key') || partes.includes('duplicate key');
}

// Monta o payload do pedido espelhando os campos do orçamento. Só são incluídos
// campos que sabidamente existem na tabela "pedidos" (lidos na visualização/PDF
// do pedido), evitando erro de INSERT por coluna inexistente.
function buildPedidoPayload(orc = {}, { numero, conversao } = {}) {
  const agora = new Date().toISOString();
  const hoje = agora.slice(0, 10); // colunas do tipo "date"
  const note = conversao && typeof conversao.decisaoNote === 'string' ? conversao.decisaoNote.trim() : '';
  const decisaoBy = conversao && Number.isFinite(Number(conversao.decisaoBy)) ? Number(conversao.decisaoBy) : null;
  return {
    // pedidos.id NÃO é auto-incrementado (NOT NULL, sem default); o pedido
    // compartilha o mesmo id do orçamento de origem (relação 1:1).
    id: orc.id,
    numero,
    orcamento_id: orc.id,
    cliente_id: orc.cliente_id,
    contato_id: orc.contato_id,
    data_emissao: agora,
    data_aprovacao: hoje,
    situacao: 'Produção',
    parcelas: orc.parcelas,
    tipo_parcela: orc.tipo_parcela,
    forma_pagamento: orc.forma_pagamento,
    transportadora: orc.transportadora,
    desconto_pagamento: orc.desconto_pagamento,
    desconto_especial: orc.desconto_especial,
    desconto_total: orc.desconto_total,
    valor_final: orc.valor_final,
    observacoes: orc.observacoes,
    validade: orc.validade,
    prazo: orc.prazo,
    dono: orc.dono,
    // pode_saldo_negativo é NOT NULL; a justificativa vai na coluna correta
    // (decisao_estoque_note), e não em "observacoes".
    pode_saldo_negativo: !!(conversao && conversao.podeSaldoNegativo),
    decisao_estoque_note: note || null,
    decisao_estoque_by: decisaoBy
  };
}

// Monta o item do pedido apenas com colunas existentes em "pedidos_itens".
// qtd_a_produzir e qtd_usar_pronta são NOT NULL: usam a decisão de estoque
// vinda do modal de conversão (por produto_id) ou um padrão seguro.
function buildPedidoItemPayload(item = {}, pedidoId, decisao = {}) {
  const quantidade = Number(item.quantidade || 0);
  const usarPronta = Number.isFinite(Number(decisao.qtd_usar_pronta)) ? Number(decisao.qtd_usar_pronta) : 0;
  const aProduzir = Number.isFinite(Number(decisao.qtd_a_produzir))
    ? Number(decisao.qtd_a_produzir)
    : Math.max(0, quantidade - usarPronta);
  return {
    pedido_id: pedidoId,
    produto_id: item.produto_id,
    codigo: item.codigo,
    nome: item.nome,
    ncm: item.ncm,
    quantidade: item.quantidade,
    valor_unitario: item.valor_unitario,
    desconto_total: item.desconto_total,
    valor_total: item.valor_total,
    valor_unitario_desc: item.valor_unitario_desc,
    valor_desc: item.valor_desc,
    desconto_pagamento: item.desconto_pagamento,
    desconto_especial: item.desconto_especial,
    desconto_pagamento_prc: item.desconto_pagamento_prc,
    desconto_especial_prc: item.desconto_especial_prc,
    qtd_a_produzir: aProduzir,
    qtd_usar_pronta: usarPronta
  };
}

// Cria o pedido a partir do orçamento. Idempotente: se já houver pedido para
// o orçamento, retorna o existente em vez de duplicar. `conversao` carrega a
// decisão de estoque (nota e quantidades por produto) vinda do modal.
async function converterOrcamentoEmPedido(api, id, conversao = null) {
  const existentes = await api
    .get('/api/pedidos', { query: { orcamento_id: id } })
    .catch(() => []);
  // Confirma explicitamente o vínculo por orcamento_id — caso o filtro upstream
  // seja ignorado, evita tratar erroneamente qualquer pedido como já existente.
  const jaExiste = Array.isArray(existentes)
    ? existentes.find(ped => String(ped?.orcamento_id) === String(id))
    : null;
  if (jaExiste) {
    return { pedido: jaExiste, jaExistia: true };
  }

  const orcamento = await api.get(`/api/orcamentos/${id}`);
  if (!orcamento || orcamento.error === 'Not found') {
    const error = new Error('Orçamento não encontrado para conversão.');
    error.status = 404;
    throw error;
  }

  const [itens, parcelas] = await Promise.all([
    api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
    api.get('/api/orcamento_parcelas', { query: { orcamento_id: id, order: 'numero_parcela' } }).catch(() => [])
  ]);

  // Índice das decisões de estoque por produto_id (vindas do modal).
  const decisaoPorProduto = new Map();
  if (conversao && Array.isArray(conversao.itens)) {
    for (const it of conversao.itens) {
      const pid = Number(it?.produto_id);
      if (Number.isFinite(pid)) decisaoPorProduto.set(pid, it);
    }
  }

  // Cria o pedido com número livre, retentando em caso de colisão de "numero".
  let sequencia = (await getMaxSequenciaPedido(api)) + 1;
  const maxTentativas = 20;
  let created = null;
  let numero = null;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    numero = `PED${sequencia}`;
    try {
      created = await api.post('/api/pedidos', buildPedidoPayload(orcamento, { numero, conversao }));
      break;
    } catch (err) {
      if (isDuplicatePedidoNumeroError(err) && tentativa < maxTentativas - 1) {
        sequencia += 1;
        continue;
      }
      throw err;
    }
  }
  const pedidoId = created?.id || created?.data?.id || created?.[0]?.id || orcamento.id;

  for (const item of Array.isArray(itens) ? itens : []) {
    const decisao = decisaoPorProduto.get(Number(item?.produto_id)) || {};
    await api.post('/api/pedidos_itens', buildPedidoItemPayload(item, pedidoId, decisao));
  }

  const listaParcelas = Array.isArray(parcelas) ? parcelas : [];
  for (let i = 0; i < listaParcelas.length; i++) {
    const { id: _pId, orcamento_id: _pOid, ...rest } = listaParcelas[i] || {};
    await api.post('/api/pedido_parcelas', {
      ...rest,
      pedido_id: pedidoId,
      numero_parcela: rest.numero_parcela || i + 1
    });
  }

  return { pedido: { id: pedidoId, numero }, jaExistia: false };
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

    let convertido = false;
    let convertErro = null;
    let pedido = null;
    if (body.situacao === 'Aprovado') {
      try {
        const resultado = await converterOrcamentoEmPedido(api, id, body.conversao);
        pedido = resultado.pedido;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }

    res.json({ success: true, convertido, convertErro, pedido });
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
    let convertido = false;
    let convertErro = null;
    let pedido = null;
    if (situacao === 'Aprovado') {
      try {
        const resultado = await converterOrcamentoEmPedido(api, id);
        pedido = resultado.pedido;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }
    res.json({ success: true, convertido, convertErro, pedido });
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
