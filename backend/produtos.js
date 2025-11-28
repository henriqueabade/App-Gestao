const pool = require('./db');

async function fetchSingle(table, query) {
  const rows = await pool.get(`/${table}`, { query: { ...query, limit: 1 } });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/* Utilitário simples de log de tipos para debug */
function tipo(v) {
  const t = typeof v;
  if (v === null) return 'null';
  if (t !== 'object') return t;
  return Object.prototype.toString.call(v);
}

function normalizarCorpoErro(err) {
  if (!err) return null;
  if (typeof err?.body === 'object' && err.body !== null) {
    const corpo = { ...err.body };
    if (corpo.token) corpo.token = '[redacted]';
    return corpo;
  }
  return err?.body || null;
}

/**
 * Lista todos os produtos (resumo)
 */
const LOTES_ENDPOINT = '/produtos_em_cada_ponto';

async function executarLotes(method, pathSuffix = '', payload) {
  return pool[method](`${LOTES_ENDPOINT}${pathSuffix}`, payload);
}

async function listarProdutos() {
  try {
    const produtos = await pool.get('/produtos');
    const lotes = await carregarLotesSeguros({ select: 'produto_id,quantidade' });
    const listaProdutos = Array.isArray(produtos) ? produtos : [];
    const listaLotes = Array.isArray(lotes) ? lotes : [];

    const quantidadesPorProduto = listaLotes.reduce((acc, lote) => {
      const produtoId = lote?.produto_id;
      const atual = Number(acc.get(produtoId) || 0);
      const qtd = Number(lote?.quantidade) || 0;
      acc.set(produtoId, atual + qtd);
      return acc;
    }, new Map());

    return listaProdutos
      .map(produto => ({
        ...produto,
        quantidade_total: quantidadesPorProduto.get(produto?.id) || 0
      }))
      .sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || '')));
  } catch (err) {
    console.error('Erro ao listar produtos:', err.message);
    throw err;
  }
}

async function carregarLotesSeguros(query) {
  const dados = await pool.get(LOTES_ENDPOINT, { query });
  return Array.isArray(dados) ? dados : [];
}

