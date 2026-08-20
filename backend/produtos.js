const pool = require('./db');
const { MOV, ITEM, registrarMovimento } = require('./estoqueLedger');
const { normalizarCamposNumericos, paraDecimal } = require('./numeros');
// Quem grava produto ou rota derruba o catálogo cacheado — ver catalogoCache.
const catalogoCache = require('./catalogoCache');
// Preço praticado da peça — ver backend/tabelaFixa.js.
const tabelaFixa = require('./tabelaFixa');

/** Campos que chegam do front como texto e precisam virar número decimal. */
const CAMPOS_NUMERICOS_PRODUTO = [
  'pct_fabricacao',
  'pct_acabamento',
  'pct_montagem',
  'pct_embalagem',
  'pct_markup',
  'pct_comissao',
  'pct_imposto',
  'preco_base',
  'preco_venda',
  'quantidade_total'
];
const CAMPOS_NUMERICOS_ITEM = ['quantidade'];

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

/**
 * Joga o cache fora.
 *
 * O cache de lotes vale 30 s, e NADA o invalidava ao gravar. O efeito era que,
 * logo depois de inserir, editar ou excluir um lote, a coluna "Quantidade" da
 * grade de Produtos continuava mostrando o valor velho — o app relia, mas relia
 * o cache. Quem escreve precisa derrubá-lo: um número de estoque errado na tela
 * leva a decisão errada de produção.
 */
function invalidarCacheLotes() {
  lotesCache = null;
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
    // `ordem_insumo` é a posição que o usuário montou na tela (1, 2, 3...) e é
    // gravada de forma contígua por processo. Ordenar primeiro pelo NOME do
    // processo embaralhava os processos em ordem alfabética e escondia a
    // sequência escolhida; agora a posição salva manda, com o processo apenas
    // como desempate.
    .sort(
      (a, b) =>
        Number(a?.ordem_insumo || 0) - Number(b?.ordem_insumo || 0) ||
        String(a?.processo || '').localeCompare(String(b?.processo || ''))
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

    const comQuantidade = listaProdutos
      .map(produto => ({
        ...produto,
        quantidade_total: quantidadesPorProduto.get(produto?.id) || 0
      }))
      .sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || '')));

    // `preco_tabela` viaja junto com o produto porque quem consome esta lista
    // (Produtos, Orçamentos, Relatórios) precisa dos dois preços lado a lado.
    return tabelaFixa.anexarPrecoTabela(comQuantidade);
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
  normalizarCamposNumericos(dados, CAMPOS_NUMERICOS_PRODUTO);
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
  // O catálogo mudou: o cache de produtos/rotas não vale mais.
  catalogoCache.invalidar();
  const criado = await pool.post('/produtos', {
    codigo,
    nome,
    ncm,
    categoria,
    preco_venda,
    pct_markup,
    status
  });

  // Peça nova nasce com preço praticado igual ao calculado. Sem esta linha o
  // produto ficaria invisível para Orçamentos, que só vende o que tem preço
  // de tabela.
  const criadoId = Array.isArray(criado) ? criado[0]?.id : criado?.id;
  if (criadoId != null) {
    await tabelaFixa.registrarPrecoTabela({
      produtoId: criadoId,
      codigo,
      valor: preco_venda
    });
  }

  return criado;
}

