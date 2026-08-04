const pool = require('./db');
const { normalizarCamposNumericos, paraDecimal } = require('./numeros');

/** Campos que chegam do front como texto e precisam virar número decimal. */
const CAMPOS_NUMERICOS_MATERIA = ['quantidade', 'preco_unitario'];

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

    if (['order', 'limit'].includes(chave)) {
      queryParams[chave] = valorOriginal;
      continue;
    }

    if (chave === 'select') {
      if (typeof valorOriginal === 'string' && valorOriginal.includes(':')) continue;
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

async function adicionarMateria(dados, usuarioId = null) {
  normalizarCamposNumericos(dados, CAMPOS_NUMERICOS_MATERIA);
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

  const criada = await pool.post('/materia_prima', payload);

  // O saldo inicial é a primeira movimentação do insumo. Sem ela o histórico
  // começa do nada e nunca fecha com o estoque.
  await registrarMovimentacao({
    insumoId: criada?.id ?? null,
    tipo: TIPO_MP.CADASTRO,
    quantidadeAlterada: Number(quantidade) || 0,
    quantidadeAnterior: 0,
    quantidadeAtual: Number(quantidade) || 0,
    precoAtual: Number(preco_unitario) || 0,
    usuarioId,
    observacao: 'Insumo cadastrado'
  });

  return criada;
}

async function atualizarMateria(id, dados, usuarioId = null) {
  normalizarCamposNumericos(dados, CAMPOS_NUMERICOS_MATERIA);
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

  // Como estava ANTES. A edição mexe em quantidade e preço e não deixava
  // rastro nenhum: o histórico só conhecia as baixas por pedido, então um
  // insumo podia ir de 1000 para 10 pela tela sem uma linha sequer dizendo
  // quem fez, quando, e de quanto para quanto.
  const anterior = await fetchSingle('materia_prima', {
    id,
    select: 'id,quantidade,preco_unitario'
  });

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

  // Uma linha por coisa que mudou de fato. Editar o nome não gera movimento;
  // mexer na quantidade ou no preço, sim.
  const quantidadeAntes = anterior ? Number(anterior.quantidade) || 0 : null;
  const quantidadeDepois = Number(atualizado?.quantidade ?? quantidade);
  if (
    quantidadeAntes !== null
    && Number.isFinite(quantidadeDepois)
    && arredondarQuatro(quantidadeAntes) !== arredondarQuatro(quantidadeDepois)
  ) {
    await registrarMovimentacao({
      insumoId: id,
      tipo: TIPO_MP.AJUSTE_QUANTIDADE,
      quantidadeAlterada: arredondarQuatro(Math.abs(quantidadeDepois - quantidadeAntes)),
      quantidadeAnterior: quantidadeAntes,
      quantidadeAtual: quantidadeDepois,
      usuarioId,
      observacao: 'Quantidade alterada na edição do insumo'
    });
  }

  const precoAntes = anterior ? Number(anterior.preco_unitario) || 0 : null;
  const precoDepois = Number(atualizado?.preco_unitario ?? preco_unitario);
  if (
    precoAntes !== null
    && Number.isFinite(precoDepois)
    && arredondarQuatro(precoAntes) !== arredondarQuatro(precoDepois)
  ) {
    await registrarMovimentacao({
      insumoId: id,
      tipo: TIPO_MP.AJUSTE_PRECO,
      precoAnterior: precoAntes,
      precoAtual: precoDepois,
      usuarioId,
      observacao: 'Preço alterado na edição do insumo'
    });
  }

  let warning;
  if (preco_unitario !== undefined) {
    try {
      await atualizarProdutosComInsumo(id);
    } catch (err) {
      console.error('Erro ao atualizar produtos com insumo:', err);
      warning = 'Falha ao atualizar produtos relacionados.';
    }
  }

  return warning ? { ...atualizado, warning } : atualizado;
}

async function excluirMateria(id, usuarioId = null) {
  // A movimentação vai ANTES da exclusão: depois o saldo já não existe para
  // ser lido, e a última linha do histórico ficaria sem o número que sumiu.
  const anterior = await fetchSingle('materia_prima', {
    id,
    select: 'id,quantidade,preco_unitario'
  }).catch(() => null);

  await pool.delete(`/materia_prima/${id}`);

  await registrarMovimentacao({
    insumoId: id,
    tipo: TIPO_MP.EXCLUSAO,
    quantidadeAlterada: anterior ? Number(anterior.quantidade) || 0 : null,
    quantidadeAnterior: anterior ? Number(anterior.quantidade) || 0 : null,
    quantidadeAtual: 0,
    precoAnterior: anterior ? Number(anterior.preco_unitario) || 0 : null,
    usuarioId,
    observacao: 'Insumo excluído'
  });
}

/**
 * Vocabulário do histórico da matéria-prima.
 *
 * Antes tudo era "entrada", "saida" ou "preco" — e com isso o histórico não
 * respondia a pergunta que interessa: uma saída de 6 caixas por causa de um
 * pedido ficava idêntica a uma retirada feita à mão, e alterar a quantidade
 * pela tela de edição não deixava rastro nenhum.
 *
 * A tabela não tem coluna de observação nem de pedido (ver sql/novascolunas4.sql);
 * até que tenha, o TIPO é o único lugar que diz de onde a alteração veio.
 */
const TIPO_MP = {
  /** Abatido por conversão de orçamento em pedido. */
  SAIDA_PEDIDO: 'saida_pedido',
  /** Devolvido por cancelamento/estorno de pedido. */
  ENTRADA_PEDIDO: 'entrada_pedido',
  /** Retirada/entrada feita à mão no módulo de Matéria-Prima. */
  SAIDA_MANUAL: 'saida_manual',
  ENTRADA_MANUAL: 'entrada_manual',
  /** Quantidade corrigida na edição do insumo (não é entrada nem saída). */
  AJUSTE_QUANTIDADE: 'ajuste_quantidade',
  /** Preço unitário alterado. */
  AJUSTE_PRECO: 'ajuste_preco',
  /** Insumo criado. */
  CADASTRO: 'cadastro',
  /** Insumo excluído — a última linha antes de ele sumir. */
  EXCLUSAO: 'exclusao'
};

/** 4 casas — a precisão das colunas numéricas. Compara sem ruído de float. */
function arredondarQuatro(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Nome do tipo conforme a origem, para entrada e saída. */
function tipoPorOrigem(direcao, origem) {
  if (origem === 'pedido') {
    return direcao === 'entrada' ? TIPO_MP.ENTRADA_PEDIDO : TIPO_MP.SAIDA_PEDIDO;
  }
  return direcao === 'entrada' ? TIPO_MP.ENTRADA_MANUAL : TIPO_MP.SAIDA_MANUAL;
}

async function registrarMovimentacao({
  insumoId,
  tipo,
  quantidadeAlterada = null,
  quantidadeAnterior = null,
  quantidadeAtual = null,
  precoAnterior = null,
  precoAtual = null,
  usuarioId = null,
  pedidoId = null,
  observacao = null
}) {
  if (!insumoId || !tipo) return;
  try {
    // `pedido_id` e `observacao` só existem depois de sql/novascolunas4.sql. A
    // API monta o INSERT a partir das colunas que a tabela realmente tem e
    // ignora o resto, então mandar antes da hora não quebra nada — passa a
    // gravar sozinho quando as colunas existirem (e a API for reiniciada).
    await pool.post('/materia_prima_movimentacoes', {
      insumo_id: insumoId,
      tipo,
      quantidade: quantidadeAlterada,
      quantidade_anterior: quantidadeAnterior,
      quantidade_atual: quantidadeAtual,
      preco_anterior: precoAnterior,
      preco_atual: precoAtual,
      usuario_id: usuarioId,
      pedido_id: pedidoId,
      observacao,
      criado_em: new Date().toISOString()
    });
  } catch (err) {
    console.error('Erro ao registrar movimentação de matéria-prima:', err.message);
  }
}

/**
 * @param {object} contexto  de onde veio a movimentação:
 *   `{ origem: 'pedido'|'manual', pedidoId, nota }`. O padrão é manual, que é
 *   o caso do próprio módulo de Matéria-Prima.
 */
async function registrarEntrada(id, quantidadeBruta, usuarioId = null, contexto = {}) {
  const quantidade = paraDecimal(quantidadeBruta) ?? 0;
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
    tipo: tipoPorOrigem('entrada', contexto?.origem),
    quantidadeAlterada: quantidade,
    quantidadeAnterior,
    quantidadeAtual,
    usuarioId,
    pedidoId: contexto?.pedidoId ?? null,
    observacao: contexto?.nota ?? null
  });

  return materia || null;
}

