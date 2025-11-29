const pool = require('./db');

function aplicarFiltroLocal(lista, filtro) {
  if (!filtro) return lista;
  const normalized = filtro.trim().toLowerCase();

  if (['sim', 's', 'true', 'infinito', 'infinita', '∞'].includes(normalized)) {
    return lista.filter(item => Boolean(item?.infinito));
  }

  if (['nao', 'não', 'n', 'false', 'finito', 'finita'].includes(normalized)) {
    return lista.filter(item => !item?.infinito);
  }

  return lista.filter(item => {
    const alvo = `${item?.nome || ''} ${item?.categoria || ''} ${item?.processo || ''}`.toLowerCase();
    return alvo.includes(normalized);
  });
}

function normalizarValorFiltro(valor) {
  if (Array.isArray(valor)) return valor.map(normalizarValorFiltro);
  if (typeof valor === 'string' && valor.startsWith('eq.')) return valor.slice(3);
  return valor;
}

function separarFiltrosQuery(query = {}) {
  const queryParams = {};
  const filtrosLocais = {};

  for (const [chave, valorOriginal] of Object.entries(query)) {
    if (valorOriginal === undefined || valorOriginal === null) continue;

    if (['select', 'order', 'limit'].includes(chave)) {
      queryParams[chave] = valorOriginal;
      continue;
    }

    const valor = normalizarValorFiltro(valorOriginal);
    queryParams[chave] = valor;
    filtrosLocais[chave] = valor;
  }

  return { queryParams, filtrosLocais };
}

function aplicarFiltrosLocais(lista, filtrosLocais) {
  if (!filtrosLocais || !Object.keys(filtrosLocais).length) return lista;
  return lista.filter(item =>
    Object.entries(filtrosLocais).every(([chave, esperado]) => {
      const valores = Array.isArray(esperado) ? esperado : [esperado];
      if (!valores.length) return true;
      return valores.some(valor => String(item?.[chave]) === String(valor));
    })
  );
}

async function getFiltrado(path, query = {}) {
  const { queryParams, filtrosLocais } = separarFiltrosQuery(query);
  const dados = await pool.get(path, Object.keys(queryParams).length ? { query: queryParams } : undefined);
  const lista = Array.isArray(dados) ? dados : [];
  return aplicarFiltrosLocais(lista, filtrosLocais);
}