async function atualizarProduto(id, dados) {
  normalizarCamposNumericos(dados, CAMPOS_NUMERICOS_PRODUTO);
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
  // O catálogo mudou: o cache de produtos/rotas não vale mais.
  catalogoCache.invalidar();
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

  // A linha da tabela fixa sai ANTES do produto: id_prod aponta para
  // produtos.id, e deixá-la para trás criaria preço órfão que reapareceria
  // colado no próximo produto a receber o mesmo id.
  await tabelaFixa.removerPrecoTabela(id);

  await pool.delete(`/produtos/${id}`);
  // O catálogo mudou: o cache de produtos/rotas não vale mais.
  catalogoCache.invalidar();
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
/**
 * Adaptador do razão para o cliente global.
 *
 * `estoqueLedger` fala com o cliente da requisição, cujos caminhos levam
 * `/api`. Aqui usamos o `pool`, cuja base JÁ inclui `/api` — sem tirar o
 * prefixo, a URL sairia duplicada e todo movimento falharia.
 */
const razaoPeloPool = {
  post: (rota, payload) => pool.post(String(rota).replace(/^\/api/, ''), payload)
};

// ---------------------------------------------------------------------------
// A MATÉRIA-PRIMA DE UMA PEÇA MEXIDA À MÃO
//
// Colocar uma peça no estoque pela tela de Produtos é dizer que ela existe. Se
// ela existe, alguém a produziu — e produzir consome insumo. Enquanto essa
// baixa não era feita, o estoque de peças subia e o de matéria-prima ficava
// parado: o sistema passava a acreditar em material que já tinha virado peça.
//
// Mas nem toda entrada é produção: pode ser correção de inventário, devolução
// de cliente, peça comprada pronta. Por isso a baixa é uma ESCOLHA de quem
// registra, feita na hora, e não um automatismo.
//
// O trecho consumido é a rota ATÉ o ponto da peça: uma peça em 10/15 gastou os
// dez primeiros passos, não os quinze.
// ---------------------------------------------------------------------------

/**
 * Os passos da rota que uma peça parada em `ultimoInsumoId` já consumiu.
 *
 * `produtos_em_cada_ponto.ultimo_insumo_id` guarda o id da MATÉRIA-PRIMA (e não
 * o da linha da rota — ver a nota em `estoqueLedger.registrarPecaDoEstoque`).
 * A comparação aqui é com `produtos_insumos.insumo_id`, por isso.
 */
async function rotaConsumidaAte(produtoId, ultimoInsumoId) {
  const bruta = await pool
    .get('/produtos_insumos', { query: { produto_id: produtoId } })
    .catch(() => []);
  const rota = (Array.isArray(bruta) ? bruta : [])
    .map(passo => ({
      insumo_id: Number(passo.insumo_id),
      por_unidade: Number(paraDecimal(passo.quantidade)) || 0,
      ordem: Number(passo.ordem_insumo) || 0
    }))
    .filter(passo => Number.isFinite(passo.insumo_id))
    .sort((a, b) => a.ordem - b.ordem);

  if (!rota.length) return [];

  const parada = rota.find(passo => Number(passo.insumo_id) === Number(ultimoInsumoId));
  // Sem saber onde a peça parou, o mais seguro é não mexer em nada: chutar a
  // rota inteira debitaria material que talvez nunca tenha sido usado.
  if (!parada) return [];

  return rota.filter(passo => passo.ordem <= parada.ordem);
}

/**
 * O que ACONTECERIA com o estoque de cada insumo, sem gravar nada.
 *
 * Serve para a tela mostrar antes de confirmar quais insumos ficariam
 * negativos. Abater às cegas e descobrir depois é o que transforma um erro de
 * digitação em inventário furado — e negativo consentido é decisão, não
 * acidente: precisa de aprovação e justificativa de quem registra.
 *
 * @returns {Promise<{insumos: Array, negativos: Array}>}
 */
async function previsaoDeInsumosDaPeca({ produtoId, ultimoInsumoId, unidades, direcao = 'saida' }) {
  const quantidadePecas = Number(paraDecimal(unidades)) || 0;
  const passos = quantidadePecas > 0 ? await rotaConsumidaAte(produtoId, ultimoInsumoId) : [];
  if (!passos.length) return { insumos: [], negativos: [] };

  // Uma leitura da matéria-prima e um índice em memória: uma requisição por
  // passo seriam quinze idas à API só para montar um aviso.
  const materias = await pool.get('/materia_prima').catch(() => []);
  const porId = new Map();
  for (const materia of (Array.isArray(materias) ? materias : [])) {
    if (materia?.id !== undefined) porId.set(Number(materia.id), materia);
  }

  const insumos = passos.map(passo => {
    const materia = porId.get(Number(passo.insumo_id)) || null;
    const quantidade = Number(paraDecimal(passo.por_unidade * quantidadePecas)) || 0;
    const saldoAtual = Number(materia?.quantidade) || 0;
    const infinito = Boolean(materia?.infinito);
    const saldoPrevisto = direcao === 'entrada'
      ? saldoAtual + quantidade
      : saldoAtual - quantidade;

    return {
      insumo_id: passo.insumo_id,
      nome: materia?.nome || `Insumo ${passo.insumo_id}`,
      unidade: materia?.unidade || '',
      ordem: passo.ordem,
      por_unidade: passo.por_unidade,
      quantidade,
      saldo_atual: saldoAtual,
      saldo_previsto: Number(paraDecimal(saldoPrevisto)) || 0,
      infinito,
      // Insumo infinito nunca fica negativo — é o que "infinito" quer dizer.
      negativo: !infinito && direcao === 'saida' && saldoPrevisto < 0
    };
  });

  return { insumos, negativos: insumos.filter(i => i.negativo) };
}

/**
 * Abate (ou devolve) a matéria-prima de `unidades` peças paradas num ponto.
 *
 * Grava nas DUAS auditorias, como todo o resto: `materia_prima_movimentacoes`
 * (o saldo antes/depois, pelo mesmo caminho do módulo de Matéria-Prima) e
 * `estoque_movimentos` (o vínculo com a peça e o lote).
 *
 * @param {'saida'|'entrada'} direcao
 * @returns {Promise<{insumos: number, falhas: string[]}>}
 */
async function movimentarInsumosDaPeca({
  produtoId,
  ultimoInsumoId,
  unidades,
  direcao,
  loteId = null,
  usuarioId = null,
  // O movimento da PEÇA que causou esta baixa. É por ele que o extrato do
  // insumo mostra o produto, quantas unidades e em que ponto da rota — sem o
  // vínculo, o consumo aparece sozinho e sem explicação.
  movimentoDaPecaId = null,
  // Saldo negativo consentido: o que o usuário escreveu ao aprovar. Fica no
  // movimento do insumo que DE FATO fechou negativo — marcar todos diria que
  // houve decisão onde não houve.
  justificativaNegativo = null,
  nota
}) {
  const quantidadePecas = Number(paraDecimal(unidades)) || 0;
  if (!(quantidadePecas > 0)) return { insumos: 0, falhas: [] };

  // UMA previsão serve para as duas coisas: dizer quais insumos fecham negativo
  // e fornecer a lista de quanto tirar de cada um.
  //
  // Antes eram duas leituras da rota e duas da matéria-prima por operação —
  // e, com quinze passos, cada requisição a mais atravessa o servidor local
  // até a API remota. Além de mais rápido, isto garante que o que é GRAVADO é
  // exatamente o que foi mostrado e aprovado na tela.
  const previsao = await previsaoDeInsumosDaPeca({
    produtoId, ultimoInsumoId, unidades, direcao
  }).catch(() => ({ insumos: [], negativos: [] }));

  if (!previsao.insumos.length) return { insumos: 0, falhas: [] };

  // Carregado aqui e não no topo: `materiaPrima` já requer este arquivo, e o
  // require no topo fecharia o ciclo.
  const { registrarEntrada, registrarSaida } = require('./materiaPrima');
  const aplicar = direcao === 'entrada' ? registrarEntrada : registrarSaida;

  const ficaNegativo = new Set(previsao.negativos.map(i => Number(i.insumo_id)));

  const falhas = [];
  let insumos = 0;

  const aTratar = previsao.insumos.filter(p => (Number(p.quantidade) || 0) > 0);

  /** Um insumo: lê o saldo, grava o novo e deixa as duas auditorias. */
  const tratar = async passo => {
    const quantidade = Number(passo.quantidade) || 0;
    const negativou = ficaNegativo.has(Number(passo.insumo_id));
    const notaDaLinha = negativou && justificativaNegativo
      ? `${nota} · Saldo negativo autorizado: ${justificativaNegativo}`
      : nota;
    try {
      await aplicar(passo.insumo_id, quantidade, usuarioId, {
        origem: 'manual',
        estoqueMovimentoId: movimentoDaPecaId,
        nota: notaDaLinha
      });
      await registrarMovimento(razaoPeloPool, {
        tipoMovimento: direcao === 'entrada' ? MOV.ENTRADA : MOV.CONSUMO_INSUMO,
        tipoItem: ITEM.INSUMO,
        itemId: passo.insumo_id,
        quantidade,
        loteId,
        ultimoInsumoId: passo.insumo_id,
        // O mesmo vínculo no razão: a baixa aponta para o movimento da peça.
        movimentoOrigemId: movimentoDaPecaId,
        // Só onde o saldo REALMENTE fechou negativo. Marcar todos diria que
        // houve decisão de negativar onde não houve — e a coluna existe
        // justamente para separar uma coisa da outra.
        saldoNegativoAutorizado: negativou ? Boolean(justificativaNegativo) : null,
        nota: notaDaLinha,
        usuarioId
      });
      insumos += 1;
    } catch (err) {
      // Uma falha aqui não desfaz a peça que já entrou no estoque — mas tem de
      // aparecer, senão o saldo de matéria-prima fica errado em silêncio.
      falhas.push(`Insumo ${passo.insumo_id}: ${err?.message || err}`);
    }
  };

  // ---------------------------------------------------------------------
  // EM BLOCOS, não um a um.
  //
  // Cada insumo custa quatro idas à API (ler saldo, gravar saldo, histórico da
  // matéria-prima, razão). Numa rota de quinze passos são sessenta requisições
  // — e em fila indiana elas seguravam TODO o resto do app enquanto rodavam.
  //
  // Insumos diferentes são linhas diferentes, então tratá-los ao mesmo tempo é
  // seguro. O MESMO insumo repetido na rota é que não pode: seriam duas
  // leituras do mesmo saldo, e a segunda gravação apagaria a primeira. Nesse
  // caso (raro) a fila indiana continua, que é o único jeito de a conta fechar.
  const ids = aTratar.map(p => Number(p.insumo_id));
  const insumoRepetido = new Set(ids).size !== ids.length;
  const porVez = insumoRepetido ? 1 : 4;

  for (let i = 0; i < aTratar.length; i += porVez) {
    await Promise.all(aTratar.slice(i, i + porVez).map(tratar));
  }

  return { insumos, falhas };
}

/** Lê o lote antes de mexer: o razão precisa saber de qual peça se trata. */
async function lerLote(id) {
  try {
    const lote = await pool.get(`${LOTES_ENDPOINT}/${id}`);
    return lote && !lote.error ? lote : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {number|null} usuarioId  quem fez. Vem do IPC, que conhece a sessão.
 *   Sem ele o movimento ia para o razão com `created_by` vazio: dava para ver
 *   que o estoque mudou à mão, e não QUEM mudou — justamente a pergunta que um
 *   ajuste manual levanta.
 */
async function inserirLoteProduto({
  produtoId,
  etapa,
  ultimoInsumoId,
  quantidade,
  usuarioId = null,
  // Quem registra decide: a peça foi PRODUZIDA agora (e o insumo sai do
  // estoque) ou só está sendo lançada (correção, devolução, compra pronta)?
  abaterInsumos = false,
  // Escrita na tela quando algum insumo fecha negativo.
  justificativaNegativo = null
}) {
  const criado = await executarLotes('post', '', {
    produto_id: produtoId,
    etapa_id: etapa,
    ultimo_insumo_id: ultimoInsumoId,
    quantidade: paraDecimal(quantidade),
    data_hora_completa: new Date().toISOString()
  });
  invalidarCacheLotes();

  // Peça entrando no estoque pela tela de Produtos. O razão registra POR PEÇA:
  // sem isso, o estoque muda e não sobra rastro de quem colocou nem quando.
  //
  // O id volta e é guardado: é ele que liga cada consumo de insumo a ESTA peça,
  // com quantidade e ponto da rota.
  const movimentoDaPecaId = await registrarMovimento(razaoPeloPool, {
    tipoMovimento: MOV.ENTRADA,
    tipoItem: ITEM.PECA,
    itemId: produtoId,
    quantidade: paraDecimal(quantidade),
    loteId: criado?.id ?? null,
    ultimoInsumoId,
    nota: abaterInsumos
      ? 'Entrada pelo módulo de Produtos (matéria-prima abatida)'
      : 'Entrada pelo módulo de Produtos (sem abater matéria-prima)',
    usuarioId
  });

  const insumos = abaterInsumos
    ? await movimentarInsumosDaPeca({
      produtoId,
      ultimoInsumoId,
      unidades: quantidade,
      direcao: 'saida',
      loteId: criado?.id ?? null,
      movimentoDaPecaId,
      justificativaNegativo,
      usuarioId,
      nota: 'Consumido para a peça lançada no estoque pelo módulo de Produtos'
    })
    : { insumos: 0, falhas: [] };

  return { ...criado, insumosMovimentados: insumos.insumos, falhasInsumos: insumos.falhas };
}

/**
 * Atualiza um lote (quantidade + data)
 */
async function atualizarLoteProduto(
  id,
  quantidade,
  usuarioId = null,
  { ajustarInsumos = false, justificativaNegativo = null } = {}
) {
  // A diferença é o que interessa ao razão: subiu ou desceu, e quanto.
  const antes = await lerLote(id);
  const anterior = Number(antes?.quantidade) || 0;
  const nova = Number(paraDecimal(quantidade)) || 0;

  const atualizado = await executarLotes('put', `/${id}`, {
    quantidade: paraDecimal(quantidade),
    data_hora_completa: new Date().toISOString()
  });
  invalidarCacheLotes();

  const diferenca = Number(paraDecimal(nova - anterior)) || 0;
  let insumos = { insumos: 0, falhas: [] };

  if (diferenca !== 0) {
    const abateu = ajustarInsumos ? ' · matéria-prima ajustada' : '';
    const movimentoDaPecaId = await registrarMovimento(razaoPeloPool, {
      tipoMovimento: diferenca > 0 ? MOV.ENTRADA : MOV.SAIDA,
      tipoItem: ITEM.PECA,
      itemId: antes?.produto_id ?? null,
      quantidade: Math.abs(diferenca),
      loteId: id,
      ultimoInsumoId: antes?.ultimo_insumo_id ?? null,
      nota: `Ajuste pelo módulo de Produtos (${anterior} → ${nova})${abateu}`,
      usuarioId
    });

    // Subiu = peças a mais, que alguém produziu: o insumo sai. Desceu = peças
    // que deixaram de existir: o insumo volta. As duas direções são a mesma
    // pergunta, feita na tela antes de confirmar.
    if (ajustarInsumos && antes?.produto_id) {
      insumos = await movimentarInsumosDaPeca({
        produtoId: antes.produto_id,
        ultimoInsumoId: antes.ultimo_insumo_id,
        unidades: Math.abs(diferenca),
        direcao: diferenca > 0 ? 'saida' : 'entrada',
        loteId: id,
        movimentoDaPecaId,
        justificativaNegativo,
        usuarioId,
        nota: diferenca > 0
          ? 'Consumido no ajuste de estoque de peças pelo módulo de Produtos'
          : 'Devolvido no ajuste de estoque de peças pelo módulo de Produtos'
      });
    }
  }

  return { ...atualizado, insumosMovimentados: insumos.insumos, falhasInsumos: insumos.falhas };
}

async function excluirLoteProduto(
  id,
  usuarioId = null,
  { devolverInsumos = false, justificativaNegativo = null } = {}
) {
  // Lido ANTES de excluir: depois não há mais de onde tirar a identidade.
  const antes = await lerLote(id);
  const quantidade = Number(antes?.quantidade) || 0;
  await executarLotes('delete', `/${id}`);
  invalidarCacheLotes();

  const movimentoDaPecaId = await registrarMovimento(razaoPeloPool, {
    tipoMovimento: MOV.SAIDA,
    tipoItem: ITEM.PECA,
    itemId: antes?.produto_id ?? null,
    quantidade,
    loteId: id,
    ultimoInsumoId: antes?.ultimo_insumo_id ?? null,
    nota: devolverInsumos
      ? 'Lote excluído pelo módulo de Produtos (matéria-prima devolvida)'
      : 'Lote excluído pelo módulo de Produtos (sem devolver matéria-prima)',
    usuarioId
  });

  // As peças deixaram de existir. Se elas nunca chegaram a ser produzidas —
  // lançamento errado, por exemplo —, o material que constava nelas volta.
  const insumos = devolverInsumos && antes?.produto_id
    ? await movimentarInsumosDaPeca({
      produtoId: antes.produto_id,
      ultimoInsumoId: antes.ultimo_insumo_id,
      unidades: quantidade,
      direcao: 'entrada',
      loteId: id,
      movimentoDaPecaId,
      justificativaNegativo,
      usuarioId,
      nota: 'Devolvido na exclusão do lote pelo módulo de Produtos'
    })
    : { insumos: 0, falhas: [] };

  return { insumosMovimentados: insumos.insumos, falhasInsumos: insumos.falhas };
}

/**
 * Salva detalhes do produto (percentuais + itens) em transação
 */

async function salvarProdutoDetalhado(codigoOriginal, produto, itens, produtoId) {
  // Percentuais, preços e quantidades podem chegar como texto: converte para
  // número (aceitando "," como separador) antes de qualquer cálculo ou gravação.
  normalizarCamposNumericos(produto, CAMPOS_NUMERICOS_PRODUTO);
  for (const lista of [itens?.inseridos, itens?.atualizados]) {
    (Array.isArray(lista) ? lista : []).forEach(item =>
      normalizarCamposNumericos(item, CAMPOS_NUMERICOS_ITEM)
    );
  }

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

    // 🔄 Se o código foi alterado, atualizar todos os itens desse produto
    if (codigoAlterado) {
      const itensExistentes = await getFiltrado('/produtos_insumos', {
        select: 'id',
        produto_id: produtoIdNormalizado
      });

      for (const item of itensExistentes) {
        await pool.put(`/produtos_insumos/${item.id}`, {
          produto_codigo: codigoDestino
        });
      }
    }

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
      ordem_insumo: ins.ordem_insumo,
      produto_codigo: codigoDestino,
    });
  }

  // A ROTA mudou: é ela que responde "quais produtos usam este insumo" e
  // "quais insumos este produto tem". Sem derrubar o cache, o popup e a busca
  // continuariam mostrando a composição antiga.
  catalogoCache.invalidar();

  // O preço praticado só se move por decisão explícita ("Atualizar Tabela
  // Fixa"). Um insumo que encareceu muda `preco_venda` acima e para por aí:
  // reprecificar sozinho o que já foi proposto ao cliente seria o pior dos
  // efeitos colaterais.
  let tabelaFixaResultado = null;
  if (produto?.atualizar_tabela_fixa === true) {
    tabelaFixaResultado = await tabelaFixa.gravarPrecoTabela({
      produtoId: produtoIdNormalizado,
      codigo: codigoDestino,
      valor: preco_venda
    });
  }

  return { ok: true, tabelaFixa: tabelaFixaResultado };
}

