const pool = require('./db');

function extrairListaIn(valor) {
  if (typeof valor !== 'string') return null;
  const match = valor.trim().match(/^in\.\((.*)\)$/i);
  if (!match) return null;
  return match[1]
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
    .map(item => {
      const numero = Number(item);
      return Number.isFinite(numero) ? numero : item;
    });
}

function normalizarValorFiltro(valor) {
  if (Array.isArray(valor)) return valor.map(normalizarValorFiltro);
  const listaIn = extrairListaIn(valor);
  if (listaIn) return listaIn;
  if (typeof valor === 'string' && valor.startsWith('eq.')) return valor.slice(3);
  return valor;
}

function normalizarListaIds(valor) {
  const listaIn = extrairListaIn(valor);
  const valoresBase = Array.isArray(listaIn ?? valor)
    ? listaIn ?? valor
    : typeof valor === 'string'
      ? valor.split(',')
      : [valor];

  const valoresLimpos = valoresBase
    .map(item => (typeof item === 'string' ? item.trim() : item))
    .filter(item => item !== undefined && item !== null && item !== '');

  const valoresNormalizados = valoresLimpos.map(item => {
    const numero = Number(item);
    return Number.isFinite(numero) ? numero : item;
  });

  return Array.from(new Set(valoresNormalizados));
}

function campoEhId(chave) {
  return ['id', 'produto_id', 'insumo_id'].includes(chave);
}

function separarFiltrosQuery(query = {}) {
  const queryParams = {};
  const filtrosLocais = {};

  for (const [chave, valorOriginal] of Object.entries(query)) {
    if (valorOriginal === undefined || valorOriginal === null) continue;

    if (chave === 'select') {
      if (typeof valorOriginal === 'string' && valorOriginal.includes(':')) continue;
      queryParams[chave] = valorOriginal;
      continue;
    }

    if (['order', 'limit'].includes(chave)) {
      queryParams[chave] = valorOriginal;
      continue;
    }

    let valor = normalizarValorFiltro(valorOriginal);
    if (campoEhId(chave)) {
      const listaIds = normalizarListaIds(valor);
      valor = listaIds.length === 1 ? listaIds[0] : listaIds;
    }
    queryParams[chave] = valor;
    filtrosLocais[chave] = valor;
  }

  return { queryParams, filtrosLocais };
}

function aplicarFiltrosLocais(lista, filtrosLocais) {
  if (!filtrosLocais || !Object.keys(filtrosLocais).length) return lista;
  return lista.filter(item => {
    return Object.entries(filtrosLocais).every(([chave, esperado]) => {
      const valores = Array.isArray(esperado) ? esperado : [esperado];
      if (!valores.length) return true;
      return valores.some(valor => String(item?.[chave]) === String(valor));
    });
  });
}

async function getFiltrado(path, query = {}) {
  const { queryParams, filtrosLocais } = separarFiltrosQuery(query);
  const dados = await pool.get(path, Object.keys(queryParams).length ? { query: queryParams } : undefined);
  const lista = Array.isArray(dados) ? dados : [];
  return aplicarFiltrosLocais(lista, filtrosLocais);
}

