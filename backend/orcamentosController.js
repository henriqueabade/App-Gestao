const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const { aplicarConversaoNoEstoque } = require('./conversaoAplicar');

const router = express.Router();

/**
 * Id do usuário que está fazendo a requisição, lido do JWT.
 *
 * `decisao_estoque_by` existia na tabela e nunca era preenchido: a decisão de
 * usar estoque ou produzir do zero ficava sem dono. Numa ação que mexe em
 * estoque, saber QUEM decidiu não é enfeite — é o que permite auditar e
 * estornar depois.
 */
function idDoUsuarioDaRequisicao(req) {
  try {
    const bruto = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = bruto.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    const id = payload.id ?? payload.userId ?? payload.sub ?? null;
    return Number.isFinite(Number(id)) ? Number(id) : null;
  } catch (_) {
    return null;
  }
}

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

// Colisão genérica de chave (pkey/unique) para retentar com outro id.
function isDuplicateKeyError(err) {
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
  return partes.includes('duplicate key') || partes.includes('_pkey') || partes.includes('unique constraint');
}

// Maior id atual de uma tabela (as tabelas de pedido NÃO auto-geram id).
async function getMaxId(api, tabela) {
  const lista = await api
    .get(`/api/${tabela}`, { query: { order: 'id.desc', limit: 1 } })
    .catch(() => []);
  const primeiro = Array.isArray(lista) && lista.length ? lista[0] : null;
  const maxId = Number(primeiro?.id);
  return Number.isFinite(maxId) ? maxId : 0;
}

// Insere uma linha com id explícito, retentando com o próximo id em caso de
// colisão de chave primária. Retorna o id efetivamente usado.
async function inserirLinhaComId(api, tabela, payload, idInicial) {
  let id = idInicial;
  const maxTentativas = 50;
  for (let tentativa = 0; tentativa < maxTentativas; tentativa++) {
    try {
      await api.post(`/api/${tabela}`, { ...payload, id });
      return id;
    } catch (err) {
      if (isDuplicateKeyError(err) && tentativa < maxTentativas - 1) {
        id += 1;
        continue;
      }
      throw err;
    }
  }
  return id;
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

  // pedidos_itens.id e pedido_parcelas.id também são NOT NULL sem auto-incremento:
  // geramos ids sequenciais a partir do maior id existente, com retentativa.
  let proximoItemId = (await getMaxId(api, 'pedidos_itens')) + 1;
  // Guardamos o id de cada peça criada: sem ele não há como dizer "falta X para
  // a peça Y" nem de qual lote a peça pronta saiu.
  const pecasCriadas = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const decisao = decisaoPorProduto.get(Number(item?.produto_id)) || {};
    const payloadItem = buildPedidoItemPayload(item, pedidoId, decisao);
    const usado = await inserirLinhaComId(api, 'pedidos_itens', payloadItem, proximoItemId);
    pecasCriadas.push({
      pedido_item_id: usado,
      produto_id: item?.produto_id,
      quantidade: payloadItem.quantidade,
      qtd_usar_pronta: payloadItem.qtd_usar_pronta,
      qtd_a_produzir: payloadItem.qtd_a_produzir,
      // `parciais` NÃO vira coluna de pedidos_itens (a tabela não tem esse
      // campo): ela só atravessa até o abatimento, para o estoque saber quais
      // lotes pela metade foram comprometidos com este pedido.
      parciais: Array.isArray(decisao?.parciais) ? decisao.parciais : []
    });
    proximoItemId = usado + 1;
  }

  const listaParcelas = Array.isArray(parcelas) ? parcelas : [];
  let proximoParcelaId = (await getMaxId(api, 'pedido_parcelas')) + 1;
  for (let i = 0; i < listaParcelas.length; i++) {
    const { id: _pId, orcamento_id: _pOid, ...rest } = listaParcelas[i] || {};
    const usado = await inserirLinhaComId(
      api,
      'pedido_parcelas',
      { ...rest, pedido_id: pedidoId, numero_parcela: rest.numero_parcela || i + 1 },
      proximoParcelaId
    );
    proximoParcelaId = usado + 1;
  }

  // ------------------------------------------------------------------
  // Estoque: registra o que faltava e abate o que foi decidido.
  //
  // Depois das parcelas, e sem poder derrubar a conversão: o pedido já existe
  // neste ponto. Um erro aqui volta como aviso para a interface mostrar, em vez
  // de fazer o usuário achar que a conversão inteira falhou.
  // ------------------------------------------------------------------
  let estoque = null;
  try {
    estoque = await aplicarConversaoNoEstoque(api, {
      pedidoId,
      itens: pecasCriadas,
      usuarioId: conversao && Number.isFinite(Number(conversao.decisaoBy))
        ? Number(conversao.decisaoBy)
        : null,
      inserirLinhaComId,
      getMaxId
    });
  } catch (err) {
    console.error('Falha ao aplicar a decisão de estoque da conversão:', err);
    estoque = { avisos: [`Falha ao aplicar a decisão de estoque: ${err?.message || err}`] };
  }

  return { pedido: { id: pedidoId, numero }, jaExistia: false, estoque };
}