async function registrarSaida(id, quantidadeBruta, usuarioId = null, contexto = {}) {
  const quantidade = paraDecimal(quantidadeBruta) ?? 0;
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
    tipo: tipoPorOrigem('saida', contexto?.origem),
    quantidadeAlterada: quantidade,
    quantidadeAnterior,
    quantidadeAtual,
    usuarioId,
    pedidoId: contexto?.pedidoId ?? null,
    observacao: contexto?.nota ?? null
  });

  return materia || null;
}

async function atualizarProdutosComInsumo(insumoId) {
  const produtosRelacionados = await getFiltrado('/produtos_insumos', {
    select: 'produto_id,insumo_id',
    insumo_id: insumoId
  });

  const produtosIds = new Set(
    (Array.isArray(produtosRelacionados) ? produtosRelacionados : [])
      .map(r => r?.produto_id)
      .filter(Boolean)
  );

  // A TABELA INTEIRA de matéria-prima, UMA vez.
  //
  // Esta leitura estava DENTRO do laço abaixo, e ela não depende do produto:
  // um insumo usado em 40 produtos baixava as ~400 linhas de matéria-prima 40
  // vezes. Numa API remota isso são dezenas de segundos com a tela parada — era
  // por isso que salvar um insumo parecia não fazer nada, embora o banco já
  // tivesse gravado: a resposta só voltava muito depois.
  const materias = await getFiltrado('/materia_prima', {
    select: 'id,preco_unitario'
  });
  const precoPorMateria = new Map();
  for (const materia of (Array.isArray(materias) ? materias : [])) {
    const materiaId = Number(materia?.id);
    if (Number.isFinite(materiaId)) precoPorMateria.set(materiaId, materia);
  }

  for (const produtoId of produtosIds) {
    const produto = await fetchSingle('produtos', {
      select:
        'id,codigo,pct_fabricacao,pct_acabamento,pct_montagem,pct_embalagem,pct_markup,pct_comissao,pct_imposto',
      id: produtoId
    });

    if (!produto?.id) continue;

    const itens = await getFiltrado('/produtos_insumos', {
      select: 'quantidade,insumo_id',
      produto_id: produtoId
    });

    const base = (Array.isArray(itens) ? itens : []).reduce((acc, item) => {
      const quantidade = Number(item?.quantidade) || 0;
      const precoUnitario = Number(precoPorMateria.get(Number(item?.insumo_id))?.preco_unitario) || 0;
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

async function atualizarPreco(id, precoBruto, usuarioId = null) {
  const preco = paraDecimal(precoBruto) ?? 0;
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
    tipo: TIPO_MP.AJUSTE_PRECO,
    precoAnterior,
    precoAtual,
    usuarioId,
    observacao: 'Preço atualizado'
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

/**
 * Produtos que consomem um insumo — alimenta a seção "Utilizado em:" do popup
 * de informações da matéria-prima. Retorna `[{ id, codigo, nome }]` sem
 * repetições, ordenado pelo código.
 */
async function listarProdutosPorInsumo(insumoId) {
  const id = Number(insumoId);
  if (!Number.isFinite(id)) return [];

  const vinculos = await getFiltrado('/produtos_insumos', {
    select: 'produto_id,produto_codigo,insumo_id',
    insumo_id: id
  });

  const lista = Array.isArray(vinculos) ? vinculos : [];
  if (!lista.length) return [];

  const produtos = await getFiltrado('/produtos', { select: 'id,codigo,nome' });
  const porId = new Map();
  const porCodigo = new Map();
  for (const produto of Array.isArray(produtos) ? produtos : []) {
    if (produto?.id !== undefined && produto?.id !== null) {
      porId.set(Number(produto.id), produto);
    }
    if (produto?.codigo) {
      porCodigo.set(String(produto.codigo).trim().toLowerCase(), produto);
    }
  }

  // `produtos_insumos` guarda produto_id E produto_codigo. Vínculos antigos
  // podem ter só o código, então a resolução tenta os dois — senão o insumo
  // apareceria como "não utilizado" mesmo estando em uso.
  const encontrados = new Map();
  for (const vinculo of lista) {
    const porIdentificador = porId.get(Number(vinculo?.produto_id));
    const porCodigoVinculo = vinculo?.produto_codigo
      ? porCodigo.get(String(vinculo.produto_codigo).trim().toLowerCase())
      : null;
    const produto = porIdentificador || porCodigoVinculo;
    if (!produto || encontrados.has(produto.id)) continue;
    encontrados.set(produto.id, {
      id: produto.id,
      codigo: produto.codigo ?? null,
      nome: produto.nome ?? null
    });
  }

  return Array.from(encontrados.values()).sort((a, b) =>
    String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true })
  );
}

/**
 * Localiza os insumos realmente vinculados aos produtos cujo nome ou código
 * contém o texto pesquisado. A resolução aceita também vínculos antigos que
 * guardam apenas `produto_codigo`.
 */
async function listarInsumosPorProduto(termo) {
  const busca = String(termo || '').trim().toLowerCase();
  if (!busca) return [];

  const produtos = await getFiltrado('/produtos', { select: 'id,codigo,nome' });
  const encontrados = (Array.isArray(produtos) ? produtos : []).filter(produto =>
    String(produto?.nome || '').toLowerCase().includes(busca) ||
    String(produto?.codigo || '').toLowerCase().includes(busca)
  );
  if (!encontrados.length) return [];

  const ids = new Set(encontrados.map(produto => String(produto.id)));
  const codigos = new Set(
    encontrados
      .map(produto => String(produto?.codigo || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const vinculos = await getFiltrado('/produtos_insumos', {
    select: 'produto_id,produto_codigo,insumo_id'
  });

  return Array.from(new Set(
    (Array.isArray(vinculos) ? vinculos : [])
      .filter(vinculo =>
        ids.has(String(vinculo?.produto_id)) ||
        codigos.has(String(vinculo?.produto_codigo || '').trim().toLowerCase())
      )
      .map(vinculo => Number(vinculo?.insumo_id))
      .filter(Number.isFinite)
  ));
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
  processoTemDependencias,
  listarProdutosPorInsumo,
  listarInsumosPorProduto
};