async function fetchSingle(table, query) {
  const itens = await getFiltrado(`/${table}`, { ...query, limit: 1 });
  return Array.isArray(itens) && itens.length > 0 ? itens[0] : null;
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

function criarErroDetalhesProduto({
  message,
  code = 'ERRO_LISTAR_DETALHES_PRODUTO',
  context = {},
  originalError
}) {
  const erro = new Error(message || 'Erro ao listar detalhes do produto');
  erro.code = originalError?.code || code;
  erro.context = {
    ...(originalError?.context && typeof originalError.context === 'object' ? originalError.context : {}),
    ...context
  };
  erro.originalMessage = originalError?.message || null;
  return erro;
}

function montarPayloadProduto(produtoAtual, sobrescritas = {}) {
  const payload = {};
  if (produtoAtual && typeof produtoAtual === 'object') {
    for (const [chave, valor] of Object.entries(produtoAtual)) {
      if (valor === null || valor === undefined) continue;
      if (typeof valor === 'object') continue;
      payload[chave] = valor;
    }
  }

  for (const [chave, valor] of Object.entries(sobrescritas)) {
    if (valor !== undefined) {
      payload[chave] = valor;
    }
  }

  return payload;
}

/**
 * Lista todos os produtos (resumo)
 */
const LOTES_ENDPOINT = '/produtos_em_cada_ponto';

async function executarLotes(method, pathSuffix = '', payload) {
  return pool[method](`${LOTES_ENDPOINT}${pathSuffix}`, payload);
}

const LOTES_CACHE_TTL_MS = 30000;
const LOTES_CACHE_ALERTA_LIMITE = 5000;
let lotesCache = null;

function obterCacheLotes(agora, queryKey) {
  if (!lotesCache || lotesCache.queryKey !== queryKey) return null;
  if (agora - lotesCache.fetchedAt > LOTES_CACHE_TTL_MS) return null;
  return lotesCache;
}

function salvarCacheLotes(agora, queryKey, lotes) {
  const lista = Array.isArray(lotes) ? lotes : [];
  lotesCache = {
    fetchedAt: agora,
    queryKey,
    lotes: lista,
    quantidade: lista.length
  };
  if (lista.length > LOTES_CACHE_ALERTA_LIMITE) {
    console.warn(
      'Aviso: carga elevada de lotes em produtos_em_cada_ponto.',
      { quantidade: lista.length }
    );
  }
}

const MATERIAS_CACHE_TTL_MS = 30000;
const materiasCache = new Map();
const MATERIAS_SELECT_PADRAO = 'id,nome,preco_unitario,unidade,processo';

function obterMateriaCache(id, agora) {
  const entrada = materiasCache.get(id);
  if (!entrada) return { hit: false, data: null };
  if (agora - entrada.fetchedAt > MATERIAS_CACHE_TTL_MS) {
    materiasCache.delete(id);
    return { hit: false, data: null };
  }
  return { hit: true, data: entrada.data, completo: entrada.completo };
}

function salvarMateriaCache(id, data, agora, completo) {
  materiasCache.set(id, { data, fetchedAt: agora, completo });
}

async function carregarMateriasPorIds(ids = [], options = {}) {
  const idsValidos = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .filter(id => id !== undefined && id !== null)
    )
  )
    .map(Number)
    .filter(Number.isFinite);

  if (!idsValidos.length) return new Map();

  const agora = Date.now();
  const mapa = new Map();
  const idsParaBuscar = [];
  const select = options.select || MATERIAS_SELECT_PADRAO;
  const requerCompleto = select === MATERIAS_SELECT_PADRAO;

  for (const id of idsValidos) {
    const cache = obterMateriaCache(id, agora);
    if (cache.hit && (!requerCompleto || cache.completo)) {
      mapa.set(id, cache.data);
    } else {
      idsParaBuscar.push(id);
    }
  }

  if (idsParaBuscar.length > 0) {
    try {
      const resultado = await getFiltrado('/materia_prima', {
        select
      });
      const materiasPorId = mapearMateriasPorId(resultado);

      for (const id of idsParaBuscar) {
        const materia = materiasPorId.get(id) || null;
        mapa.set(id, materia);
        salvarMateriaCache(id, materia, agora, requerCompleto);
      }
    } catch (err) {
      console.error('Erro ao carregar matéria-prima em lote:', err?.message || err);
      for (const id of idsParaBuscar) {
        mapa.set(id, null);
        salvarMateriaCache(id, null, agora, requerCompleto);
      }
    }
  }

  return mapa;
}

function mapearMateriasPorId(registros = []) {
  const mapa = new Map();
  for (const registro of Array.isArray(registros) ? registros : []) {
    if (registro?.id === undefined || registro?.id === null) continue;
    mapa.set(Number(registro.id), registro);
  }
  return mapa;
}

function comporItensComMaterias(itensBase = [], materiasPorId = new Map()) {
  return (Array.isArray(itensBase) ? itensBase : [])
    .map(item => {
      const materia = materiasPorId.get(Number(item?.insumo_id)) || {};
      const precoUnitario = Number(materia?.preco_unitario) || 0;
      const quantidade = Number(item?.quantidade) || 0;

      return {
        id: item?.id,
        insumo_id: item?.insumo_id,
        quantidade,
        ordem_insumo: item?.ordem_insumo,
        nome: materia?.nome,
        preco_unitario: precoUnitario,
        unidade: materia?.unidade,
        processo: materia?.processo,
        total: precoUnitario * quantidade
      };
    })
    .sort(
      (a, b) =>
        String(a?.processo || '').localeCompare(String(b?.processo || '')) ||
        Number(a?.ordem_insumo || 0) - Number(b?.ordem_insumo || 0)
    );
}

