/**
 * Rateio das comissões entre COLABORADORES, peça a peça (24/09/2026).
 *
 * A comissão de um pedido tem dono por natureza — CMS é do dono do cliente,
 * Royalty é do desenhista da peça. O rateio é outra camada, por cima: de
 * cada PEÇA CONTABILIZADA (uma linha de `pedidos_itens` de um pedido que
 * gerou comissão na competência), o usuário diz quanto por cento vai para
 * cada colaborador.
 *
 * Decisões desta entrega:
 *   - a unidade é a PEÇA, não a parcela nem o pedido: é o que o dono pediu
 *     ("por peça que foi contabilizada"). O valor da peça é a fatia dela na
 *     comissão do pedido, na proporção do valor vendido (a mesma proporção
 *     que o Royalty já usa);
 *   - a soma de cada peça vai até 100% e **nunca passa**: quem cadastra vê o
 *     restante e o sistema recusa o que excede;
 *   - **fechar a competência exige 100% em toda peça contabilizada** — mas
 *     só quando existe colaborador cadastrado. Sem nenhum, o recurso não
 *     está em uso e o Financeiro fecha como sempre fechou (senão a primeira
 *     virada de mês depois de subir o código travaria sozinha);
 *   - remover é desligar (`ativo`), para o rastro não sumir.
 *
 * As contas são puras (testáveis sem rede); as de baixo falam com a API.
 * SQL: sql/comissao_colaboradores_rateio.sql. Sem ele nada quebra: a tela
 * avisa e o fechamento não passa a exigir nada.
 */
const c = require('./comum');
const auditoria = require('./auditoria');

const SQL_ARQUIVO = 'sql/comissao_colaboradores_rateio.sql';
const SQL_FALTANDO = `Falta rodar ${SQL_ARQUIVO} no banco e reiniciar a API.`;
const TABELAS = ['comissao_colaboradores', 'comissao_rateios'];
/** Tudo distribuído. Percentuais são guardados com 4 casas. */
const TOTAL = 100;
const CASAS = 4;
const TOLERANCIA = 0.0001;

const ativo = v => !(v === false || v === 'false' || v === 0 || v === 'f');
const arredondar = v => Math.round((Number(v) + Number.EPSILON) * 10 ** CASAS) / 10 ** CASAS;

function sqlPendente() {
  return c.erro(SQL_FALTANDO, 409, { sql_pendente: true, arquivo: SQL_ARQUIVO });
}

// ------------------------------------------------------------- contas puras

/**
 * O percentual digitado ("12,5", "12.5", 12.5) em número. Devolve null
 * quando não é número. Pura.
 */
function lerPercentual(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).replace('%', '').replace(',', '.').trim();
  const n = Number(texto);
  return Number.isFinite(n) ? arredondar(n) : null;
}

/** Quanto já está distribuído numa peça. Pura. */
function somaDosPercentuais(linhas) {
  return arredondar((linhas || []).filter(l => l && ativo(l.ativo)).reduce((s, l) => s + (Number(l.percentual) || 0), 0));
}

/** Quanto ainda cabe (nunca negativo). Pura. */
function restanteDoRateio(linhas) {
  return arredondar(Math.max(0, TOTAL - somaDosPercentuais(linhas)));
}

/** A peça está 100% distribuída? Pura. */
function rateioCompleto(linhas) {
  return Math.abs(somaDosPercentuais(linhas) - TOTAL) <= TOLERANCIA;
}

/**
 * Pode entrar esta linha? Devolve a mensagem do problema, ou null.
 *
 * `ignorarId` é a própria linha quando se está EDITANDO — senão o percentual
 * dela contaria duas vezes contra o restante.
 * Pura.
 */