async function listarDetalhesProduto(produtoCodigo, produtoId) {
  try {
    if (!produtoCodigo && !produtoId) {
      throw new Error('Produto não informado');
    }

    const produtoFiltro = produtoCodigo
      ? { codigo: `eq.${produtoCodigo}`, limit: 1 }
      : { id: produtoId, limit: 1 };

    const produtos = await pool.get('/produtos', {
      query: { select: '*', ...produtoFiltro }
    });
    const produto = Array.isArray(produtos) ? produtos[0] : null;
    produtoId = produtoId || produto?.id || null;
    produtoCodigo = produtoCodigo || produto?.codigo || null;

    const itensQuery = {
      select:
        'id,produto_codigo,insumo_id,quantidade,ordem_insumo,materia_prima:insumo_id(nome,preco_unitario,unidade,processo)',
      order: 'materia_prima.processo,ordem_insumo'
    };

    if (produtoCodigo) {
      itensQuery.produto_codigo = `eq.${produtoCodigo}`;
    }

    const itens = await pool.get('/produtos_insumos', { query: itensQuery });

    const itensFormatados = (Array.isArray(itens) ? itens : []).map(item => {
      const precoUnitario = Number(item?.materia_prima?.preco_unitario) || 0;
      const quantidade = Number(item?.quantidade) || 0;
      return {
        id: item?.id,
        insumo_id: item?.insumo_id,
        quantidade,
        ordem_insumo: item?.ordem_insumo,
        nome: item?.materia_prima?.nome,
        preco_unitario: precoUnitario,
        unidade: item?.materia_prima?.unidade,
        processo: item?.materia_prima?.processo,
        total: precoUnitario * quantidade
      };
    });

    const produtoIdNumero = Number(produtoId);
    const produtoIdEhNumero = Number.isFinite(produtoIdNumero);

    const lotesQueryBasica = {
      select: 'id,produto_id,quantidade,ultimo_insumo_id,ultimo_item,data_hora_completa,etapa_id,tempo_estimado_minutos',
      order: 'data_hora_completa.desc'
    };

    if (produtoIdEhNumero) {
      lotesQueryBasica.produto_id = produtoIdNumero;
    }

    let lotes = [];
    let fallbackQuery;
    try {
      lotes = await carregarLotesSeguros(lotesQueryBasica);
    } catch (err) {
      const corpoErro = normalizarCorpoErro(err);
      console.error(
        'Falha ao carregar lotes do produto com parâmetros compatíveis, retornando lista vazia:',
        err?.message || err,
        corpoErro ? { body: corpoErro, query: lotesQueryBasica } : { body: corpoErro }
      );
      try {
        // Fallback minimalista para tentar recuperar dados básicos sem filtros adicionais
        const baseFallbackQuery = {
          select:
            'id,produto_id,quantidade,ultimo_insumo_id,ultimo_item,data_hora_completa,etapa_id,tempo_estimado_minutos'
        };
        if (produtoIdEhNumero) {
          baseFallbackQuery.produto_id = `eq.${produtoIdNumero}`;
        }
        fallbackQuery = baseFallbackQuery;
        const lotesFallback = await pool.get(LOTES_ENDPOINT, {
          query: Object.keys(fallbackQuery).length ? fallbackQuery : undefined
        });
        lotes = Array.isArray(lotesFallback) ? lotesFallback : [];
      } catch (fallbackErr) {
        const corpoFallback = normalizarCorpoErro(fallbackErr);
        console.error(
          'Fallback simplificado ao carregar lotes também falhou:',
          fallbackErr?.message || fallbackErr,
          corpoFallback
            ? { body: corpoFallback, query: { fallback: true, ...(fallbackQuery || {}) } }
            : { body: corpoFallback }
        );
        lotes = [];
      }
    }

    const lotesLista = Array.isArray(lotes) ? lotes : [];

    const idsUltimosInsumos = lotesLista
      .map(lote => lote?.ultimo_insumo_id)
      .filter(id => id !== undefined && id !== null)
      .filter(id => Number.isFinite(Number(id)));

    const nomesUltimosInsumos = new Map();

    if (idsUltimosInsumos.length > 0) {
      const idsUnicos = Array.from(new Set(idsUltimosInsumos.map(id => Number(id))));
      try {
        const resultado = await pool.get('/materia_prima', {
          query: { select: 'id,nome', id: `in.(${idsUnicos.join(',')})` }
        });

        if (Array.isArray(resultado)) {
          resultado.forEach(registro => {
            if (!registro || registro.id === undefined || registro.id === null) return;
            nomesUltimosInsumos.set(registro.id, registro?.nome || null);
          });
        }

        idsUnicos.forEach(id => {
          if (!nomesUltimosInsumos.has(id)) {
            nomesUltimosInsumos.set(id, null);
          }
        });
      } catch (insumoErr) {
        console.error(
          'Falha ao buscar materia_prima para ids de ultimo_insumo',
          idsUnicos,
          insumoErr?.message || insumoErr
        );
        idsUnicos.forEach(id => {
          nomesUltimosInsumos.set(id, null);
        });
      }
    }

    const lotesFormatados = lotesLista.map(lote => {
      const etapa = lote?.etapa_id
        ? String(lote.etapa_id).trim() || '—'
        : '—';
      const ultimoItemNome =
        nomesUltimosInsumos.get(Number(lote?.ultimo_insumo_id)) ?? lote?.ultimo_item ?? null;

      return {
        id: lote?.id,
        quantidade: lote?.quantidade,
        ultimo_insumo_id: lote?.ultimo_insumo_id,
        ultimo_item: ultimoItemNome,
        tempo_estimado_minutos: lote?.tempo_estimado_minutos,
        data_hora_completa: lote?.data_hora_completa,
        etapa,
        processo: null
      };
    });

    return {
      produto: produto || null,
      itens: itensFormatados,
      lotes: lotesFormatados
    };
  } catch (err) {
    const corpoErro = normalizarCorpoErro(err);

    console.error('Erro ao listar detalhes do produto:', err.message, {
      status: err?.status,
      body: corpoErro,
      query: {
        produtoCodigo,
        produtoId,
        itensQuery,
        lotesQuery: lotesQueryBasica
      }
    });
    throw new Error('Erro ao listar detalhes do produto');
  }
}