async function listarColecoes() {
  try {
    const colecoes = await pool.get('/colecao', {
      query: { select: 'nome', order: 'nome.asc' }
    });

    return Array.isArray(colecoes)
      ? colecoes.map(c => normalizarNomeColecao(c?.nome))
      : [];
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

function normalizarNomeColecao(nome) {
  if (typeof nome !== 'string') return '';
  const nomeSemEspacosDuplicados = nome.trim().replace(/\s+/g, ' ');
  if (!nomeSemEspacosDuplicados) return '';

  return nomeSemEspacosDuplicados
    .split(' ')
    .map(parte => {
      if (!parte) return '';
      return parte[0].toLocaleUpperCase('pt-BR') + parte.slice(1).toLocaleLowerCase('pt-BR');
    })
    .join(' ');
}

function chaveNomeColecao(nome) {
  return normalizarNomeColecao(nome).toLocaleLowerCase('pt-BR');
}

function deduplicarColecoesPorNomeNormalizado(nomes = []) {
  const mapa = new Map();

  for (const nome of Array.isArray(nomes) ? nomes : []) {
    const nomeCanonico = normalizarNomeColecao(nome);
    const chave = chaveNomeColecao(nomeCanonico);
    if (!nomeCanonico || !chave || mapa.has(chave)) continue;
    mapa.set(chave, nomeCanonico);
  }

  return [...mapa.values()];
}

async function adicionarColecao(nome) {
  const nomeNormalizado = normalizarNomeColecao(nome);
  if (!nomeNormalizado) return '';

  const colecoesExistentes = await buscarColecoesPersistidas();
  const chaveNovaColecao = chaveNomeColecao(nomeNormalizado);
  const colecaoExistente = colecoesExistentes.find(
    item => chaveNomeColecao(item) === chaveNovaColecao
  );
  if (colecaoExistente) {
    return normalizarNomeColecao(colecaoExistente);
  }

  try {
    const res = await pool.post('/colecao', { nome: nomeNormalizado });
    let colecoesAtualizadas = [];
    try {
      colecoesAtualizadas = await listarColecoes();
    } catch (listErr) {
      console.warn('Coleção adicionada, mas não foi possível atualizar a listagem de coleções:', listErr?.message || listErr);
    }
    return {
      nome: normalizarNomeColecao(res?.nome || nomeNormalizado),
      colecoes: colecoesAtualizadas
    };
  } catch (err) {
    if (err.status === 404) {
      return nomeNormalizado;
    }
    throw err;
  }
}

async function colecaoTemDependencias(nome) {
  const nomeNormalizado = normalizarNomeColecao(nome);
  if (!nomeNormalizado) return false;

  const produtos = await pool.get('/produtos', {
    query: {
      select: 'id',
      categoria: nomeNormalizado,
      limit: 1
    }
  });

  return Array.isArray(produtos) && produtos.length > 0;
}

async function removerColecao(nome) {
  const nomeNormalizado = normalizarNomeColecao(nome);
  if (!nomeNormalizado) return;

  const chave = chaveNomeColecao(nomeNormalizado);

  // 🚫 Verifica se algum produto usa essa coleção
  const produtosComColecao = await getFiltrado('/produtos', {
    select: 'id',
    categoria: nomeNormalizado,
    limit: 1
  });

  if (Array.isArray(produtosComColecao) && produtosComColecao.length > 0) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  // 🔎 Busca coleção pelo nome
  const colecoes = await pool.get('/colecao', {
    query: { select: 'id,nome' }
  });

  const colecao = (Array.isArray(colecoes) ? colecoes : []).find(
    c => chaveNomeColecao(c?.nome) === chave
  );

  if (!colecao?.id) {
    const err = new Error('Coleção não encontrada');
    err.code = 'COLECAO_NAO_ENCONTRADA';
    err.status = 404;
    throw err;
  }

  // 🗑 Delete por ID
  await pool.delete(`/colecao/${colecao.id}`);

  let colecoesAtualizadas = [];
  try {
    colecoesAtualizadas = await listarColecoes();
  } catch (listErr) {
    console.warn('Coleção removida, mas não foi possível atualizar a listagem de coleções:', listErr?.message || listErr);
  }
  return {
    nome: nomeNormalizado,
    colecoes: colecoesAtualizadas
  };

}

async function buscarColecoesPersistidas() {
  try {
    const colecao = await pool.get('/colecao', {
      query: { select: 'nome', order: 'nome' }
    });
    const nomes = Array.isArray(colecao) ? colecao.map(c => c?.nome) : [];
    return deduplicarColecoesPorNomeNormalizado(nomes);
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
    return deduplicarColecoesPorNomeNormalizado(categorias.map(p => p?.categoria));
  } catch (err) {
    if (err.status === 404) {
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Histórico de estoque de UMA peça
//
// O razão (`estoque_movimentos`) guarda tudo em ids: item 215, pedido 64, lote
// 104, usuário 13. Isso serve à máquina e não serve a ninguém que precise
// entender o que aconteceu. Aqui os ids viram nomes, e cada movimento vira uma
// frase: o que foi, de onde veio, quanto, e quem fez.
// ---------------------------------------------------------------------------

/** Como cada tipo de movimento se lê, e se soma ou subtrai do estoque. */
const LEITURA_DO_MOVIMENTO = {
  entrada_estoque: { rotulo: 'Entrada no estoque', sinal: 1 },
  saida_estoque: { rotulo: 'Retirada do estoque', sinal: -1 },
  ajuste_estoque: { rotulo: 'Ajuste de estoque', sinal: 0 },
  consumo_peca_pronta: { rotulo: 'Usada pronta em pedido', sinal: -1 },
  consumo_peca_parcial: { rotulo: 'Usada pela metade em pedido', sinal: -1 },
  retorno_cancelamento: { rotulo: 'Devolvida por cancelamento', sinal: 1 },
  // Descarte também SOMA: a peça volta ao lote de origem como estava. Sem esta
  // entrada o movimento aparecia com o nome cru e efeito "—", como se não
  // tivesse mexido no estoque — e ele mexeu.
  descarte_cancelamento: { rotulo: 'Descartada — lote de origem restaurado', sinal: 1 },
  reserva: { rotulo: 'Reservada para produção', sinal: 0 },
  transferencia: { rotulo: 'Transferida entre pedidos', sinal: 0 },
  cancelamento: { rotulo: 'Cancelamento', sinal: 0 },
  negativa: { rotulo: 'Saldo negativo', sinal: -1 },
  // Vocabulário antigo, de antes de o razão distinguir peça pronta de parcial.
  // Sem estas duas entradas os movimentos gravados antes apareceriam com o nome
  // cru e sem sinal — o histórico começaria mudo justamente na parte velha.
  reversao: { rotulo: 'Estorno', sinal: 1 },
  abatimento: { rotulo: 'Abatimento (registro antigo)', sinal: -1 }
};

async function listarMovimentosProduto(produtoId) {
  const id = Number(produtoId);
  if (!Number.isFinite(id)) return { produto: null, movimentos: [] };

  const [produto, movimentosBrutos] = await Promise.all([
    pool.get(`/produtos/${id}`).catch(() => null),
    pool.get('/estoque_movimentos', { query: { item_id: id, tipo_item: 'peca' } }).catch(() => [])
  ]);

  const movimentos = (Array.isArray(movimentosBrutos) ? movimentosBrutos : [])
    .filter(m => String(m?.tipo_item) === 'peca' && String(m?.item_id) === String(id));

  // UMA leitura por tabela, indexada em memória.
  //
  // A primeira versão buscava linha a linha (`/pedidos/57`, `/usuarios/13`,
  // `/produtos_em_cada_ponto/104`...). Uma peça com 60 movimentos gerava mais de
  // uma centena de requisições EM SÉRIE, e o modal ficava girando sem nunca
  // terminar. As quatro tabelas juntas têm menos linhas que isso.
  const indexar = lista => {
    const mapa = new Map();
    for (const linha of (Array.isArray(lista) ? lista : [])) {
      if (linha?.id !== undefined && linha?.id !== null) mapa.set(Number(linha.id), linha);
    }
    return mapa;
  };

  const [pedidos, usuarios, lotes, insumos] = await Promise.all([
    pool.get('/pedidos').then(indexar).catch(() => new Map()),
    pool.get('/usuarios').then(indexar).catch(() => new Map()),
    pool.get(LOTES_ENDPOINT).then(indexar).catch(() => new Map()),
    pool.get('/materia_prima').then(indexar).catch(() => new Map())
  ]);

  const linhas = movimentos.map(m => {
    const leitura = LEITURA_DO_MOVIMENTO[m.tipo_movimento]
      || { rotulo: m.tipo_movimento || 'Movimento', sinal: 0 };
    const pedido = pedidos.get(Number(m.pedido_id));
    const lote = lotes.get(Number(m.lote_id));
    const insumo = insumos.get(Number(m.ultimo_insumo_id));
    const quantidade = Number(m.quantidade) || 0;

    return {
      id: m.id,
      data: m.created_at || null,
      tipo: m.tipo_movimento,
      descricao: leitura.rotulo,
      // Positivo entrou, negativo saiu. O razão guarda sempre positivo e deixa
      // o sentido no tipo; quem lê um extrato espera o sinal.
      quantidade,
      efeito: leitura.sinal === 0 ? null : leitura.sinal * quantidade,
      origem: pedido
        ? `Pedido ${pedido.numero || pedido.id}`
        : (m.decision_note ? 'Ajuste manual' : 'Módulo de Produtos'),
      pedido_numero: pedido?.numero || null,
      pedido_item_id: m.pedido_item_id || null,
      etapa: lote?.etapa_id || null,
      parou_no_item: insumo?.nome || null,
      observacao: m.decision_note || null,
      saldo_negativo_autorizado: m.saldo_negativo_autorizado === true,
      usuario: usuarios.get(Number(m.created_by))?.nome || null
    };
  });

  // Mais recente primeiro: é a pergunta que se faz primeiro sobre um estoque.
  linhas.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

  // O estoque da peça NÃO é uma coluna de `produtos`: ele é a soma dos lotes em
  // `produtos_em_cada_ponto`, que é o que a grade do módulo mostra. Ler
  // `produto.quantidade` trazia `undefined` e o cabeçalho saía vazio.
  let emEstoque = 0;
  for (const lote of lotes.values()) {
    if (String(lote?.produto_id) === String(id)) emEstoque += Number(lote?.quantidade) || 0;
  }

  return {
    produto: produto && !produto.error
      ? { id: produto.id, codigo: produto.codigo, nome: produto.nome, quantidade: emEstoque }
      : { id, quantidade: emEstoque },
    movimentos: linhas
  };
}

module.exports = {
  listarProdutos,
  listarMovimentosProduto,
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
  // A tela consulta antes de confirmar: é assim que ela mostra quais insumos
  // ficariam negativos e pede aprovação.
  previsaoDeInsumosDaPeca,
  // Exportado para quem mexe em lotes por fora daqui (a conversão de orçamento
  // baixa lotes direto pela API da requisição) poder derrubar o cache também.
  invalidarCacheLotes,
  salvarProdutoDetalhado,
  tabelaFixa,
  listarColecoes,
  adicionarColecao,
  removerColecao,
  colecaoTemDependencias
};