function problemaDaLinha({ linhas = [], colaboradorId, percentual, ignorarId = null }) {
  const pct = lerPercentual(percentual);
  if (pct === null) return 'Informe o percentual.';
  if (pct <= 0) return 'O percentual precisa ser maior que zero.';
  if (pct > TOTAL) return 'O percentual não pode passar de 100%.';
  if (colaboradorId === null || colaboradorId === undefined || colaboradorId === '') return 'Escolha o colaborador.';

  const vivas = (linhas || []).filter(l => l && ativo(l.ativo) && String(l.id) !== String(ignorarId));
  if (vivas.some(l => String(l.colaborador_id) === String(colaboradorId))) {
    return 'Este colaborador já está nesta peça. Edite a linha dele em vez de somar outra.';
  }
  const restante = arredondar(Math.max(0, TOTAL - somaDosPercentuais(vivas)));
  if (restante <= TOLERANCIA) return 'Esta peça já está 100% distribuída: não cabe mais ninguém.';
  if (pct - restante > TOLERANCIA) {
    return `Só restam ${formatarPercentual(restante)} para distribuir nesta peça.`;
  }
  return null;
}

/** 12.5 → "12,5%"; 100 → "100%". Pura. */
function formatarPercentual(v) {
  const n = arredondar(Number(v) || 0);
  const texto = Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  return `${texto}%`;
}

/**
 * Reparte um valor entre as linhas do rateio, sem perder centavo: a sobra do
 * arredondamento vai para a maior fatia (a mesma regra do parcelamento). Pura.
 */
function distribuirValor(valor, linhas) {
  const vivas = (linhas || []).filter(l => l && ativo(l.ativo));
  if (!vivas.length) return [];
  const total = c.centavos(valor);
  const partes = vivas.map(l => ({
    colaborador_id: l.colaborador_id ?? null,
    colaborador: l.colaborador || null,
    percentual: arredondar(Number(l.percentual) || 0),
    valor: c.centavos(total * (Number(l.percentual) || 0) / TOTAL)
  }));
  const somaPartes = c.centavos(partes.reduce((s, p) => s + p.valor, 0));
  const sobra = c.centavos(total - somaPartes);
  if (Math.abs(sobra) >= 0.01) {
    const maior = partes.reduce((a, b) => (Math.abs(b.valor) > Math.abs(a.valor) ? b : a), partes[0]);
    maior.valor = c.centavos(maior.valor + sobra);
  }
  return partes;
}

/**
 * A fatia de cada peça na comissão do pedido: proporcional ao valor vendido
 * que continua com o cliente (o devolvido sai), como o Royalty já reparte.
 * Pura.
 *
 * @param {Array} itens linhas de `pedidos_itens` do pedido
 * @returns {Map} pedido_item_id -> { valor, participacao }
 */
function participacaoDasPecas(itens) {
  const linhas = (itens || []).filter(Boolean).map(i => {
    const q = Number(i.quantidade) || 0;
    const devolvida = Math.min(q, Math.max(0, Number(i.quantidade_devolvida) || 0));
    const fica = q - devolvida;
    return { item: i, valor: q > 0 ? (Number(i.valor_total) || 0) * fica / q : 0 };
  });
  // Tudo devolvido: a divisão fica pelo valor vendido (a comissão já vai a zero).
  const usar = linhas.some(l => l.valor > 0) ? linhas : (itens || []).filter(Boolean).map(i => ({ item: i, valor: Number(i.valor_total) || 0 }));
  const total = usar.reduce((s, l) => s + l.valor, 0);
  const mapa = new Map();
  for (const l of usar) {
    mapa.set(String(l.item.id), {
      valor: c.centavos(l.valor),
      participacao: total > 0 ? Math.round((l.valor / total) * 1000000) / 1000000 : 0
    });
  }
  return mapa;
}

/**
 * O estado de cada peça contabilizada: quanto de comissão ela puxa, o que já
 * está distribuído e o que falta. Pura.
 *
 * @param {Array}  p.pecas       { id, pedido_id, produto_id, produto, pedido_numero, cliente, comissao }
 * @param {Array}  p.rateios     linhas de `comissao_rateios` (todas as peças)
 * @param {Array}  p.colaboradores para pôr o nome em cada linha
 */