/**
 * Busca 1 produto pelo codigo (text)
 */
async function obterProduto(codigo) {
  const produtos = await pool.get('/produtos', {
    query: { select: '*', codigo: `eq.${codigo}`, limit: 1 }
  });
  return Array.isArray(produtos) ? produtos[0] : null;
}

/**
 * Lista insumos (produtos_insumos + materia_prima) por codigo de produto (text)
 */
async function listarInsumosProduto(codigo) {
  const itens = await pool.get('/produtos_insumos', {
    query: {
      select:
        'id,produto_codigo,insumo_id,quantidade,ordem_insumo,materia_prima:insumo_id(nome,preco_unitario,unidade,processo)',
      produto_codigo: `eq.${codigo}`,
      order: 'materia_prima.processo,ordem_insumo'
    }
  });

  const lista = Array.isArray(itens) ? itens : [];
  return lista.map(item => {
    const precoUnitario = Number(item?.materia_prima?.preco_unitario) || 0;
    const quantidade = Number(item?.quantidade) || 0;
    return {
      id: item?.id,
      nome: item?.materia_prima?.nome,
      quantidade,
      ordem_insumo: item?.ordem_insumo,
      preco_unitario: precoUnitario,
      unidade: item?.materia_prima?.unidade,
      total: precoUnitario * quantidade,
      processo: item?.materia_prima?.processo
    };
  });
}

/**
 * Lista etapas de produção ordenadas pela coluna "ordem".
 */
async function listarEtapasProducao() {
  const etapas = await pool.get('/etapas_producao', {
    query: { select: 'id,nome,ordem', order: 'ordem.asc' }
  });
  return Array.isArray(etapas) ? etapas : [];
}

/**
 * Insere uma nova etapa de produção em uma ordem específica.
 * Caso a ordem seja informada, todos os registros com ordem igual ou
 * superior são incrementados.
 * Se nenhuma ordem for informada, a etapa é adicionada ao final.
 */
async function adicionarEtapaProducao(nome, ordem) {
  if (typeof nome === 'object' && nome !== null) {
    ({ nome, ordem } = nome);
  }

  const nomeNormalizado = String(nome || '').trim();
  if (!nomeNormalizado) {
    throw new Error('Nome da etapa é obrigatório');
  }

  const etapas = await pool.get('/etapas_producao', {
    query: { select: 'id,nome,ordem', order: 'ordem.asc' }
  });
  const lista = Array.isArray(etapas) ? etapas : [];

  let ordemDestino = Number(ordem);
  if (!Number.isInteger(ordemDestino) || ordemDestino <= 0) {
    ordemDestino = lista.length + 1;
  } else if (ordemDestino > lista.length + 1) {
    ordemDestino = lista.length + 1;
  }

  const conflitos = lista.filter(e => Number(e?.ordem) >= ordemDestino);
  for (const etapa of conflitos) {
    await pool.put(`/etapas_producao/${etapa.id}`, {
      nome: etapa.nome,
      ordem: Number(etapa.ordem) + 1
    });
  }

  return pool.post('/etapas_producao', { nome: nomeNormalizado, ordem: ordemDestino });
}

