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

  // Duas leituras independentes, em paralelo — encadeá-las dobrava a espera
  // antes de o salvamento sequer começar.
  //
  // `anterior` é como o insumo estava ANTES. A edição mexe em quantidade e
  // preço e não deixava rastro nenhum: o histórico só conhecia as baixas por
  // pedido, então um insumo podia ir de 1000 para 10 pela tela sem uma linha
  // sequer dizendo quem fez, quando, e de quanto para quanto.
  const [anterior, existente] = await Promise.all([
    fetchSingle('materia_prima', { id, select: 'id,quantidade,preco_unitario' }),
    fetchSingle('materia_prima', { nome, select: 'id,nome' })
  ]);
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
  realocacaoId = null,
  observacao = null
}) {
  if (!insumoId || !tipo) return;
  try {
    // `pedido_id` e `observacao` só existem depois de sql/novascolunas4.sql, e
    // `realocacao_id` depois de sql/novascolunas5.sql. A API monta o INSERT a
    // partir das colunas que a tabela realmente tem e ignora o resto, então
    // mandar antes da hora não quebra nada — passa a gravar sozinho quando as
    // colunas existirem (e a API for reiniciada).
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
      // Qual SUBSTITUIÇÃO devolveu este insumo. Com duas realocações para o
      // mesmo pedido de destino, `pedido_id` sozinho não separa os estornos.
      realocacao_id: realocacaoId,
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
    realocacaoId: contexto?.realocacaoId ?? null,
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

/**
 * Recalcula o preço dos produtos que usam um insumo.
 *
 * CUSTO: esta função é a parte cara de salvar um insumo, e era ela que fazia a
 * tela parecer travada. A versão anterior lia, POR PRODUTO, a tabela inteira de
 * matéria-prima, os dados do produto e os itens dele — três idas à API para cada
 * um, em série. Um insumo usado em 40 produtos custava mais de 120 requisições
 * enfileiradas; numa API remota isso são dezenas de segundos com o modal parado
 * e o banco já gravado.
 *
 * Agora são TRÊS leituras no total, e as gravações vão em paralelo (com limite,
 * para não afogar a API).
 */
const GRAVACOES_SIMULTANEAS = 6;

async function atualizarProdutosComInsumo(insumoId) {
  // As três leituras de uma vez: preços, rotas e produtos. Nenhuma depende das
  // outras, então não há motivo para esperar uma para começar a seguinte.
  const [materias, todasAsRotas, todosOsProdutos] = await Promise.all([
    getFiltrado('/materia_prima', { select: 'id,preco_unitario' }),
    getFiltrado('/produtos_insumos', { select: 'produto_id,insumo_id,quantidade' }),
    getFiltrado('/produtos', {
      select: 'id,codigo,pct_fabricacao,pct_acabamento,pct_montagem,pct_embalagem,pct_markup,pct_comissao,pct_imposto'
    })
  ]);

  const precoPorMateria = new Map();
  for (const materia of (Array.isArray(materias) ? materias : [])) {
    const materiaId = Number(materia?.id);
    if (Number.isFinite(materiaId)) precoPorMateria.set(materiaId, Number(materia?.preco_unitario) || 0);
  }

  const itensPorProduto = new Map();
  const produtosAfetados = new Set();
  for (const linha of (Array.isArray(todasAsRotas) ? todasAsRotas : [])) {
    const produtoId = Number(linha?.produto_id);
    if (!Number.isFinite(produtoId)) continue;
    if (!itensPorProduto.has(produtoId)) itensPorProduto.set(produtoId, []);
    itensPorProduto.get(produtoId).push(linha);
    if (String(linha?.insumo_id) === String(insumoId)) produtosAfetados.add(produtoId);
  }

  const produtoPorId = new Map();
  for (const produto of (Array.isArray(todosOsProdutos) ? todosOsProdutos : [])) {
    const produtoId = Number(produto?.id);
    if (Number.isFinite(produtoId)) produtoPorId.set(produtoId, produto);
  }

  const gravacoes = [];
  for (const produtoId of produtosAfetados) {
    const produto = produtoPorId.get(produtoId);
    if (!produto?.id) continue;

    const itens = itensPorProduto.get(produtoId) || [];
    const base = itens.reduce((acc, item) => {
      const quantidade = Number(item?.quantidade) || 0;
      return acc + quantidade * (precoPorMateria.get(Number(item?.insumo_id)) || 0);
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

    gravacoes.push(() => pool.put(`/produtos/${produto.id}`, {
      preco_base: base,
      preco_venda: valorVenda,
      data: new Date().toISOString()
    }));
  }

  // Em lotes: tudo de uma vez afogaria a API com dezenas de PUTs simultâneos.
  for (let i = 0; i < gravacoes.length; i += GRAVACOES_SIMULTANEAS) {
    await Promise.all(gravacoes.slice(i, i + GRAVACOES_SIMULTANEAS).map(fn => fn()));
  }
}

// ---------------------------------------------------------------------------
// Auditoria de UM insumo
//
// Três tabelas falam sobre matéria-prima, e elas NÃO são somáveis:
//
//   materia_prima_movimentacoes  toda alteração de saldo/preço, com o saldo
//                                antes e depois. É o histórico completo.
//   estoque_movimentos           só o consumo por conversão de pedido, mas com
//                                o pedido, a peça e a reserva. É contexto.
//   pedidos_itens_faltantes      o que faltou numa conversão. NÃO é movimento:
//                                nada saiu do estoque por causa dela.
//
// A conversão de um orçamento grava nas DUAS primeiras. Listar as duas seguidas
// mostraria cada baixa duas vezes e dobraria o total. Por isso
// `materia_prima_movimentacoes` é a espinha (uma linha por evento) e o razão
// entra só para ENRIQUECER a linha correspondente — nunca como linha própria.
//
// O pareamento não pode ser feito pela data crua: `criado_em` é `timestamp` sem
// fuso e `created_at` é `timestamptz`, então o MESMO instante volta das duas com
// horas diferentes. Ver `descobrirDeslocamento`.
// ---------------------------------------------------------------------------

/** Como cada tipo se lê, e se soma ou subtrai do saldo. */
const LEITURA_MP = {
  entrada_manual: { rotulo: 'Entrada manual', sinal: 1 },
  saida_manual: { rotulo: 'Retirada manual', sinal: -1 },
  entrada_pedido: { rotulo: 'Devolvido por cancelamento', sinal: 1 },
  saida_pedido: { rotulo: 'Consumido em pedido', sinal: -1 },
  // O sentido do ajuste NÃO cabe numa constante: depende de para onde o saldo
  // foi. Ver `lerAjuste`.
  ajuste_quantidade: { rotulo: 'Quantidade ajustada na edição', sinal: 0 },
  ajuste_preco: { rotulo: 'Preço alterado', sinal: 0 },
  cadastro: { rotulo: 'Insumo cadastrado', sinal: 1 },
  exclusao: { rotulo: 'Insumo excluído', sinal: -1 },
  // Vocabulário antigo, de antes de os tipos serem específicos. Sem estas duas
  // o histórico começaria mudo justamente na parte mais velha.
  entrada: { rotulo: 'Entrada (registro antigo)', sinal: 1 },
  saida: { rotulo: 'Saída (registro antigo)', sinal: -1 },
  preco: { rotulo: 'Preço alterado (registro antigo)', sinal: 0 }
};

/**
 * Um ajuste manual é entrada ou saída conforme o saldo tenha subido ou descido.
 *
 * Antes ele saía sem sinal ("—") e ficava de fora dos totais: corrigir 100 para
 * 1.000.000 pela tela não aparecia como entrada em lugar nenhum, e o resumo
 * dizia "total que entrou: 0" num insumo que tinha acabado de ganhar um milhão.
 */
function lerAjuste(movimento, leituraPadrao) {
  const antes = Number(movimento?.quantidade_anterior);
  const depois = Number(movimento?.quantidade_atual);
  if (!Number.isFinite(antes) || !Number.isFinite(depois) || antes === depois) {
    return leituraPadrao;
  }
  return depois > antes
    ? { rotulo: 'Entrada por ajuste manual', sinal: 1 }
    : { rotulo: 'Saída por ajuste manual', sinal: -1 };
}

function instante(valor) {
  const t = new Date(valor).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Descobre o deslocamento sistemático entre as duas tabelas.
 *
 * `criado_em` (sem fuso) e `created_at` (com fuso) descrevem o mesmo instante e
 * voltam com uma diferença FIXA — o fuso do servidor. Em vez de fixar "-3h" no
 * código (que quebraria no horário de verão ou noutro servidor), o deslocamento
 * é medido: entre os pares de mesma quantidade, a diferença que mais se repete
 * é o fuso. Com ele, o pareamento fica exato.
 */
function descobrirDeslocamento(movimentosDoRazao, movimentosDoInsumo) {
  const contagem = new Map();
  for (const razao of movimentosDoRazao) {
    const tRazao = instante(razao.created_at);
    if (tRazao === null) continue;
    for (const mp of movimentosDoInsumo) {
      if (Number(mp.quantidade) !== Number(razao.quantidade)) continue;
      const tMp = instante(mp.criado_em);
      if (tMp === null) continue;
      // Arredondado ao minuto: os dois registros são gravados com alguns
      // milissegundos de diferença, e o que importa é o degrau de fuso.
      const passo = Math.round((tRazao - tMp) / 60000) * 60000;
      contagem.set(passo, (contagem.get(passo) || 0) + 1);
    }
  }

  let melhor = 0;
  let maior = 0;
  for (const [passo, vezes] of contagem.entries()) {
    if (vezes > maior) { maior = vezes; melhor = passo; }
  }
  return melhor;
}

/** Tolerância do pareamento depois de corrigido o fuso. */
const JANELA_PAREAMENTO_MS = 10000;

async function listarMovimentosInsumo(insumoId) {
  const id = Number(insumoId);
  if (!Number.isFinite(id)) return { insumo: null, movimentos: [], faltas: [] };

  const [insumo, historico, razaoBruto, faltasBrutas, usuariosBrutos, pedidosBrutos, itensBrutos] = await Promise.all([
    pool.get(`/materia_prima/${id}`).catch(() => null),
    pool.get('/materia_prima_movimentacoes', { query: { insumo_id: id } }).catch(() => []),
    // `tipo_item: 'insumo'` é obrigatório: `estoque_movimentos` guarda PEÇA e
    // INSUMO na mesma tabela, e o `item_id` de uma peça pode coincidir com o de
    // um insumo. Sem o filtro, o histórico de um insumo mostraria movimentos de
    // uma peça que só compartilha o número.
    pool.get('/estoque_movimentos', { query: { item_id: id, tipo_item: 'insumo' } }).catch(() => []),
    pool.get('/pedidos_itens_faltantes', { query: { insumo_id: id } }).catch(() => []),
    pool.get('/usuarios').catch(() => []),
    pool.get('/pedidos').catch(() => []),
    // Para dizer QUAL PEÇA daquele pedido consumiu o insumo. Uma leitura só,
    // indexada em memória — buscar item a item seria uma requisição por linha.
    pool.get('/pedidos_itens').catch(() => [])
  ]);

  const doInsumo = (Array.isArray(historico) ? historico : [])
    .filter(m => String(m?.insumo_id) === String(id));
  const doRazao = (Array.isArray(razaoBruto) ? razaoBruto : [])
    .filter(m => String(m?.tipo_item) === 'insumo' && String(m?.item_id) === String(id));

  const indexar = lista => {
    const mapa = new Map();
    for (const linha of (Array.isArray(lista) ? lista : [])) {
      if (linha?.id !== undefined && linha?.id !== null) mapa.set(Number(linha.id), linha);
    }
    return mapa;
  };
  const usuarios = indexar(usuariosBrutos);
  const pedidos = indexar(pedidosBrutos);
  const itensDePedido = indexar(itensBrutos);

  // ---------------------------------------------------------------
  // Pareamento: qual linha do razão descreve qual linha do histórico
  // ---------------------------------------------------------------
  const deslocamento = descobrirDeslocamento(doRazao, doInsumo);
  const razaoDisponivel = doRazao.slice();
  const contextoPorMovimento = new Map();

  for (const mp of doInsumo) {
    const tMp = instante(mp.criado_em);
    if (tMp === null) continue;

    let melhorIndice = -1;
    let melhorDistancia = Infinity;
    for (let i = 0; i < razaoDisponivel.length; i++) {
      const razao = razaoDisponivel[i];
      if (Number(razao.quantidade) !== Number(mp.quantidade)) continue;
      const tRazao = instante(razao.created_at);
      if (tRazao === null) continue;
      const distancia = Math.abs((tRazao - deslocamento) - tMp);
      if (distancia < melhorDistancia) { melhorDistancia = distancia; melhorIndice = i; }
    }

    if (melhorIndice >= 0 && melhorDistancia <= JANELA_PAREAMENTO_MS) {
      // Sai da lista: cada linha do razão explica UMA linha do histórico. Sem
      // isso, duas baixas iguais no mesmo pedido apontariam para a mesma origem.
      contextoPorMovimento.set(mp.id, razaoDisponivel.splice(melhorIndice, 1)[0]);
    }
  }

  // Peças por pedido, para o caso de o movimento antigo não dizer qual foi.
  const itensPorPedido = new Map();
  for (const item of itensDePedido.values()) {
    const pedidoId = Number(item?.pedido_id);
    if (!Number.isFinite(pedidoId)) continue;
    if (!itensPorPedido.has(pedidoId)) itensPorPedido.set(pedidoId, []);
    itensPorPedido.get(pedidoId).push(item);
  }

  /**
   * Só o código da peça: o nome completo não caberia na folha.
   *
   * Movimentos gravados antes do registro por peça não têm `pedido_item_id`.
   * Quando o pedido tem UMA peça só, não há dúvida de para onde o insumo foi —
   * então o código é resolvido pelo pedido. Com duas ou mais, fica em branco:
   * num relatório de auditoria, chutar é pior que admitir que não se sabe.
   */
  const codigoDaPeca = (pedidoItemId, pedidoId) => {
    const direto = itensDePedido.get(Number(pedidoItemId));
    if (direto) return direto.codigo || direto.nome || `Item ${pedidoItemId}`;

    const doPedido = itensPorPedido.get(Number(pedidoId)) || [];
    if (doPedido.length === 1) {
      const unico = doPedido[0];
      return unico.codigo || unico.nome || `Item ${unico.id}`;
    }
    return null;
  };

  const linhas = doInsumo.map(mp => {
    const padrao = LEITURA_MP[mp.tipo] || { rotulo: mp.tipo || 'Movimento', sinal: 0 };
    const leitura = mp.tipo === 'ajuste_quantidade' ? lerAjuste(mp, padrao) : padrao;
    const contexto = contextoPorMovimento.get(mp.id) || null;
    const pedido = contexto ? pedidos.get(Number(contexto.pedido_id)) : null;
    const quantidade = Number(mp.quantidade) || 0;
    const autor = mp.usuario_id ?? contexto?.created_by ?? null;

    return {
      id: mp.id,
      data: mp.criado_em || null,
      tipo: mp.tipo,
      descricao: leitura.rotulo,
      quantidade,
      // Positivo entrou, negativo saiu. As tabelas guardam sempre positivo e
      // deixam o sentido no tipo; quem lê um extrato espera o sinal.
      efeito: leitura.sinal === 0 ? null : leitura.sinal * quantidade,
      saldo_anterior: mp.quantidade_anterior ?? null,
      saldo_atual: mp.quantidade_atual ?? null,
      preco_anterior: mp.preco_anterior ?? null,
      preco_atual: mp.preco_atual ?? null,
      origem: pedido
        ? `Pedido ${pedido.numero || pedido.id}`
        : (mp.pedido_id ? `Pedido ${mp.pedido_id}` : 'Módulo de Matéria-Prima'),
      pedido_numero: pedido?.numero || null,
      pedido_item_id: contexto?.pedido_item_id || null,
      peca_codigo: codigoDaPeca(contexto?.pedido_item_id, contexto?.pedido_id),
      reserva_id: contexto?.reserva_id || null,
      saldo_negativo_autorizado: contexto?.saldo_negativo_autorizado === true,
      observacao: mp.observacao || contexto?.decision_note || null,
      usuario: usuarios.get(Number(autor))?.nome || null
    };
  });

  // Consumo que está no razão e NÃO tem par no histórico. Não deveria existir —
  // toda baixa passa por `registrarSaida` —, mas se existir é melhor mostrar do
  // que sumir com o registro: é justamente o tipo de buraco que uma auditoria
  // precisa denunciar.
  for (const orfao of razaoDisponivel) {
    const pedido = pedidos.get(Number(orfao.pedido_id));
    const quantidade = Number(orfao.quantidade) || 0;
    linhas.push({
      id: `razao-${orfao.id}`,
      data: orfao.created_at || null,
      tipo: orfao.tipo_movimento,
      descricao: 'Consumido em pedido (sem par no histórico)',
      quantidade,
      efeito: -quantidade,
      saldo_anterior: null,
      saldo_atual: null,
      preco_anterior: null,
      preco_atual: null,
      origem: pedido ? `Pedido ${pedido.numero || pedido.id}` : 'Conversão de pedido',
      pedido_numero: pedido?.numero || null,
      pedido_item_id: orfao.pedido_item_id || null,
      peca_codigo: codigoDaPeca(orfao.pedido_item_id, orfao.pedido_id),
      reserva_id: orfao.reserva_id || null,
      saldo_negativo_autorizado: orfao.saldo_negativo_autorizado === true,
      observacao: orfao.decision_note || null,
      usuario: usuarios.get(Number(orfao.created_by))?.nome || null
    });
  }

  linhas.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

  // Faltas: contexto, não movimento. Ficam numa seção à parte de propósito —
  // somá-las ao extrato inventaria uma saída que nunca houve.
  const faltas = (Array.isArray(faltasBrutas) ? faltasBrutas : [])
    .filter(f => String(f?.insumo_id) === String(id))
    .map(f => {
      const pedido = pedidos.get(Number(f.pedido_id));
      return {
        data: f.criado_em || null,
        pedido: pedido ? (pedido.numero || pedido.id) : f.pedido_id,
        processo: f.processo || '—',
        quantidade: Number(f.quantidade) || 0
      };
    })
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

  return {
    insumo: insumo && !insumo.error
      ? {
        id: insumo.id,
        nome: insumo.nome,
        unidade: insumo.unidade,
        categoria: insumo.categoria,
        processo: insumo.processo,
        quantidade: insumo.quantidade,
        preco_unitario: insumo.preco_unitario
      }
      : { id },
    movimentos: linhas,
    faltas
  };
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
  listarMovimentosInsumo,
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