async function fetchSingle(table, query) {
  const rows = await getFiltrado(`/${table}`, { ...query, limit: 1 });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function listarMaterias(filtro = '') {
  try {
    const materias = await pool.get('/materia_prima');
    const lista = Array.isArray(materias) ? materias : [];
    const filtrada = aplicarFiltroLocal(lista, filtro);
    return filtrada.sort((a, b) => String(a?.nome || '').localeCompare(String(b?.nome || '')));
  } catch (err) {
    console.error('Erro ao listar materiais:', err.message);
    throw err;
  }
}

async function adicionarMateria(dados) {
  const { nome, quantidade, preco_unitario, categoria, unidade, infinito, processo, descricao } = dados;
  const duplicada = await fetchSingle('materia_prima', { nome, select: 'id,nome' });
  if (duplicada) {
    const err = new Error('DUPLICADO');
    err.code = 'DUPLICADO';
    throw err;
  }

  const payload = {
    nome,
    quantidade,
    preco_unitario,
    categoria,
    unidade,
    infinito,
    processo,
    descricao,
    data_estoque: new Date().toISOString(),
    data_preco: new Date().toISOString()
  };

  return pool.post('/materia_prima', payload);
}

async function atualizarMateria(id, dados) {
  const {
    nome,
    categoria,
    quantidade,
    unidade,
    preco_unitario,
    processo,
    infinito,
    descricao
  } = dados;

  const existente = await fetchSingle('materia_prima', { nome, select: 'id,nome' });
  if (existente && existente.id !== id) {
    const err = new Error('DUPLICADO');
    err.code = 'DUPLICADO';
    throw err;
  }

  const payload = {
    nome,
    categoria,
    quantidade,
    unidade,
    preco_unitario,
    processo,
    infinito,
    descricao,
    data_preco: new Date().toISOString(),
    data_estoque: new Date().toISOString()
  };

  const atualizado = await pool.put(`/materia_prima/${id}`, payload);

  if (preco_unitario !== undefined) {
    await atualizarProdutosComInsumo(id);
  }

  return atualizado;
}

async function excluirMateria(id) {
  await pool.delete(`/materia_prima/${id}`);
}

async function registrarMovimentacao({
  insumoId,
  tipo,
  quantidadeAlterada = null,
  quantidadeAnterior = null,
  quantidadeAtual = null,
  precoAnterior = null,
  precoAtual = null,
  usuarioId = null
}) {
  if (!insumoId || !tipo) return;
  try {
    await pool.post('/materia_prima_movimentacoes', {
      insumo_id: insumoId,
      tipo,
      quantidade: quantidadeAlterada,
      quantidade_anterior: quantidadeAnterior,
      quantidade_atual: quantidadeAtual,
      preco_anterior: precoAnterior,
      preco_atual: precoAtual,
      usuario_id: usuarioId,
      criado_em: new Date().toISOString()
    });
  } catch (err) {
    console.error('Erro ao registrar movimentação de matéria-prima:', err.message);
  }
}

async function registrarEntrada(id, quantidade, usuarioId = null) {
  const materiaAtual = await fetchSingle('materia_prima', {
    id,
    select: 'id,quantidade'
  });
  const quantidadeAnterior = materiaAtual ? Number(materiaAtual.quantidade) || 0 : 0;
  const quantidadeAtual = quantidadeAnterior + (Number(quantidade) || 0);

  const materia = await pool.put(`/materia_prima/${id}`, {
    quantidade: quantidadeAtual,
    data_estoque: new Date().toISOString()
  });

  await registrarMovimentacao({
    insumoId: id,
    tipo: 'entrada',
    quantidadeAlterada: quantidade,
    quantidadeAnterior,
    quantidadeAtual,
    usuarioId
  });

  return materia || null;
}

async function registrarSaida(id, quantidade, usuarioId = null) {
  const materiaAtual = await fetchSingle('materia_prima', {
    id,
    select: 'id,quantidade'
  });
  const quantidadeAnterior = materiaAtual ? Number(materiaAtual.quantidade) || 0 : 0;
  const quantidadeAtual = quantidadeAnterior - (Number(quantidade) || 0);

  const materia = await pool.put(`/materia_prima/${id}`, {
    quantidade: quantidadeAtual,
    data_estoque: new Date().toISOString()
  });

  await registrarMovimentacao({
    insumoId: id,
    tipo: 'saida',
    quantidadeAlterada: quantidade,
    quantidadeAnterior,
    quantidadeAtual,
    usuarioId
  });

  return materia || null;
}

async function atualizarProdutosComInsumo(insumoId) {
  const produtosRelacionados = await getFiltrado('/produtos_insumos', {
    select: 'produto_codigo,insumo_id',
    insumo_id: insumoId
  });

  const codigos = new Set(
    (Array.isArray(produtosRelacionados) ? produtosRelacionados : [])
      .map(r => r?.produto_codigo)
      .filter(Boolean)
  );

  for (const produtoCodigo of codigos) {
    const produto = await fetchSingle('produtos', {
      select:
        'id,codigo,pct_fabricacao,pct_acabamento,pct_montagem,pct_embalagem,pct_markup,pct_comissao,pct_imposto',
      codigo: produtoCodigo
    });

    if (!produto?.id) continue;

    const itens = await getFiltrado('/produtos_insumos', {
      select: 'quantidade,insumo_id',
      produto_codigo: produtoCodigo
    });

    const idsMateria = Array.from(
      new Set((Array.isArray(itens) ? itens : []).map(item => item?.insumo_id).filter(id => id !== undefined && id !== null))
    );
    const materias = await getFiltrado('/materia_prima', {
      select: 'id,preco_unitario',
      id: idsMateria
    });
    const materiaPorId = new Map();
    for (const materia of materias) {
      if (materia?.id === undefined || materia?.id === null) continue;
      materiaPorId.set(Number(materia.id), materia);
    }

    const base = (Array.isArray(itens) ? itens : []).reduce((acc, item) => {
      const quantidade = Number(item?.quantidade) || 0;
      const precoUnitario = Number(materiaPorId.get(Number(item?.insumo_id))?.preco_unitario) || 0;
      return acc + quantidade * precoUnitario;
    }, 0);

    const pctFab = Number(produto.pct_fabricacao) || 0;
    const pctAcab = Number(produto.pct_acabamento) || 0;
    const pctMont = Number(produto.pct_montagem) || 0;
    const pctEmb = Number(produto.pct_embalagem) || 0;
    const pctMarkup = Number(produto.pct_markup) || 0;
    const pctCom = Number(produto.pct_comissao) || 0;
    const pctImp = Number(produto.pct_imposto) || 0;

    const totalMaoObra = base * (pctFab + pctAcab + pctMont + pctEmb) / 100;
    const subTotal = base + totalMaoObra;
    const markupVal = base * (pctMarkup / 100);
    const custoTotal = subTotal + markupVal;
    const denom = 1 - (pctImp + pctCom) / 100;
    const comissaoVal = denom !== 0 ? (pctCom / 100) * (custoTotal / denom) : 0;
    const impostoVal = denom !== 0 ? (pctImp / 100) * (custoTotal / denom) : 0;
    const valorVenda = custoTotal + comissaoVal + impostoVal;

    await pool.put(`/produtos/${produto.id}`, {
      preco_base: base,
      preco_venda: valorVenda,
      data: new Date().toISOString()
    });
  }
}

async function atualizarPreco(id, preco, usuarioId = null) {
  const materiaAtual = await fetchSingle('materia_prima', {
    id,
    select: 'id,preco_unitario'
  });
  const precoAnterior = materiaAtual ? Number(materiaAtual.preco_unitario) || 0 : null;

  const materia = await pool.put(`/materia_prima/${id}`, {
    preco_unitario: preco,
    data_preco: new Date().toISOString()
  });

  const precoAtual = materia ? Number(materia.preco_unitario) || 0 : 0;
  await registrarMovimentacao({
    insumoId: id,
    tipo: 'preco',
    precoAnterior,
    precoAtual,
    usuarioId
  });
  await atualizarProdutosComInsumo(id);
  return materia || null;
}

async function listarCategorias() {
  const categorias = await pool.get('/categoria', {
    query: { select: 'id,nome_categoria', order: 'nome_categoria' }
  });
  const lista = Array.isArray(categorias) ? categorias : [];
  return lista.map(r => r.nome_categoria).filter(Boolean);
}

async function listarUnidades() {
  const unidades = await pool.get('/unidades', {
    query: { select: 'id,tipo', order: 'tipo' }
  });
  const lista = Array.isArray(unidades) ? unidades : [];
  return lista.map(r => r.tipo).filter(Boolean);
}

async function adicionarCategoria(nome) {
  const criado = await pool.post('/categoria', { nome_categoria: nome });
  return criado?.nome_categoria;
}

async function adicionarUnidade(tipo) {
  const criado = await pool.post('/unidades', { tipo });
  return criado?.tipo;
}

async function obterMovimentacoesRecentes({ tipos = null, desde = null, limite = null } = {}) {
  const query = {
    select:
      'id,insumo_id,tipo,quantidade,quantidade_anterior,quantidade_atual,preco_anterior,preco_atual,usuario_id,criado_em',
    order: 'criado_em.desc'
  };

  if (Number.isInteger(limite) && limite > 0) {
    query.limit = limite;
  }

  const registros = await pool.get('/materia_prima_movimentacoes', { query });
  let lista = Array.isArray(registros) ? registros : [];

  if (Array.isArray(tipos) && tipos.length) {
    const setTipos = new Set(tipos.map(t => String(t).toLowerCase()));
    lista = lista.filter(item => setTipos.has(String(item?.tipo || '').toLowerCase()));
  }

  if (desde instanceof Date) {
    const limiteData = desde.getTime();
    lista = lista.filter(item => {
      const ts = item?.criado_em ? new Date(item.criado_em).getTime() : 0;
      return ts >= limiteData;
    });
  }

  return lista;
}

async function removerCategoria(nome) {
  const categoria = await fetchSingle('categoria', {
    nome_categoria: nome,
    select: 'id,nome_categoria'
  });
  if (!categoria) return false;

  const dependente = await fetchSingle('materia_prima', { categoria: nome, select: 'id' });
  if (dependente) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  await pool.delete(`/categoria/${categoria.id}`);
  return true;
}

async function removerUnidade(tipo) {
  const unidade = await fetchSingle('unidades', {
    tipo,
    select: 'id,tipo'
  });
  if (!unidade) return false;

  const dependente = await fetchSingle('materia_prima', { unidade: tipo, select: 'id' });
  if (dependente) {
    const err = new Error('DEPENDENTE');
    err.code = 'DEPENDENTE';
    throw err;
  }

  await pool.delete(`/unidades/${unidade.id}`);
  return true;
}

async function categoriaTemDependencias(nome) {
  const dep = await fetchSingle('materia_prima', { categoria: nome, select: 'id' });
  return Boolean(dep);
}

async function unidadeTemDependencias(tipo) {
  const dep = await fetchSingle('materia_prima', { unidade: tipo, select: 'id' });
  return Boolean(dep);
}

async function processoTemDependencias(nome) {
  const dep = await fetchSingle('materia_prima', { processo: nome, select: 'id' });
  return Boolean(dep);
}

module.exports = {
  listarMaterias,
  adicionarMateria,
  atualizarMateria,
  excluirMateria,
  registrarEntrada,
  registrarSaida,
  atualizarPreco,
  listarCategorias,
  listarUnidades,
  adicionarCategoria,
  adicionarUnidade,
  obterMovimentacoesRecentes,
  removerCategoria,
  removerUnidade,
  categoriaTemDependencias,
  unidadeTemDependencias,
  processoTemDependencias
};