async function removerEtapaProducao(nome) {
  const nomeNormalizado = String(nome || '').trim();
  if (!nomeNormalizado) return false;

  const dependente = await pool.get('/materia_prima', {
    query: { select: 'id', processo: `eq.${nomeNormalizado}`, limit: 1 }
  });
  if (Array.isArray(dependente) && dependente.length > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  const etapa = await fetchSingle('etapas_producao', { nome: `eq.${nomeNormalizado}` });
  if (!etapa) return false;

  await pool.delete(`/etapas_producao/${etapa.id}`);

  const restantes = await pool.get('/etapas_producao', {
    query: { select: 'id,nome,ordem', order: 'ordem.asc' }
  });
  let ordemAtual = 1;
  for (const restante of Array.isArray(restantes) ? restantes : []) {
    if (Number(restante.ordem) !== ordemAtual) {
      await pool.put(`/etapas_producao/${restante.id}`, {
        nome: restante.nome,
        ordem: ordemAtual
      });
    }
    ordemAtual += 1;
  }

  return true;
}

/**
 * Lista itens de um processo para um produto (dependente de etapa)
 * Aceita etapa por id (int) OU por nome (text).
 */
async function listarItensProcessoProduto(codigo, etapa, busca = '') {
  const normalizarTexto = valor => String(valor || '').trim().toLowerCase();

  const etapaInfo = (() => {
    if (typeof etapa === 'object' && etapa !== null) {
      return {
        nome: etapa.nome || etapa.valor || etapa.value || '',
        id: etapa.id || etapa.dataId || etapa.data_id || null
      };
    }
    const etapaNormalizada = String(etapa || '').trim();
    const etapaId = etapaNormalizada && Number.isFinite(Number(etapaNormalizada))
      ? Number(etapaNormalizada)
      : null;
    return { nome: etapaNormalizada, id: etapaId };
  })();

  const termoBusca = normalizarTexto(busca);
  const etapaIdBusca = etapaInfo.id !== undefined && etapaInfo.id !== null
    ? String(etapaInfo.id).trim()
    : '';

  let etapaBusca = normalizarTexto(etapaInfo.nome);
  if (etapaIdBusca && !etapaBusca) {
    const etapaRegistro = await fetchSingle('etapas_producao', {
      id: `eq.${etapaIdBusca}`,
      select: 'id,nome'
    });
    etapaBusca = normalizarTexto(etapaRegistro?.nome);
  }

  const etapaFiltroAtivo = Boolean(etapaBusca || etapaIdBusca);

  const itens = await pool.get('/produtos_insumos', {
    query: {
      select:
        'insumo_id,materia_prima:insumo_id(id,nome,processo,etapa:etapas_producao(id,nome))',
      produto_codigo: `eq.${codigo}`
    }
  });

  const lista = Array.isArray(itens) ? itens : [];

  const filtrados = lista
    .map(item => item?.materia_prima)
    .filter(mp => {
      if (!mp) return false;

      const etapaRelacionada = mp?.etapa || mp?.etapas_producao || null;
      const processoNumerico = Number(mp?.processo);
      const processoIdNormalizado = Number.isFinite(processoNumerico)
        ? String(processoNumerico).trim()
        : '';
      const etapaNomeNormalizado = normalizarTexto(etapaRelacionada?.nome || mp.processo);
      const etapaIdNormalizado = etapaRelacionada?.id !== undefined && etapaRelacionada?.id !== null
        ? String(etapaRelacionada.id).trim()
        : processoIdNormalizado;

      const correspondeEtapa = !etapaFiltroAtivo
        || (etapaIdBusca && etapaIdNormalizado && etapaIdNormalizado === etapaIdBusca)
        || (etapaBusca && etapaNomeNormalizado && etapaNomeNormalizado === etapaBusca);

      if (!correspondeEtapa) return false;

      if (!termoBusca) return true;

      const nomeNormalizado = normalizarTexto(mp.nome);
      const idNormalizado = normalizarTexto(mp.id);
      return nomeNormalizado.includes(termoBusca) || idNormalizado.includes(termoBusca);
    });

  const unicoPorId = new Map();
  for (const mp of filtrados) {
    if (!unicoPorId.has(mp.id)) {
      unicoPorId.set(mp.id, { id: mp.id, nome: mp.nome });
    }
  }

  return Array.from(unicoPorId.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));
}