async function carregarProdutoBase(produtoId) {
  const produtoIdNum = Number(produtoId);
  const produtoIdInformado = produtoId !== undefined && produtoId !== null && produtoId !== '';

  if (!produtoIdInformado) {
    const err = new Error('produto_id é obrigatório');
    err.code = 'PRODUTO_ID_OBRIGATORIO';
    throw err;
  }

  if (!Number.isFinite(produtoIdNum)) {
    const err = new Error('produto_id inválido');
    err.code = 'PRODUTO_ID_INVALIDO';
    throw err;
  }

  const produtosPorId = await getFiltrado('/produtos', {
    select: '*',
    id: produtoIdNum,
    limit: 1
  });

  return Array.isArray(produtosPorId) ? produtosPorId[0] || null : null;
}

function mesclarItensPorId(...listas) {
  const itensUnificados = [];
  const itensPorId = new Map();

  for (const lista of listas) {
    for (const item of Array.isArray(lista) ? lista : []) {
      const id = item?.id;
      if (id === undefined || id === null) {
        itensUnificados.push(item);
        continue;
      }
      if (!itensPorId.has(id)) {
        itensPorId.set(id, item);
        itensUnificados.push(item);
      }
    }
  }

  return itensUnificados;
}

async function carregarInsumosBase(produtoId) {
  const produtoIdNum = Number(produtoId);

  if (!Number.isInteger(produtoIdNum) || produtoIdNum <= 0) {
    console.error('❌ produto_id inválido:', produtoId);
    return [];
  }

  try {
    console.log('🔎 Buscando insumos do produto:', produtoIdNum);

    const itens = await getFiltrado('/produtos_insumos', {
      select: '*',
      produto_id: produtoIdNum
    });

    console.log('✅ Insumos filtrados corretamente:', itens.length);

    return Array.isArray(itens) ? itens : [];

  } catch (err) {
    console.error('❌ Erro ao buscar insumos:', err);
    return [];
  }
}


/**
 * Formato unificado utilizado pelas rotas que retornam um produto com insumos.
 *
 * {
 *   produto: { ...registro de produtos... },
 *   itens: [
 *     {
 *       id, insumo_id, quantidade, ordem_insumo,
 *       nome, unidade, processo, preco_unitario, total
 *     }
 *   ],
 *   lotes: [...]
 * }
 */

async function montarProdutoComInsumos(produtoId) {
  let produto = null;
  let itensBase = [];

  try {
    produto = await carregarProdutoBase(produtoId);
  } catch (err) {
    throw criarErroDetalhesProduto({
      message: err?.message || 'Falha ao carregar dados base do produto',
      context: { produtoId, etapa: 'carregarProdutoBase' },
      originalError: err
    });
  }

  try {
    itensBase = await carregarInsumosBase(produtoId);
  } catch (err) {
    throw criarErroDetalhesProduto({
      message: err?.message || 'Falha ao carregar insumos base do produto',
      context: { produtoId, etapa: 'carregarInsumosBase' },
      originalError: err
    });
  }

  if (!Array.isArray(itensBase)) {
  itensBase = [];
  }


  const idsMateriaPrima = Array.from(
    new Set(itensBase.map(item => item?.insumo_id).filter(id => id !== undefined && id !== null))
  );

  let materias = new Map();
  try {
    materias = idsMateriaPrima.length > 0 ? await carregarMateriasPorIds(idsMateriaPrima) : new Map();
  } catch (err) {
    throw criarErroDetalhesProduto({
      message: err?.message || 'Falha ao carregar matérias-primas por ids',
      context: { produtoId, etapa: 'carregarMateriasPorIds' },
      originalError: err
    });
  }
  const materiasPorId = materias instanceof Map ? materias : mapearMateriasPorId(materias);

  return {
    produto: produto || null,
    itens: comporItensComMaterias(itensBase, materiasPorId)
  };
}