function estadoDasPecas({ pecas = [], rateios = [], colaboradores = [] }) {
  const nomeDo = new Map((colaboradores || []).filter(Boolean).map(x => [String(x.id), x.nome]));
  const porPeca = new Map();
  for (const r of (rateios || []).filter(x => x && ativo(x.ativo))) {
    const k = String(r.pedido_item_id);
    if (!porPeca.has(k)) porPeca.set(k, []);
    porPeca.get(k).push({
      id: r.id, colaborador_id: r.colaborador_id,
      colaborador: nomeDo.get(String(r.colaborador_id)) || `colaborador ${r.colaborador_id}`,
      percentual: arredondar(Number(r.percentual) || 0),
      observacao: r.observacao || null,
      ativo: true
    });
  }
  return (pecas || []).filter(Boolean).map(peca => {
    const linhas = (porPeca.get(String(peca.id)) || []).sort((a, b) => b.percentual - a.percentual || String(a.colaborador).localeCompare(String(b.colaborador), 'pt-BR'));
    const distribuido = somaDosPercentuais(linhas);
    return {
      ...peca,
      linhas: linhas.map(l => ({ ...l, valor: c.centavos((Number(peca.comissao) || 0) * l.percentual / TOTAL) })),
      distribuido,
      restante: arredondar(Math.max(0, TOTAL - distribuido)),
      completo: Math.abs(distribuido - TOTAL) <= TOLERANCIA
    };
  });
}

/** As peças que ainda não fecham 100%. Pura. */
function pecasPendentes(estado) {
  return (estado || []).filter(p => !p.completo);
}

/**
 * O que cada colaborador tem a receber, somando todas as peças. Pura.
 * Sai ordenado do maior para o menor, como as telas de comissão.
 */
function resumoPorColaborador(estado) {
  const mapa = new Map();
  for (const peca of estado || []) {
    for (const l of peca.linhas || []) {
      const k = String(l.colaborador_id);
      const atual = mapa.get(k) || { colaborador_id: l.colaborador_id, colaborador: l.colaborador, valor: 0, pecas: 0 };
      atual.valor = c.centavos(atual.valor + (Number(l.valor) || 0));
      atual.pecas += 1;
      mapa.set(k, atual);
    }
  }
  return [...mapa.values()].sort((a, b) => b.valor - a.valor || String(a.colaborador).localeCompare(String(b.colaborador), 'pt-BR'));
}

/**
 * O bloqueio do fechamento, se houver. Pura.
 *
 * Só existe quando há colaborador cadastrado: sem nenhum, o rateio não está
 * em uso e o fechamento segue como sempre.
 */
function bloqueioDoFechamento({ estado = [], temColaboradores = false }) {
  if (!temColaboradores) return null;
  const faltando = pecasPendentes(estado);
  if (!faltando.length) return null;
  const exemplos = faltando.slice(0, 3)
    .map(p => `${p.pedido_numero || `pedido ${p.pedido_id}`} · ${p.produto || `peça ${p.produto_id}`} (${formatarPercentual(p.distribuido)} de 100%)`)
    .join('; ');
  return `${c.plural(faltando.length, 'peça contabilizada ainda não foi distribuída', 'peças contabilizadas ainda não foram distribuídas')} entre os colaboradores: ${exemplos}${faltando.length > 3 ? '…' : ''}. Distribua 100% de cada peça em "Regras › Colaboradores" para fechar.`;
}

/**
 * As PEÇAS CONTABILIZADAS de uma competência: as peças dos pedidos que têm
 * comissão apurada, cada uma com a fatia que puxa. Pura.
 *
 * A comissão do pedido na competência (soma dos itens: parcelas, ajustes e
 * saldos) é repartida entre as peças dele na proporção do valor vendido —
 * a mesma proporção que o Royalty usa para achar o desenhista.
 *
 * @param {Array} p.itens        `resumo.itens` da prévia de comissões
 * @param {Array} p.pedidosItens linhas de `pedidos_itens`
 * @param {Array} p.produtos     { id, codigo, nome } para nomear a peça
 */