router.get('/', exigirPermissao('orc.view'), async (req, res) => {
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

router.get('/:id', exigirPermissao('orc.view.details'), async (req, res) => {
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

router.post('/', exigirPermissao('orc.create'), async (req, res) => {
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

// Estas duas rotas fazem MAIS do que o nome sugere: quando a situacao vira
// "Aprovado", elas tambem convertem o orcamento em pedido (e o pedido abate
// estoque). Guardar so com `orc.edit` ou so com `orc.convert` deixava dois
// furos: quem podia editar disparava a conversao sem ter permissao para isso, e
// quem tinha `orc.convert` mudava qualquer status (Rejeitado, Expirado) sem ter
// `orc.status.change`. Agora cada rota pede exatamente o que vai executar.
function permissoesDeStatus(req) {
  const chaves = ['orc.status.change'];
  if (String(req.body?.situacao || '').trim() === 'Aprovado') chaves.push('orc.convert');
  return chaves;
}

function permissoesDeEdicao(req) {
  const chaves = ['orc.edit'];
  if (String(req.body?.situacao || '').trim() === 'Aprovado') chaves.push('orc.convert');
  return chaves;
}

router.put('/:id', exigirPermissao(permissoesDeEdicao), async (req, res) => {
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
    let estoqueResumo = null;
    if (body.situacao === 'Aprovado') {
      try {
        const resultado = await converterOrcamentoEmPedido(api, id, {
          ...(body.conversao || {}),
          decisaoBy: idDoUsuarioDaRequisicao(req)
        });
        pedido = resultado.pedido;
        estoqueResumo = resultado.estoque || null;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }

    res.json({ success: true, convertido, convertErro, pedido, estoque: estoqueResumo });
  } catch (err) {
    console.error('Erro ao atualizar orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar orçamento' });
  }
});

router.patch('/:id/status', exigirPermissao(permissoesDeStatus), async (req, res) => {
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
    let estoqueResumo = null;
    if (situacao === 'Aprovado') {
      try {
        // A conversão em lote (botão "Converter Orçamento", em Pedidos) chega
        // por aqui. Ela não passa pela revisão peça a peça, então a decisão de
        // estoque vem no corpo quando existir; o dono da decisão é sempre
        // registrado, para que o pedido saiba QUEM converteu.
        const resultado = await converterOrcamentoEmPedido(api, id, {
          ...(req.body?.conversao || {}),
          decisaoBy: idDoUsuarioDaRequisicao(req)
        });
        pedido = resultado.pedido;
        estoqueResumo = resultado.estoque || null;
        convertido = true;
      } catch (convErr) {
        convertErro = convErr?.body?.detalhe || convErr?.body?.error || convErr?.message || 'Falha ao converter em pedido';
        console.error('Erro ao converter orçamento em pedido:', convErr);
      }
    }
    res.json({ success: true, convertido, convertErro, pedido, estoque: estoqueResumo });
  } catch (err) {
    console.error('Erro ao atualizar status do orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao atualizar status do orçamento' });
  }
});

router.post('/:id/clone', exigirPermissao(['orc.clone', 'orc.create']), async (req, res) => {
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

/**
 * DELETE /orcamentos/:id  — exclusão restrita (ação visível só ao Sup Admin).
 * Remove itens e parcelas antes do orçamento, para não deixar órfãos.
 */
router.delete('/:id', exigirPermissao('orc.delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const api = createApiClient(req);

    const [itens, parcelas] = await Promise.all([
      api.get('/api/orcamentos_itens', { query: { orcamento_id: id } }).catch(() => []),
      api.get('/api/orcamento_parcelas', { query: { orcamento_id: id } }).catch(() => [])
    ]);
    for (const item of Array.isArray(itens) ? itens : []) {
      if (item?.id) await api.delete(`/api/orcamentos_itens/${item.id}`).catch(() => {});
    }
    for (const parc of Array.isArray(parcelas) ? parcelas : []) {
      if (parc?.id) await api.delete(`/api/orcamento_parcelas/${parc.id}`).catch(() => {});
    }

    await api.delete(`/api/orcamentos/${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao excluir orçamento:', err);
    res.status(err.status || 500).json({ error: 'Erro ao excluir orçamento' });
  }
});

module.exports = router;