/**
 * CRUD básico de produtos
 */
async function adicionarProduto(dados) {
  const { codigo, nome, preco_venda, pct_markup, status } = dados;
  const categoria = dados.categoria || (nome ? String(nome).trim().split(' ')[0] : null);
  const required = {
    codigo: 'Código',
    nome: 'Nome',
    preco_venda: 'Preço de venda',
    pct_markup: 'Markup',
    status: 'Status'
  };
  for (const [key, label] of Object.entries(required)) {
    const val = dados[key];
    if (val === undefined || val === null || String(val).trim() === '') {
      const err = new Error(`${label} é obrigatório`);
      err.code = 'CAMPO_OBRIGATORIO';
      err.field = key;
      throw err;
    }
  }
  const codigoDup = await fetchSingle('produtos', { codigo: `eq.${codigo}` });
  if (codigoDup) {
    const err = new Error('Código já existe');
    err.code = 'CODIGO_EXISTE';
    throw err;
  }
  const nomeDup = await fetchSingle('produtos', { nome: `eq.${nome}` });
  if (nomeDup) {
    const err = new Error('Nome já existe');
    err.code = 'NOME_EXISTE';
    throw err;
  }
  return pool.post('/produtos', {
    codigo,
    nome,
    categoria,
    preco_venda,
    pct_markup,
    status
  });
}

async function atualizarProduto(id, dados) {
  const { codigo, nome, preco_venda, pct_markup, status } = dados;
  const categoria = dados.categoria || (nome ? String(nome).trim().split(' ')[0] : null);
  const atuais = await fetchSingle('produtos', { id: `eq.${id}` });
  if (!atuais) {
    throw new Error('Produto não encontrado');
  }
  if (codigo !== undefined && codigo !== atuais.codigo) {
    const dup = await fetchSingle('produtos', { codigo: `eq.${codigo}` });
    if (dup) {
      const err = new Error('Código já existe');
      err.code = 'CODIGO_EXISTE';
      throw err;
    }
  }
  if (nome !== undefined && nome !== atuais.nome) {
    const dup = await fetchSingle('produtos', { nome: `eq.${nome}` });
    if (dup) {
      const err = new Error('Nome já existe');
      err.code = 'NOME_EXISTE';
      throw err;
    }
  }
  const atualizado = await pool.put(`/produtos/${id}`, {
    codigo,
    nome,
    categoria,
    preco_venda,
    pct_markup,
    status
  });

  if (codigo !== undefined && codigo !== atuais.codigo) {
    const insumos = await pool.get('/produtos_insumos', {
      query: { select: 'id', produto_codigo: `eq.${atuais.codigo}` }
    });
    for (const ins of Array.isArray(insumos) ? insumos : []) {
      await pool.put(`/produtos_insumos/${ins.id}`, { produto_codigo: codigo });
    }
  }

  return atualizado;
}

async function excluirProduto(id) {
  const produto = await fetchSingle('produtos', { id: `eq.${id}` });
  if (!produto) {
    throw new Error('Produto não encontrado');
  }

  const orcamentos = await pool.get('/orcamentos_itens', {
    query: { select: 'id', produto_id: `eq.${id}`, limit: 1 }
  });
  if (Array.isArray(orcamentos) && orcamentos.length > 0) {
    throw new Error('Produto existe em Orçamentos, não é possível realizar a ação!');
  }

  const insumos = await pool.get('/produtos_insumos', {
    query: { select: 'id', produto_codigo: `eq.${produto.codigo}` }
  });
  for (const insumo of Array.isArray(insumos) ? insumos : []) {
    await pool.delete(`/produtos_insumos/${insumo.id}`);
  }

  const lotes = await carregarLotesSeguros({ select: 'id', produto_id: `eq.${id}` });
  for (const lote of Array.isArray(lotes) ? lotes : []) {
    await executarLotes('delete', `/${lote.id}`);
  }

  await pool.delete(`/produtos/${id}`);
  return true;
}