async function listarProdutos() {
  try {
    const produtos = await pool.get('/produtos');
    const queryLotes = { select: 'produto_id,quantidade' };
    const queryKey = JSON.stringify(queryLotes);
    const agora = Date.now();
    const cache = obterCacheLotes(agora, queryKey);
    const lotes = cache ? cache.lotes : await carregarLotesSeguros(queryLotes);
    if (!cache) {
      salvarCacheLotes(agora, queryKey, lotes);
    }
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

async function listarDetalhesProduto(produtoId) {
  const produtoIdNumero = Number(produtoId);
  if (!Number.isFinite(produtoIdNumero)) {
    const err = new Error('produto_id é obrigatório');
    err.code = 'PRODUTO_ID_OBRIGATORIO';
    throw err;
  }

  try {
    const { produto, itens: itensFormatados } = await montarProdutoComInsumos(produtoIdNumero);

    const lotesQuery = {
      select: 'id,produto_id,quantidade,ultimo_insumo_id,ultimo_item,data_hora_completa,etapa_id,tempo_estimado_minutos',
      order: 'data_hora_completa.desc',
      produto_id: produtoIdNumero
    };

    const lotes = await carregarLotesSeguros(lotesQuery);
    const lotesLista = Array.isArray(lotes) ? lotes : [];

    const idsUltimosInsumos = lotesLista
      .map(lote => lote?.ultimo_insumo_id)
      .filter(id => id !== undefined && id !== null)
      .filter(id => Number.isFinite(Number(id)));

    const nomesUltimosInsumos = new Map();

    if (idsUltimosInsumos.length > 0) {
      const idsUnicos = Array.from(new Set(idsUltimosInsumos.map(Number)));
      idsUnicos.forEach(id => nomesUltimosInsumos.set(id, null));

      const materiasUltimas = await carregarMateriasPorIds(idsUnicos, { select: 'id,nome' });
      for (const id of idsUnicos) {
        const materia = materiasUltimas.get(id);
        nomesUltimosInsumos.set(id, materia?.nome || null);
      }
    }

    const lotesFormatados = lotesLista.map(lote => ({
      id: lote?.id,
      quantidade: lote?.quantidade,
      ultimo_insumo_id: lote?.ultimo_insumo_id,
      ultimo_item: nomesUltimosInsumos.get(Number(lote?.ultimo_insumo_id)) ?? lote?.ultimo_item ?? null,
      tempo_estimado_minutos: lote?.tempo_estimado_minutos,
      data_hora_completa: lote?.data_hora_completa,
      etapa: lote?.etapa_id ? String(lote.etapa_id).trim() : '—',
      processo: null
    }));

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
      query: { produtoId: produtoIdNumero }
    });
    throw criarErroDetalhesProduto({
      message: err?.message || 'Erro ao listar detalhes do produto',
      context: {
        produtoId: produtoIdNumero,
        etapa: err?.context?.etapa || 'listarDetalhesProduto'
      },
      originalError: err
    });
  }
}


/**
 * Busca 1 produto pelo codigo (text)
 */
async function obterProduto(codigo) {
  const produtos = await getFiltrado('/produtos', {
    select: '*',
    codigo,
    limit: 1
  });
  return Array.isArray(produtos) ? produtos[0] : null;
}

/**
 * Lista insumos (produtos_insumos + materia_prima) por codigo de produto (text)
 */