function pecasContabilizadas({ itens = [], pedidosItens = [], produtos = [] }) {
  const porPedido = new Map();
  for (const i of (itens || []).filter(Boolean)) {
    if (i.pedido_id === null || i.pedido_id === undefined) continue;
    const k = String(i.pedido_id);
    const atual = porPedido.get(k) || { pedido_id: i.pedido_id, pedido_numero: i.pedido || null, cliente: i.cliente || null, comissao: 0 };
    atual.comissao = c.centavos(atual.comissao + (Number(i.total) || 0));
    if (!atual.pedido_numero && i.pedido) atual.pedido_numero = i.pedido;
    if (!atual.cliente && i.cliente) atual.cliente = i.cliente;
    porPedido.set(k, atual);
  }
  const dadosProduto = new Map((produtos || []).filter(Boolean).map(p => [String(p.id), p]));
  const itensPor = new Map();
  for (const i of (pedidosItens || []).filter(Boolean)) {
    const k = String(i.pedido_id);
    if (!itensPor.has(k)) itensPor.set(k, []);
    itensPor.get(k).push(i);
  }

  const pecas = [];
  for (const pedido of porPedido.values()) {
    const doPedido = itensPor.get(String(pedido.pedido_id)) || [];
    if (!doPedido.length) continue;
    const participacoes = participacaoDasPecas(doPedido);
    const fatias = doPedido.map(item => {
      const p = participacoes.get(String(item.id)) || { valor: 0, participacao: 0 };
      const produto = dadosProduto.get(String(item.produto_id)) || null;
      return {
        id: item.id, pedido_id: pedido.pedido_id, pedido_numero: pedido.pedido_numero, cliente: pedido.cliente,
        produto_id: item.produto_id ?? null,
        produto: produto ? [produto.codigo, produto.nome].filter(Boolean).join(' · ') : (item.produto_id ? `peça ${item.produto_id}` : 'peça sem cadastro'),
        quantidade: Number(item.quantidade) || 0,
        valor_vendido: p.valor,
        participacao: p.participacao,
        comissao: c.centavos((Number(pedido.comissao) || 0) * p.participacao),
        comissao_do_pedido: pedido.comissao
      };
    });
    // A sobra de centavo do rateio entre as peças fica na maior.
    const soma = c.centavos(fatias.reduce((s, f) => s + f.comissao, 0));
    const sobra = c.centavos((Number(pedido.comissao) || 0) - soma);
    if (Math.abs(sobra) >= 0.01 && fatias.length) {
      const maior = fatias.reduce((a, b) => (Math.abs(b.comissao) > Math.abs(a.comissao) ? b : a), fatias[0]);
      maior.comissao = c.centavos(maior.comissao + sobra);
    }
    pecas.push(...fatias);
  }
  return pecas.sort((a, b) => String(a.pedido_numero || a.pedido_id).localeCompare(String(b.pedido_numero || b.pedido_id), 'pt-BR')
    || String(a.produto).localeCompare(String(b.produto), 'pt-BR'));
}

// ------------------------------------------------------------------ leitura

/**
 * A tabela desta fase ainda não existe? O `c.tabelaAusente` só conhece as
 * tabelas da fase G, então esta olha pelos nomes de cá.
 */
function tabelaAusente(err) {
  const bruto = `${err?.message || ''} ${err?.body?.error || ''} ${err?.body?.detalhe || ''} ${err?.code || ''}`;
  if (/42P01/.test(bruto)) return true;
  const cita = TABELAS.some(t => bruto.includes(t));
  return cita && (/does not exist|não encontrada|não existe/i.test(bruto) || err?.status === 404);
}

/** Lê uma tabela desta fase; sem o SQL, devolve null (quem chama decide). */
async function lerSePuder(api, tabela, query = {}) {
  try {
    const linhas = c.lista(await api.get(`/api/${tabela}`, { query }));
    return linhas.filter(l => l && Object.entries(query).every(([col, v]) => String(l[col]) === String(v)));
  } catch (e) {
    if (tabelaAusente(e)) return null;
    throw e;
  }
}