/**
 * Insere um novo lote de produção para o produto informado.
 *
 * @param {Object} params                Dados do lote a ser criado.
 * @param {number} params.produtoId      Identificador do produto.
 * @param {string} params.etapa          Etapa da produção em que o lote se encontra.
 * @param {number} params.ultimoInsumoId Último insumo utilizado na produção.
 * @param {number} params.quantidade     Quantidade de itens produzidos no lote.
 * @returns {Promise<Object>}            Registro completo do lote recém inserido.
 */
async function inserirLoteProduto({ produtoId, etapa, ultimoInsumoId, quantidade }) {
  return executarLotes('post', '', {
    produto_id: produtoId,
    etapa_id: etapa,
    ultimo_insumo_id: ultimoInsumoId,
    quantidade,
    data_hora_completa: new Date().toISOString()
  });
}

/**
 * Atualiza um lote (quantidade + data)
 */
async function atualizarLoteProduto(id, quantidade) {
  return executarLotes('put', `/${id}`, {
    quantidade,
    data_hora_completa: new Date().toISOString()
  });
}

async function excluirLoteProduto(id) {
  await executarLotes('delete', `/${id}`);
}

/**
 * Salva detalhes do produto (percentuais + itens) em transação
 */

async function salvarProdutoDetalhado(codigoOriginal, produto, itens) {
  const {
    pct_fabricacao,
    pct_acabamento,
    pct_montagem,
    pct_embalagem,
    pct_markup,
    pct_comissao,
    pct_imposto,
    preco_base,
    preco_venda,
    nome,
    codigo,
    ncm,
    categoria,
    status
  } = produto;

  const produtoAtual = await fetchSingle('produtos', { codigo: `eq.${codigoOriginal}` });
  if (!produtoAtual) {
    throw new Error('Produto não encontrado');
  }

  const codigoDestino = codigo !== undefined ? codigo : codigoOriginal;
  const ncmSanitizado =
    ncm !== undefined && ncm !== null ? String(ncm).slice(0, 8) : undefined;

  if (codigo !== undefined && codigo !== codigoOriginal) {
    const dup = await fetchSingle('produtos', { codigo: `eq.${codigo}` });
    if (dup) {
      const err = new Error('Código já existe');
      err.code = 'CODIGO_EXISTE';
      throw err;
    }
  }

  if (nome !== undefined) {
    const dup = await fetchSingle('produtos', { nome: `eq.${nome}` });
    if (dup && dup.codigo !== codigoOriginal) {
      const err = new Error('Nome já existe');
      err.code = 'NOME_EXISTE';
      throw err;
    }
  }

  const insumosInseridos = itens?.inseridos || [];
  const insumoIds = new Set();
  for (const ins of insumosInseridos) {
    if (insumoIds.has(ins.insumo_id)) {
      const err = new Error('Insumo duplicado');
      err.code = 'INSUMO_DUPLICADO';
      throw err;
    }
    insumoIds.add(ins.insumo_id);
  }

  await pool.put(`/produtos/${produtoAtual.id}`, {
    codigo: codigoDestino,
    pct_fabricacao,
    pct_acabamento,
    pct_montagem,
    pct_embalagem,
    pct_markup,
    pct_comissao,
    pct_imposto,
    preco_base,
    preco_venda,
    nome: nome !== undefined ? nome : produtoAtual.nome,
    ncm: ncmSanitizado !== undefined ? ncmSanitizado : produtoAtual.ncm,
    categoria: categoria !== undefined ? categoria : produtoAtual.categoria,
    status: status !== undefined ? status : produtoAtual.status
  });

  for (const del of itens?.deletados || []) {
    const deleted = await pool.delete(`/produtos_insumos/${del.id}`).catch(() => null);
    const insumoId = deleted?.insumo_id || del.insumo_id;
    if (insumoId != null) {
      const lotesRelacionados = await carregarLotesSeguros({
        select: 'id',
        produto_id: `eq.${produtoAtual.id}`,
        ultimo_insumo_id: `eq.${insumoId}`
      });
      for (const lote of Array.isArray(lotesRelacionados) ? lotesRelacionados : []) {
        await executarLotes('delete', `/${lote.id}`);
      }
    }
  }

  for (const up of itens?.atualizados || []) {
    await pool.put(`/produtos_insumos/${up.id}`, {
      quantidade: up.quantidade,
      ordem_insumo: up.ordem_insumo
    });
  }

  for (const ins of insumosInseridos) {
    await pool.post('/produtos_insumos', {
      produto_codigo: codigoDestino,
      insumo_id: ins.insumo_id,
      quantidade: ins.quantidade,
      ordem_insumo: ins.ordem_insumo
    });
  }

  return true;
}