async function listarInsumosProduto(codigoOuParams) {
  const params = typeof codigoOuParams === 'object' && codigoOuParams !== null
    ? codigoOuParams
    : { codigo: codigoOuParams };

  const produtoIdDireto = Number(params.produtoId ?? params.id);
  const produtoId = Number.isFinite(produtoIdDireto)
    ? produtoIdDireto
    : Number((await obterProduto(params.codigo))?.id);

  if (!Number.isFinite(produtoId)) {
    return [];
  }

  const { itens } = await montarProdutoComInsumos(produtoId);
  return itens;
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

  const dependente = await getFiltrado('/materia_prima', {
    select: 'id',
    processo: nomeNormalizado,
    limit: 1
  });
  if (Array.isArray(dependente) && dependente.length > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  const etapa = await fetchSingle('etapas_producao', { nome: nomeNormalizado });
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
async function listarItensProcessoProduto(codigo, etapa, busca = '', produtoId = null) {
  const normalizarTexto = valor => String(valor || '').trim().toLowerCase();

  const produtoIdNum = Number(produtoId);
  if (!Number.isFinite(produtoIdNum)) {
    const err = new Error('produto_id é obrigatório');
    err.code = 'PRODUTO_ID_OBRIGATORIO';
    throw err;
  }

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
      id: etapaIdBusca,
      select: 'id,nome'
    });
    etapaBusca = normalizarTexto(etapaRegistro?.nome);
  }

  const etapaFiltroAtivo = Boolean(etapaBusca || etapaIdBusca);
  const itensPrimarios = await getFiltrado('/produtos_insumos', {
    select: 'insumo_id,produto_id',
    produto_id: produtoIdNum
  });

  const lista = Array.isArray(itensPrimarios) ? itensPrimarios : [];
  const materias = await carregarMateriasPorIds(lista.map(item => item?.insumo_id));

  const filtrados = Array.from(materias.values())
    .filter(mp => {
      if (!mp) return false;

      const processoNumerico = Number(mp?.processo);
      const processoIdNormalizado = Number.isFinite(processoNumerico)
        ? String(processoNumerico).trim()
        : '';
      const etapaNomeNormalizado = normalizarTexto(mp.processo);
      const correspondeEtapa = !etapaFiltroAtivo
        || (etapaIdBusca && processoIdNormalizado && processoIdNormalizado === etapaIdBusca)
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
  const { codigo, nome, ncm, preco_venda, pct_markup, status } = dados;
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
  const codigoDup = await fetchSingle('produtos', { codigo });
  if (codigoDup) {
    const err = new Error('Código já existe');
    err.code = 'CODIGO_EXISTE';
    throw err;
  }
  const nomeDup = await fetchSingle('produtos', { nome });
  if (nomeDup) {
    const err = new Error('Nome já existe');
    err.code = 'NOME_EXISTE';
    throw err;
  }
  return pool.post('/produtos', {
    codigo,
    nome,
    ncm,
    categoria,
    preco_venda,
    pct_markup,
    status
  });
}

async function atualizarProduto(id, dados) {
  const { codigo, nome, preco_venda, pct_markup, status, ncm } = dados;
  const categoria = dados.categoria || (nome ? String(nome).trim().split(' ')[0] : null);
  const atuais = await fetchSingle('produtos', { id });
  if (!atuais) {
    throw new Error('Produto não encontrado');
  }
  const ncmSanitizado =
    ncm !== undefined && ncm !== null ? String(ncm).slice(0, 8) : undefined;
  if (codigo !== undefined && codigo !== atuais.codigo) {
    const dup = await fetchSingle('produtos', { codigo });
    if (dup && Number(dup.id) !== Number(atuais.id)) {
      const err = new Error('Código já existe');
      err.code = 'CODIGO_EXISTE';
      throw err;
    }
  }
  if (nome !== undefined && nome !== atuais.nome) {
    const dup = await fetchSingle('produtos', { nome });
    if (dup && Number(dup.id) !== Number(atuais.id)) {
      const err = new Error('Nome já existe');
      err.code = 'NOME_EXISTE';
      throw err;
    }
  }
  const payload = montarPayloadProduto(atuais, {
    codigo,
    nome,
    categoria,
    preco_venda,
    pct_markup,
    status,
    ncm: ncmSanitizado
  });
  const atualizado = await pool.put(`/produtos/${id}`, payload);
  return atualizado;
}

async function excluirProduto(id) {
  const inicioTotal = Date.now();
  let inicioEtapa = inicioTotal;

  const produto = await fetchSingle('produtos', { id });
  if (!produto) {
    throw new Error('Produto não encontrado');
  }
  console.info(`[excluirProduto] produto em ${Date.now() - inicioEtapa}ms`);
  inicioEtapa = Date.now();

  const orcamentos = await getFiltrado('/orcamentos_itens', {
    select: 'id',
    produto_id: id,
    limit: 1
  });
  if (Array.isArray(orcamentos) && orcamentos.length > 0) {
    throw new Error('Produto existe em Orçamentos, não é possível realizar a ação!');
  }
  console.info(`[excluirProduto] orcamentos em ${Date.now() - inicioEtapa}ms`);
  inicioEtapa = Date.now();

  const insumos = await getFiltrado('/produtos_insumos', {
    select: 'id',
    produto_id: produto.id
  });
  await Promise.all(
    (Array.isArray(insumos) ? insumos : []).map(insumo => pool.delete(`/produtos_insumos/${insumo.id}`))
  );
  console.info(`[excluirProduto] insumos em ${Date.now() - inicioEtapa}ms`);
  inicioEtapa = Date.now();

  const lotes = await carregarLotesSeguros({ select: 'id', produto_id: id });
  await Promise.all(
    (Array.isArray(lotes) ? lotes : []).map(lote => executarLotes('delete', `/${lote.id}`))
  );
  console.info(`[excluirProduto] lotes em ${Date.now() - inicioEtapa}ms`);

  await pool.delete(`/produtos/${id}`);
  console.info(`[excluirProduto] total em ${Date.now() - inicioTotal}ms`);
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

async function salvarProdutoDetalhado(codigoOriginal, produto, itens, produtoId) {
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

  const produtoIdPayload = itens && Object.prototype.hasOwnProperty.call(itens, 'produto_id')
    ? itens.produto_id
    : undefined;
  const produtoIdInformado = produtoIdPayload ?? produtoId;

  if (produtoIdInformado === undefined || produtoIdInformado === null || String(produtoIdInformado).trim() === '') {
    const err = new Error('produto_id é obrigatório');
    err.code = 'PRODUTO_ID_OBRIGATORIO';
    throw err;
  }

  const produtoIdNormalizado = Number(produtoIdInformado);
  if (!Number.isFinite(produtoIdNormalizado)) {
    const err = new Error('produto_id inválido');
    err.code = 'PRODUTO_ID_INVALIDO';
    throw err;
  }

  const produtoAtual = await fetchSingle('produtos', { id: produtoIdNormalizado });
  if (!produtoAtual) {
    throw new Error('Produto não encontrado');
  }

  const codigoDestino = codigo !== undefined ? codigo : produtoAtual.codigo;
  const ncmSanitizado =
    ncm !== undefined && ncm !== null ? String(ncm).slice(0, 8) : undefined;
  const codigoAlterado = codigo !== undefined && codigo !== produtoAtual.codigo;

  if (codigoAlterado) {
    const dup = await fetchSingle('produtos', { codigo });
    if (dup && Number(dup.id) !== Number(produtoAtual.id)) {
      const err = new Error('Código já existe');
      err.code = 'CODIGO_EXISTE';
      throw err;
    }
  }

  if (nome !== undefined) {
    const dup = await fetchSingle('produtos', { nome });
    if (dup && Number(dup.id) !== Number(produtoAtual.id)) {
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

  const payload = montarPayloadProduto(produtoAtual, {
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
    nome,
    ncm: ncmSanitizado,
    categoria,
    status
  });
  try {
    await pool.put(`/produtos/${produtoAtual.id}`, payload);
  } catch (err) {
    const message = err?.message ? String(err.message) : '';
    if (/foreign key/i.test(message)) {
      console.error('[salvarProdutoDetalhado] Falha de FK ao atualizar produto.');
      const friendly = new Error(
        'Falha ao atualizar o produto. Verifique se as referências em produtos_insumos estão coerentes com produto_id.'
      );
      friendly.code = 'FK_SEM_CASCADE';
      throw friendly;
    }
    throw err;
  }

  for (const del of itens?.deletados || []) {
    const deleted = await pool.delete(`/produtos_insumos/${del.id}`).catch(() => null);
    const insumoId = deleted?.insumo_id || del.insumo_id;
    if (insumoId != null) {
      const lotesRelacionados = await carregarLotesSeguros({
        select: 'id',
        produto_id: produtoIdNormalizado,
        ultimo_insumo_id: insumoId
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
      produto_id: produtoIdNormalizado,
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
  const produtos = await getFiltrado('/produtos', {
    select: 'id',
    categoria: nome,
    limit: 1
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

  let colecao = null;
  try {
    const colecoes = await pool.get('/colecao', {
      query: { nome: nomeNormalizado, limit: 1 }
    });
    colecao = Array.isArray(colecoes) && colecoes.length > 0 ? colecoes[0] : null;
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  if (!colecao?.id) {
    const err = new Error('Coleção não encontrada');
    err.code = 'COLECAO_NAO_ENCONTRADA';
    err.status = 404;
    throw err;
  }

  try {
    await pool.delete(`/colecao/${colecao.id}`);
  } catch (err) {
    if (err.status === 404) {
      const notFoundError = new Error('Coleção não encontrada');
      notFoundError.code = 'COLECAO_NAO_ENCONTRADA';
      notFoundError.status = 404;
      throw notFoundError;
    }
    throw err;
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