/** Os colaboradores vivos, em ordem alfabética. `null` quando falta o SQL. */
async function listarColaboradores(api, { incluirDesligados = false } = {}) {
  const linhas = await lerSePuder(api, 'comissao_colaboradores');
  if (linhas === null) return null;
  return linhas
    .filter(x => incluirDesligados || ativo(x.ativo))
    .map(x => ({
      id: x.id, nome: x.nome, funcao: x.funcao || null, observacao: x.observacao || null, ativo: ativo(x.ativo)
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/** Todos os rateios vivos. `null` quando falta o SQL. */
async function listarRateios(api) {
  const linhas = await lerSePuder(api, 'comissao_rateios');
  if (linhas === null) return null;
  return linhas.filter(x => ativo(x.ativo));
}

/**
 * A visão do rateio de uma competência, pronta para a tela e para o
 * fechamento. Nunca quebra: sem o SQL desta fase devolve `sql_pendente` e
 * nenhum bloqueio.
 *
 * @param {Array} itens `resumo.itens` da prévia de comissões
 */
async function lerVisao({ api, itens = [] }) {
  const [colaboradores, rateios] = await Promise.all([listarColaboradores(api), listarRateios(api)]);
  if (colaboradores === null || rateios === null) {
    return { sql_pendente: true, arquivo: SQL_ARQUIVO, colaboradores: [], pecas: [], resumo: [], pendentes: 0, bloqueio: null, total: 0 };
  }
  const idsPedidos = [...new Set((itens || []).map(i => i?.pedido_id).filter(v => v !== null && v !== undefined).map(String))];
  const [pedidosItens, produtos] = await Promise.all([
    api.get('/api/pedidos_itens').then(c.lista).catch(() => []),
    api.get('/api/produtos', { query: { select: 'id,codigo,nome' } }).then(c.lista).catch(() => [])
  ]);
  const pecas = pecasContabilizadas({
    itens,
    pedidosItens: pedidosItens.filter(i => idsPedidos.includes(String(i?.pedido_id))),
    produtos
  });
  const estado = estadoDasPecas({ pecas, rateios, colaboradores });
  const pendentes = pecasPendentes(estado);
  return {
    sql_pendente: false,
    colaboradores,
    pecas: estado,
    resumo: resumoPorColaborador(estado),
    pendentes: pendentes.length,
    total: c.centavos(estado.reduce((s, p) => s + (Number(p.comissao) || 0), 0)),
    bloqueio: bloqueioDoFechamento({ estado, temColaboradores: colaboradores.length > 0 })
  };
}

// ------------------------------------------------------------ colaboradores

async function salvarColaborador({ api, dados = {}, usuarioId = null }) {
  const existentes = await listarColaboradores(api, { incluirDesligados: true });
  if (existentes === null) throw sqlPendente();
  const nome = c.texto(dados.nome, 120);
  if (nome.length < 2) throw c.erro('Informe o nome do colaborador.');
  const id = dados.id ?? null;
  const repetido = existentes.find(x => x.ativo && String(x.id) !== String(id)
    && String(x.nome).trim().toLowerCase() === nome.toLowerCase());
  if (repetido) throw c.erro(`Já existe um colaborador chamado "${repetido.nome}".`, 409);

  const campos = {
    nome, funcao: c.texto(dados.funcao, 80) || null, observacao: c.texto(dados.observacao, 300) || null
  };
  if (id) {
    const vivo = dados.ativo === undefined ? true : ativo(dados.ativo);
    await c.atualizar(api, 'comissao_colaboradores', id, {
      ...campos, ativo: vivo, atualizado_por: usuarioId, atualizado_em: c.agora()
    });
    await auditoria.registrar(api, { tipo: 'colaborador_editado', descricao: `Colaborador "${nome}" atualizado.`, usuarioId }).catch(() => {});
    return { colaborador: { id, ...campos, ativo: vivo } };
  }
  const criado = await c.inserir(api, 'comissao_colaboradores', {
    ...campos, ativo: true, criado_por: usuarioId, criado_em: c.agora()
  });
  await auditoria.registrar(api, { tipo: 'colaborador_criado', descricao: `Colaborador "${nome}" cadastrado.`, usuarioId }).catch(() => {});
  return { colaborador: criado };
}

/**
 * Desliga um colaborador. As peças em que ele aparece perdem a parte dele —
 * e voltam a ficar incompletas —, então o rateio dele sai junto: deixar linha
 * viva apontando para quem não existe mais é pior que refazer a distribuição.
 */
async function removerColaborador({ api, id, usuarioId = null }) {
  const colaboradores = await listarColaboradores(api, { incluirDesligados: true });
  if (colaboradores === null) throw sqlPendente();
  const alvo = colaboradores.find(x => String(x.id) === String(id));
  if (!alvo) throw c.erro('Colaborador não encontrado.', 404);

  const rateios = (await listarRateios(api)) || [];
  const dele = rateios.filter(r => String(r.colaborador_id) === String(id));
  const quando = c.agora();
  for (const r of dele) {
    await c.atualizar(api, 'comissao_rateios', r.id, { ativo: false, removido_por: usuarioId, removido_em: quando });
  }
  await c.atualizar(api, 'comissao_colaboradores', id, { ativo: false, atualizado_por: usuarioId, atualizado_em: quando });
  await auditoria.registrar(api, {
    tipo: 'colaborador_desligado',
    descricao: `Colaborador "${alvo.nome}" desligado${dele.length ? ` (saiu de ${c.plural(dele.length, 'peça', 'peças')})` : ''}.`,
    usuarioId
  }).catch(() => {});
  return { ok: true, pecas_afetadas: dele.length };
}

// ------------------------------------------------------------------ rateio

async function salvarLinha({ api, dados = {}, usuarioId = null }) {
  const rateios = await listarRateios(api);
  if (rateios === null) throw sqlPendente();
  const colaboradores = (await listarColaboradores(api)) || [];

  const pedidoItemId = Number(dados.pedido_item_id);
  if (!Number.isInteger(pedidoItemId) || pedidoItemId <= 0) throw c.erro('Peça inválida.');
  const colaboradorId = Number(dados.colaborador_id);
  if (!colaboradores.some(x => Number(x.id) === colaboradorId)) throw c.erro('Escolha um colaborador ativo.');

  const daPeca = rateios.filter(r => String(r.pedido_item_id) === String(pedidoItemId));
  const problema = problemaDaLinha({
    linhas: daPeca, colaboradorId, percentual: dados.percentual, ignorarId: dados.id ?? null
  });
  if (problema) throw c.erro(problema, 422, { restante: restanteDoRateio(daPeca.filter(l => String(l.id) !== String(dados.id ?? null))) });

  const percentual = lerPercentual(dados.percentual);
  const campos = {
    pedido_id: Number(dados.pedido_id) || null,
    pedido_item_id: pedidoItemId,
    produto_id: dados.produto_id === null || dados.produto_id === undefined ? null : Number(dados.produto_id),
    colaborador_id: colaboradorId,
    percentual,
    observacao: c.texto(dados.observacao, 200) || null
  };
  const nome = colaboradores.find(x => Number(x.id) === colaboradorId)?.nome || `colaborador ${colaboradorId}`;
  if (dados.id) {
    await c.atualizar(api, 'comissao_rateios', dados.id, campos);
    await auditoria.registrar(api, { tipo: 'rateio_editado', descricao: `Rateio da peça ${pedidoItemId}: ${nome} passou a ${formatarPercentual(percentual)}.`, usuarioId }).catch(() => {});
    return { linha: { id: dados.id, ...campos, ativo: true, colaborador: nome } };
  }
  const criada = await c.inserir(api, 'comissao_rateios', { ...campos, ativo: true, criado_por: usuarioId, criado_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'rateio_criado', descricao: `Rateio da peça ${pedidoItemId}: ${formatarPercentual(percentual)} para ${nome}.`, usuarioId }).catch(() => {});
  return { linha: criada };
}

async function removerLinha({ api, id, usuarioId = null }) {
  const rateios = await listarRateios(api);
  if (rateios === null) throw sqlPendente();
  const alvo = rateios.find(r => String(r.id) === String(id));
  if (!alvo) throw c.erro('Linha do rateio não encontrada.', 404);
  await c.atualizar(api, 'comissao_rateios', id, { ativo: false, removido_por: usuarioId, removido_em: c.agora() });
  await auditoria.registrar(api, { tipo: 'rateio_removido', descricao: `Rateio da peça ${alvo.pedido_item_id} sem a parte de ${formatarPercentual(alvo.percentual)}.`, usuarioId }).catch(() => {});
  return { ok: true };
}

module.exports = {
  SQL_ARQUIVO, SQL_FALTANDO, TABELAS, TOTAL, TOLERANCIA,
  lerPercentual, formatarPercentual, somaDosPercentuais, restanteDoRateio, rateioCompleto,
  problemaDaLinha, distribuirValor, participacaoDasPecas, pecasContabilizadas, estadoDasPecas, pecasPendentes,
  resumoPorColaborador, bloqueioDoFechamento,
  tabelaAusente, lerVisao, listarColaboradores, listarRateios, salvarColaborador, removerColaborador, salvarLinha, removerLinha
};