async function listarColecoes() {
  const colecoesPersistidas = await buscarColecoesPersistidas();
  const categoriasProdutos = await buscarCategoriasProdutos();

  const conjunto = new Set();
  for (const nome of [...colecoesPersistidas, ...categoriasProdutos]) {
    if (nome) conjunto.add(nome);
  }

  return [...conjunto].sort((a, b) => a.localeCompare(b));
}

async function adicionarColecao(nome) {
  const nomeNormalizado = (nome || '').trim();
  if (!nomeNormalizado) return '';

  try {
    const res = await pool.post('/colecao', { nome: nomeNormalizado });
    return res?.nome || nomeNormalizado;
  } catch (err) {
    if (err.status === 404) {
      return nomeNormalizado;
    }
    throw err;
  }
}

async function colecaoTemDependencias(nome) {
  const produtos = await pool.get('/produtos', {
    query: { select: 'id', categoria: `eq.${nome}`, limit: 1 }
  });

  return Array.isArray(produtos) && produtos.length > 0;
}

async function removerColecao(nome) {
  const nomeNormalizado = (nome || '').trim();
  if (!nomeNormalizado) return;

  const dependente = await colecaoTemDependencias(nomeNormalizado);
  if (dependente) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  try {
    await pool.delete('/colecao', {
      query: { nome: `eq.${nomeNormalizado}` }
    });
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
}

async function buscarColecoesPersistidas() {
  try {
    const colecao = await pool.get('/colecao', {
      query: { select: 'nome', order: 'nome' }
    });
    return Array.isArray(colecao) ? colecao.map(c => (c?.nome || '').trim()).filter(Boolean) : [];
  } catch (err) {
    if (err.status === 404) {
      return [];
    }
    throw err;
  }
}

async function buscarCategoriasProdutos() {
  try {
    const produtos = await pool.get('/produtos', {
      query: { select: 'categoria' }
    });
    const categorias = Array.isArray(produtos) ? produtos : [];
    return categorias
      .map(p => (p?.categoria || '').trim())
      .filter(Boolean);
  } catch (err) {
    if (err.status === 404) {
      return [];
    }
    throw err;
  }
}

module.exports = {
  listarProdutos,
  listarDetalhesProduto,
  obterProduto,
  listarInsumosProduto,
  listarEtapasProducao,
  listarItensProcessoProduto,
  adicionarEtapaProducao,
  removerEtapaProducao,
  adicionarProduto,
  atualizarProduto,
  excluirProduto,
  inserirLoteProduto,
  atualizarLoteProduto,
  excluirLoteProduto,
  salvarProdutoDetalhado,
  listarColecoes,
  adicionarColecao,
  removerColecao,
  colecaoTemDependencias
};
