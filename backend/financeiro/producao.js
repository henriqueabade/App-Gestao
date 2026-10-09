/**
 * Produção paga por PROCESSO (fase G, refeita com os processos da peça).
 *
 * Cada registro é "N peças do item X finalizadas no processo P no dia D"
 * (`producao_eventos.etapa_id`; os campos `setor_*` das linhas continuam com
 * esse nome e passam a ser o processo). A competência é o mês da
 * finalização; o fechamento congela o valor de cada registro e cada registro
 * entra em um fechamento só (índice único no banco).
 *
 * O VALOR é fiel ao que foi feito (producaoUnidades.js): a regra do processo
 * (R$ por peça ou % do preço da tabela fixa — sempre o valor cheio da tabela)
 * vezes a parte do processo que faltava em cada peça. Peça que saiu do
 * estoque com parte do processo pronta paga só o resto; a que saiu com o
 * processo completo nem entra na conta daquele processo. Processo com o
 * pagamento desligado não paga (e some do Registrar produção).
 *
 * Corrigir: registro ainda não fechado é estornado (sai das contas e devolve
 * as peças); registro já fechado ganha um registro NEGATIVO na data do
 * estorno, com o mesmo valor com que foi fechado — o fechamento antigo não muda.
 *
 * Ajuste por pessoa na produção (ajustesPessoa.js, 06/10/2026): entra como
 * uma linha `tipo_item: 'ajuste'` do processo escolhido, no mês escolhido.
 * Processo que termina o mês negativo leva a diferença para o seguinte — o
 * "Ajuste restante do mês anterior" (`saldosAnteriores` e, nos meses ainda
 * abertos, `restantesProjetados`).
 */
const c = require('./comum');
const regras = require('./regras');
const auditoria = require('./auditoria');
const base = require('./base');
const unidades = require('./producaoUnidades');
const avisos = require('../avisosEnvolvidos');
const ajustesPessoa = require('./ajustesPessoa');
const rateios = require('./rateios');
const mudancasUnidades = require('./mudancasUnidades');
const { estadoDosFechamentos, competenciaAlvo } = require('./comissoes');
const { carregarInsumos, carregarRota, carregarRotas } = require('../cancelamentoEstorno');

const semAcento = unidades.semAcento;
/** Pedidos em que se registra produção (a produção começa antes da NF). */
const SITUACOES_QUE_PRODUZEM = new Set(['aprovado', 'producao', 'enviado', 'entregue']);
const podeProduzir = pedido => SITUACOES_QUE_PRODUZEM.has(semAcento(pedido?.situacao));

const ativoEv = e => e && e.status === 'ativo';
const chaveItemSetor = (itemId, etapaId) => `${itemId}:${etapaId}`;

/**
 * O processo de um registro: `etapa_id`; os registros antigos (por setor da
 * fase G) valem pelo processo de mesmo nome, se houver.
 */
function etapaDoEvento(e, { etapas = [], setores = [] } = {}) {
  if (e?.etapa_id !== null && e?.etapa_id !== undefined) return e.etapa_id;
  const setor = setores.find(s => String(s.id) === String(e?.setor_id));
  const etapa = setor ? etapas.find(x => semAcento(x.nome) === semAcento(setor.nome)) : null;
  return etapa ? etapa.id : null;
}

/** Acumulado por item e processo (registros ativos, estornos negativos incluídos). Pura. */
function acumulados(eventos, opcoes = {}) {
  const mapa = new Map();
  for (const e of (eventos || []).filter(ativoEv)) {
    const k = chaveItemSetor(e.pedido_item_id, opcoes.etapas ? etapaDoEvento(e, opcoes) : (e.etapa_id ?? e.setor_id));
    mapa.set(k, (mapa.get(k) || 0) + Number(e.quantidade || 0));
  }
  return mapa;
}

function statusDoItem(pedida, feita) {
  const p = Number(pedida) || 0;
  const f = Number(feita) || 0;
  if (f <= 0) return 'Não iniciado';
  if (f >= p) return 'Finalizado';
  return 'Parcial';
}

/**
 * Os registros que ainda não entraram num fechamento, cada um com a
 * competência em que cai e o valor. Pura.
 *
 * `filaDe(itemId, etapaId)` → as frações das peças do item que precisam do
 * processo, na ordem; `precoDe(produtoId)` → o preço da tabela fixa.
 */
function pendentes({ eventos, estado, valores, itensPor, etapasPor, pedidosPor, filaDe, precoDe, setores = [], mudancasDe = () => [] }) {
  const congeladoPorEvento = new Map(estado.congelados.filter(i => i.producao_evento_id).map(i => [String(i.producao_evento_id), i]));
  const etapas = [...etapasPor.values()];
  const comEtapa = (eventos || []).map(e => ({ ...e, etapa_id: etapaDoEvento(e, { etapas, setores }), setor_legado: e.etapa_id === null || e.etapa_id === undefined ? e.setor_id : null }));
  const porItemEtapa = new Map();
  for (const e of comEtapa) {
    const k = chaveItemSetor(e.pedido_item_id, e.etapa_id);
    if (!porItemEtapa.has(k)) porItemEtapa.set(k, []);
    porItemEtapa.get(k).push(e);
  }
  const alocacoes = new Map();
  const alocacaoDe = (itemId, etapaId) => {
    const k = chaveItemSetor(itemId, etapaId);
    if (!alocacoes.has(k)) {
      const fila = etapaId === null ? [] : filaDe(itemId, etapaId);
      // Com as trocas e as avulsas do item (09/10/2026): o de antes vale como valia.
      alocacoes.set(k, { fila, ...unidades.alocarComMudancas({ fila, eventos: porItemEtapa.get(k) || [], mudancas: etapaId === null ? [] : mudancasDe(itemId, etapaId) }) });
    }
    return alocacoes.get(k);
  };

  return comEtapa
    .filter(ativoEv)
    .filter(e => !congeladoPorEvento.has(String(e.id)))
    .map(e => {
      const item = itensPor.get(String(e.pedido_item_id)) || {};
      const etapa = e.etapa_id === null ? null : (etapasPor.get(String(e.etapa_id)) || null);
      const pedido = pedidosPor.get(String(e.pedido_id)) || {};
      const produtoId = e.produto_id ?? item.produto_id ?? null;
      const quantidade = Number(e.quantidade);
      let total = null;
      let origem = null;
      let fracao = null;
      let valorPeca = null;
      let regraTexto = null;
      if (e.estorno_de) {
        // Estorno de registro fechado: o valor com que ele foi fechado, negativo.
        const original = congeladoPorEvento.get(String(e.estorno_de));
        if (original) { total = c.centavos(-Math.abs(Number(original.total) || 0)); origem = 'fechado'; }
      } else if (etapa && !etapa.producao_ativa) {
        total = 0;
        origem = 'desligado';
      } else if (etapa) {
        const regra = unidades.regraDaPeca(valores, produtoId, etapa.id);
        valorPeca = unidades.valorDaPecaInteira(regra, precoDe(produtoId));
        regraTexto = regra ? unidades.descreverRegra(regra) : null;
        const alocado = alocacaoDe(e.pedido_item_id, etapa.id).porEvento.get(String(e.id));
        // `fracao_paga` é do cancelamento: a unidade saiu do pedido, mas só se
        // paga o trecho que ela andou aqui (producaoConfirmacao.js).
        const manual = e.fracao_paga === null || e.fracao_paga === undefined ? null : Number(e.fracao_paga);
        fracao = manual !== null ? Math.round(manual * 10000) / 10000 : (alocado ? Math.round(alocado.fracao * 10000) / 10000 : 0);
        if (valorPeca !== null) { total = c.centavos(valorPeca * fracao); origem = regra.origem; }
      }
      const natural = String(e.competencia || '').trim() || c.competenciaDe(e.data_finalizacao);
      const al = etapa ? alocacaoDe(e.pedido_item_id, etapa.id) : null;
      return {
        evento_id: e.id, tipo_item: 'producao', pedido_id: e.pedido_id, pedido: pedido.numero ?? String(e.pedido_id), cliente_id: pedido.cliente_id ?? null,
        pedido_item_id: e.pedido_item_id, produto_id: produtoId,
        produto: [item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${e.pedido_item_id}`,
        // Separados: a tela mostra só o código (em etiqueta) e o nome ao passar o mouse.
        produto_codigo: item.codigo || null, produto_nome: item.nome || null,
        setor_id: etapa ? etapa.id : null, setor: etapa ? etapa.nome : (e.setor_legado ? `setor ${e.setor_legado}` : 'processo removido'),
        data: c.dia(e.data_finalizacao), quantidade, estorno_de: e.estorno_de ?? null,
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado.proxima),
        valor_unitario: total === null || !quantidade ? null : c.centavos(total / quantidade),
        valor_peca: valorPeca, fracao, regra: regraTexto, valor_origem: origem,
        // Registro pago pela fração (decisão quebrada do fechamento, cancelamento):
        // a contagem por processo usa a fração, não as unidades tocadas.
        fracao_manual: e.fracao_paga !== null && e.fracao_paga !== undefined && !e.estorno_de,
        sem_valor: total === null,
        total: total === null ? 0 : total,
        status_item: al ? statusDoItem(al.pedida, al.usadas) : null, observacao: e.observacao || null
      };
    });
}

/** 'CÓD — Nome' (como o fechamento guarda) em código e nome. Pura. */
function partesDoProduto(texto) {
  const partes = String(texto || '').split(' — ');
  if (partes.length < 2) return { produto_codigo: null, produto_nome: texto || null };
  return { produto_codigo: partes[0] || null, produto_nome: partes.slice(1).join(' — ') || null };
}

/** Linhas congeladas de um fechamento de produção, no mesmo formato das pendentes. Pura. */
function congeladas(estado, fechamentoId) {
  return estado.congelados
    .filter(i => String(i.fechamento_id) === String(fechamentoId))
    .map(i => ({
      evento_id: i.producao_evento_id, tipo_item: i.tipo_item, pedido_id: i.pedido_id, pedido: i.detalhes?.pedido ?? String(i.pedido_id ?? '—'),
      pedido_item_id: i.detalhes?.pedido_item_id ?? null, produto_id: i.detalhes?.produto_id ?? null, produto: i.produto || '—',
      ...partesDoProduto(i.produto),
      setor_id: i.detalhes?.setor_id ?? null, setor: i.setor || '—', data: c.dia(i.data_referencia), quantidade: Number(i.quantidade) || 0,
      estorno_de: i.detalhes?.estorno_de ?? null, competencia: i.competencia, competencia_natural: String(i.competencia_origem || '').trim() || i.competencia,
      valor_unitario: i.valor_unitario === null || i.valor_unitario === undefined ? null : c.centavos(i.valor_unitario),
      valor_peca: i.detalhes?.valor_peca ?? null, fracao: i.detalhes?.fracao ?? null, regra: i.detalhes?.regra ?? null,
      sem_valor: false, total: c.centavos(i.total), status_item: i.detalhes?.status_item || (i.tipo_item === 'ajuste' ? 'Ajuste' : null),
      motivo: i.detalhes?.motivo || null,
      ajuste_pessoa_id: i.ajuste_pessoa_id ?? i.detalhes?.ajuste_pessoa_id ?? null, colaborador: i.detalhes?.colaborador || null,
      colaborador_id: i.detalhes?.colaborador_id ?? null
    }));
}

/**
 * Uma linha de SALDO — o "Ajuste restante do mês anterior": o que o processo
 * terminou devendo em `origem` e abate em `destino`. Pura.
 */
function linhaDeRestante(s, { origem, destino, fechamentoId = null, projetado = false }) {
  const rotulo = c.rotuloCompetencia(String(origem).trim());
  const total = c.centavos(s.total);
  // Com o rateio em uso, o restante é DE UM COLABORADOR naquele processo
  // (decisão do dono, 09/10/2026: quem recebeu a mais é quem devolve).
  const comColaborador = s.colaborador_id !== null && s.colaborador_id !== undefined;
  const quem = comColaborador ? `${s.colaborador} (${s.setor})` : s.setor;
  return {
    evento_id: null, tipo_item: 'saldo', pedido_id: null, pedido: '—',
    produto: `Ajuste restante de ${rotulo}${comColaborador ? ` · ${s.colaborador}` : ''}`,
    setor_id: s.setor_id ?? null, setor: s.setor, data: null, quantidade: 0, competencia: destino, competencia_natural: String(origem).trim(),
    valor_unitario: null, sem_valor: false, total, status_item: 'Restante do mês anterior',
    motivo: `Ajuste restante do mês anterior (${rotulo}): ${quem} terminou ${rotulo} com ${c.reais(total)}`,
    fechamento_origem: fechamentoId, projetado,
    colaborador_id: comColaborador ? s.colaborador_id : null, colaborador: comColaborador ? s.colaborador : null
  };
}

/**
 * Os negativos de um mês que passam para o seguinte: com as partes por
 * colaborador (rateio em uso), cada parte negativa — mesmo num processo que
 * fechou positivo; sem elas, o processo que terminou negativo. Pura.
 */
function negativosDoMes(setores, { origem, destino, fechamentoId = null, projetado = false }) {
  const linhas = [];
  for (const s of setores || []) {
    if (Array.isArray(s.partes)) {
      for (const p of s.partes) {
        if (Number(p.total) <= -0.01) linhas.push(linhaDeRestante({ setor_id: s.setor_id, setor: s.setor, colaborador_id: p.colaborador_id, colaborador: p.colaborador, total: p.total }, { origem, destino, fechamentoId, projetado }));
      }
    } else if (Number(s.total) <= -0.01) {
      linhas.push(linhaDeRestante(s, { origem, destino, fechamentoId, projetado }));
    }
  }
  return linhas;
}

/** Saldo negativo do último fechamento (do processo, ou do colaborador no processo): passa para o próximo. Pura. */
function saldosAnteriores(estado) {
  const ultimo = estado.ultimo;
  if (!ultimo) return [];
  return negativosDoMes(ultimo.resumo || [], { origem: ultimo.competencia, destino: estado.proxima, fechamentoId: ultimo.id });
}

/** As partes por colaborador das linhas, quando o rateio está em uso (`estado.divisao`); senão null. Pura. */
function partesSePuder(estado, linhas) {
  const divisao = estado?.divisao;
  if (!divisao || !(divisao.colaboradores || []).length) return null;
  return rateios.partesDoMes({ linhas, rateios: divisao.rateios || [], colaboradores: divisao.colaboradores });
}

/**
 * O restante negativo que os meses AINDA ABERTOS deixam, processo a
 * processo, até `competencia` — a mesma conta de comissoes.restantesProjetados
 * (é uma projeção: o mês de origem ainda muda até fechar). Pura.
 */
function restantesProjetados({ pend, estado, competencia }) {
  if (!c.competenciaValida(competencia) || estado.fechados.has(competencia)) return [];
  const linhas = Array.isArray(pend) ? pend : [];
  const inicio = estado.proxima || linhas.map(l => String(l.competencia || '')).filter(c.competenciaValida).sort()[0] || null;
  if (!inicio || !(inicio < competencia)) return [];
  let levadas = estado.proxima ? saldosAnteriores(estado) : [];
  let mes = inicio;
  for (let voltas = 0; mes < competencia && voltas < 240; voltas++) {
    const seguinte = c.somarMeses(mes, 1);
    const doMes = [...linhas.filter(l => l.competencia === mes), ...levadas];
    const setores = partesSePuder(estado, doMes) || resumir(doMes).setores;
    levadas = negativosDoMes(setores, { origem: mes, destino: seguinte, projetado: true });
    mes = seguinte;
  }
  return levadas;
}

/** O restante que cai numa competência aberta (ver comissoes.restantesDoMes). Pura. */
function restantesDoMes({ pend, estado, competencia, propria = false }) {
  if (estado.proxima === competencia) return saldosAnteriores(estado);
  return propria ? restantesProjetados({ pend, estado, competencia }) : [];
}

/**
 * Peças e processos são números DIFERENTES, e confundi-los é o defeito que o
 * dono pegou em 24/09/2026: uma peça que passa por marcenaria, acabamento,
 * montagem e embalagem paga 4 linhas — são 4 processos, mas **uma peça**.
 *
 *   `pecas`     peças distintas (pela linha do pedido);
 *   `processos` pares peça+processo (o que de fato se paga);
 *   `unidades`  a soma das quantidades (era o que `pecas` contava antes).
 * Pura.
 */
function contarPecasEProcessos(linhas) {
  const pecas = new Set();
  const processos = new Set();
  let unidades = 0;
  for (const l of (linhas || []).filter(Boolean)) {
    unidades += Number(l.quantidade) || 0;
    if (l.pedido_item_id === null || l.pedido_item_id === undefined) continue;
    pecas.add(String(l.pedido_item_id));
    if (l.setor_id !== null && l.setor_id !== undefined) processos.add(`${l.pedido_item_id}:${l.setor_id}`);
  }
  return { pecas: pecas.size, processos: processos.size, unidades };
}

/** Totais de uma lista de linhas de produção: peças, por processo, a pagar e a compensar. Pura. */
function resumir(linhas) {
  const porSetor = new Map();
  for (const l of linhas) {
    const k = String(l.setor_id ?? l.setor);
    const s = porSetor.get(k) || { setor_id: l.setor_id ?? null, setor: l.setor, pecas: 0, total: 0 };
    // Decisão quebrada conta o que foi feito (1,5), não as unidades tocadas (2).
    s.pecas = Math.round((s.pecas + (l.fracao_manual ? Number(l.fracao) || 0 : Number(l.quantidade) || 0)) * 10000) / 10000;
    s.total = c.centavos(s.total + Number(l.total || 0));
    porSetor.set(k, s);
  }
  const setores = [...porSetor.values()].sort((a, b) => String(a.setor).localeCompare(String(b.setor), 'pt-BR'));
  const contagem = contarPecasEProcessos(linhas);
  const somaDe = l => c.centavos(l.reduce((s, x) => s + Number(x.total || 0), 0));
  const deAjuste = linhas.filter(l => l.tipo_item === 'ajuste');
  return {
    // Os ajustes por pessoa do mês e o que veio negativo do mês anterior (06/10/2026).
    ajustes: somaDe(deAjuste),
    ajustes_quantidade: deAjuste.length,
    restante_anterior: somaDe(linhas.filter(l => l.tipo_item === 'saldo')),
    // `pecas` passou a ser a contagem de PEÇAS (era a soma das quantidades,
    // que virou `unidades`): "8 peças finalizadas" eram 2 peças × 4 processos.
    pecas: contagem.pecas,
    processos: contagem.processos,
    unidades: contagem.unidades,
    pedidos: new Set(linhas.filter(l => l.pedido_id).map(l => String(l.pedido_id))).size,
    setores,
    liquido: c.centavos(linhas.reduce((s, l) => s + Number(l.total || 0), 0)),
    a_pagar: c.centavos(setores.filter(s => s.total > 0).reduce((t, s) => t + s.total, 0)),
    a_compensar: c.centavos(setores.filter(s => s.total < 0).reduce((t, s) => t + s.total, 0)),
    sem_valor: linhas.filter(l => l.sem_valor)
  };
}

/**
 * A competência de produção: fechada (congelada) ou em aberto (prévia). Pura.
 * `propria`: só o que cai nesta competência (o painel — o que ficou de meses
 * não fechados é "a repassar", repasses.js); sem ela, a prévia do fechamento.
 * O negativo de um mês anterior aberto abate aqui também (restantesDoMes).
 */
function montarCompetencia({ pend, estado, competencia, propria = false }) {
  const fechado = estado.fechados.get(competencia) || null;
  const cabe = p => p.competencia && (propria ? p.competencia === competencia : p.competencia <= competencia);
  const linhas = fechado
    ? congeladas(estado, fechado.id)
    : [...pend.filter(cabe), ...restantesDoMes({ pend, estado, competencia, propria })];
  const r = resumir(linhas);
  // Com o rateio em uso, o mês também sai por colaborador: paga-se cada parte
  // positiva e a negativa fica para o mês seguinte, com o nome de quem deve
  // (09/10/2026). Fechado, valem as partes congeladas no fechamento.
  const partes = fechado
    ? ((fechado.resumo || []).some(s => Array.isArray(s.partes)) ? fechado.resumo.filter(s => Array.isArray(s.partes)) : null)
    : partesSePuder(estado, linhas);
  if (partes && !fechado) Object.assign(r, rateios.contaDasPartes(partes));
  return {
    competencia, fechado: Boolean(fechado),
    por_colaborador: partes,
    fechamento: fechado ? {
      id: fechado.id, fechado_em: fechado.fechado_em, pagar_ate: c.dia(fechado.pagar_ate), total: c.centavos(fechado.total),
      pagamento: fechado.pagamento || null, pagamentos: fechado.pagamentos || [],
      pago: c.centavos(fechado.pago), falta_pagar: c.centavos(fechado.falta_pagar)
    } : null,
    ...r,
    a_pagar: fechado ? c.centavos(fechado.total) : r.a_pagar,
    linhas: linhas.sort((a, b) => String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true }) || String(a.data).localeCompare(String(b.data)))
  };
}

// ------------------------------------------------------------------- leitura

/**
 * A partir de quantos pedidos uma tabela é lida inteira, numa ida só, em vez
 * de uma ida por pedido (desempenho, 06/10/2026: o painel do Financeiro fazia
 * ~210 idas só aqui).
 */
const PEDIDOS_DE_UMA_VEZ_A_PARTIR = 4;

/** As linhas de `tabela` dos pedidos dados (`campo` é a coluna do pedido). */
async function linhasDosPedidos(api, tabela, campo, pedidoIds) {
  const unicos = [...new Set(pedidoIds.filter(Boolean).map(String))];
  if (!unicos.length) return [];
  if (unicos.length >= PEDIDOS_DE_UMA_VEZ_A_PARTIR) {
    const desejados = new Set(unicos);
    return c.lista(await api.get(`/api/${tabela}`).catch(() => [])).filter(l => l && desejados.has(String(l[campo])));
  }
  const listas = await Promise.all(unicos.map(id => api.get(`/api/${tabela}`, { query: { [campo]: id } })
    .then(r => c.lista(r).filter(l => String(l?.[campo]) === id)).catch(() => [])));
  return listas.flat();
}

const itensDe = (api, pedidoIds) => linhasDosPedidos(api, 'pedidos_itens', 'pedido_id', pedidoIds);
const extDe = (api, pedidoIds) => linhasDosPedidos(api, 'pedido_itens_ext', 'id_pedido', pedidoIds);

async function precosDaTabela(api) {
  const linhas = c.lista(await api.get('/api/tabela_fixa').catch(() => []));
  return new Map(linhas.filter(l => l && l.id_prod !== null && l.id_prod !== undefined).map(l => [String(l.id_prod), Number(l.vlr_prod)]));
}

/**
 * As peças de cada item, por processo. Lê a rota de cada produto uma vez.
 * Devolve `filaDe(itemId, etapaId)` e o resumo das origens de cada item.
 */
async function montarFilas(api, { itens, etapasPor }) {
  const pedidoIds = itens.map(i => i.pedido_id);
  const [ext, insumos, mudancas] = await Promise.all([
    extDe(api, pedidoIds), carregarInsumos(api),
    // Trocas de peças entre pedidos e peças avulsas (09/10/2026): sem o SQL, nenhuma.
    mudancasUnidades.lerDosItens(api, itens.map(i => i.id)).catch(() => ({ trocas: [], avulsas: [] }))
  ]);
  const mudancasDe = mudancasUnidades.indice(mudancas);
  const extPor = new Map();
  for (const x of ext) {
    const k = String(x.pedido_item_id);
    if (!extPor.has(k)) extPor.set(k, []);
    extPor.get(k).push(x);
  }
  const cacheRotas = new Map();
  const gruposPor = new Map();
  const rotaPor = new Map();
  // As rotas de todas as peças de uma vez: antes era uma ida à API por peça,
  // em fila (150 peças × a latência — ~18 s com a internet).
  await carregarRotas(api, itens.map(i => i.produto_id), cacheRotas, insumos).catch(() => cacheRotas);
  for (const item of itens) {
    const rota = item.produto_id === null || item.produto_id === undefined ? [] : await carregarRota(api, item.produto_id, cacheRotas, insumos).catch(() => []);
    rotaPor.set(String(item.id), rota);
    gruposPor.set(String(item.id), unidades.unidadesDoItem({ item, ext: extPor.get(String(item.id)) || [], rota }));
  }
  const cache = new Map();
  const filaDe = (itemId, etapaId) => {
    const k = chaveItemSetor(itemId, etapaId);
    if (!cache.has(k)) {
      const etapa = etapasPor.get(String(etapaId));
      cache.set(k, etapa ? unidades.filaDoProcesso({ grupos: gruposPor.get(String(itemId)) || [], rota: rotaPor.get(String(itemId)) || [], processo: etapa.nome }) : []);
    }
    return cache.get(k);
  };
  return { filaDe, gruposPor, rotaPor, mudancasDe, mudancas };
}

/** Tudo que as telas de produção precisam. */
async function lerBase(api) {
  const [eventos, tudo, fech, pedidos, precos, porPessoa, colaboradores, divisoes] = await Promise.all([
    c.ler(api, 'producao_eventos'),
    regras.lerTudo(api),
    base.lerFechamentos(api),
    api.get('/api/pedidos').then(c.lista).catch(() => []),
    precosDaTabela(api),
    // Sem o SQL dos ajustes por pessoa, nenhum (null).
    ajustesPessoa.lerTodos(api, { area: 'producao' }),
    // O rateio entre colaboradores (sem o SQL dele, null: tudo por processo).
    rateios.listarColaboradores(api).catch(() => null),
    rateios.listarRateios(api).catch(() => null)
  ]);
  const itens = await itensDe(api, eventos.map(e => e.pedido_id));
  const estado = estadoDosFechamentos({ ...fech, tipo: 'producao' });
  // Rateio em uso (há colaborador cadastrado): o mês sai também por
  // colaborador, e é com ele que o negativo passa adiante (09/10/2026).
  estado.divisao = colaboradores && colaboradores.length ? { colaboradores, rateios: divisoes || [] } : null;
  const pedidosPor = new Map(pedidos.filter(Boolean).map(p => [String(p.id), p]));
  const itensPor = new Map(itens.map(i => [String(i.id), i]));
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, mudancasDe } = await montarFilas(api, { itens, etapasPor });
  const precoDe = produtoId => precos.get(String(produtoId)) ?? null;
  const pend = [
    ...pendentes({ eventos, estado, valores: tudo.valores, itensPor, etapasPor, pedidosPor, filaDe, precoDe, setores: tudo.setores, mudancasDe }),
    ...ajustesPessoa.linhasDeProducao({
      ajustes: porPessoa || [], estado, competenciaAlvo,
      processos: new Map(tudo.etapas.map(e => [String(e.id), e.nome])),
      colaboradores: new Map((colaboradores || []).map(x => [String(x.id), x.nome]))
    })
  ];
  return { eventos, regras: tudo, estado, pedidos, pedidosPor, itensPor, etapasPor, setoresPor: etapasPor, pend };
}

/** Os pedidos em que se pode registrar produção (para a busca do modal). */
async function pedidosParaProduzir(api) {
  const pedidos = c.lista(await api.get('/api/pedidos').catch(() => [])).filter(podeProduzir);
  const nomes = await base.nomesDosClientes(api, pedidos.map(p => p.cliente_id));
  return pedidos
    .map(p => ({ id: p.id, numero: p.numero ?? String(p.id), cliente: nomes.get(String(p.cliente_id)) || null, situacao: p.situacao }))
    .sort((a, b) => String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
}

/**
 * Um pedido com os itens e, por processo que a peça usa, quantas peças
 * precisam dele, quantas já foram registradas, o valor da peça inteira e a
 * fração de cada uma das próximas (para a prévia do registro).
 */
async function doPedido(api, pedidoId) {
  const id = Number(pedidoId);
  const pedido = c.lista(await api.get('/api/pedidos', { query: { id } }).catch(() => [])).find(p => Number(p?.id) === id);
  if (!pedido) throw c.erro('Pedido não encontrado.', 404);
  const [itens, eventos, tudo, nomes, precos] = await Promise.all([
    itensDe(api, [id]),
    c.ler(api, 'producao_eventos', { pedido_id: id }),
    regras.lerTudo(api),
    base.nomesDosClientes(api, [pedido.cliente_id]),
    precosDaTabela(api)
  ]);
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const { filaDe, gruposPor, mudancasDe, mudancas } = await montarFilas(api, { itens, etapasPor });
  // Pedido cancelado com peça avulsa em produção (09/10/2026): ela continua.
  const comAvulsa = (mudancas?.avulsas || []).some(a => a.status === 'em_producao');
  const comEtapa = eventos.map(e => ({ ...e, etapa_id: etapaDoEvento(e, { etapas: tudo.etapas, setores: tudo.setores }) }));
  const ativas = tudo.etapas.filter(e => e.producao_ativa);

  return {
    pedido: { id: pedido.id, numero: pedido.numero ?? String(pedido.id), situacao: pedido.situacao, cliente: nomes.get(String(pedido.cliente_id)) || null, pode_produzir: podeProduzir(pedido) || comAvulsa, avulsa: comAvulsa && !podeProduzir(pedido) },
    setores: ativas.map(e => ({ id: e.id, nome: e.nome })),
    itens: itens.sort((a, b) => Number(a.id) - Number(b.id)).map(i => {
      const grupos = gruposPor.get(String(i.id)) || [];
      const preco = precos.get(String(i.produto_id)) ?? null;
      return {
        id: i.id, produto_id: i.produto_id ?? null, codigo: i.codigo || null, nome: i.nome || null,
        quantidade: Number(i.quantidade) || 0,
        do_estoque: grupos.filter(g => g.origem === 'estoque').reduce((s, g) => s + g.quantidade, 0),
        preco_tabela: preco,
        setores: ativas.map(e => {
          const fila = filaDe(i.id, e.id);
          const mudancas = mudancasDe(i.id, e.id);
          const al = unidades.alocarComMudancas({ fila, eventos: comEtapa.filter(x => String(x.pedido_item_id) === String(i.id) && String(x.etapa_id) === String(e.id)), mudancas });
          if (!al.pedida && !al.usadas) return null;
          const regra = unidades.regraDaPeca(tudo.valores, i.produto_id, e.id);
          const valorPeca = unidades.valorDaPecaInteira(regra, preco);
          return {
            setor_id: e.id, pedida: al.pedida, finalizada: al.usadas, saldo: al.pendentes.length,
            status: statusDoItem(al.pedida, al.usadas),
            valor_unitario: valorPeca, valor_origem: regra ? regra.origem : null, regra: regra ? unidades.descreverRegra(regra) : null,
            proximas: al.pendentes.map(f => Math.round(f * 10000) / 10000),
            // Quanto falta de cada unidade em aberto (0,5 = feita pela metade num fechamento).
            cotas: al.cotas,
            // A fila inteira: é com ela que o registro confere, depois de gravar, se não passou do que faltava.
            fila,
            // As trocas e as avulsas do item: a conferência usa a mesma conta.
            mudancas
          };
        }).filter(Boolean)
      };
    }),
    eventos: comEtapa
      .sort((a, b) => String(b.data_finalizacao).localeCompare(String(a.data_finalizacao)) || Number(b.id) - Number(a.id))
      .map(e => ({ ...e, setor_id: e.etapa_id, data_finalizacao: c.dia(e.data_finalizacao), setor: (etapasPor.get(String(e.etapa_id)) || {}).nome || null }))
  };
}

// ------------------------------------------------------------------- escrita

/** O valor das próximas `quantidade` peças (a prévia do registro). Pura. */
function valorDasProximas(doSetor, quantidade) {
  if (!doSetor || doSetor.valor_unitario === null || doSetor.valor_unitario === undefined) return null;
  const fracao = (doSetor.proximas || []).slice(0, quantidade).reduce((s, f) => s + f, 0);
  return c.centavos(doSetor.valor_unitario * fracao);
}

/**
 * Grava um registro de produção. `fracao` (só o fechamento passa, nunca o
 * corpo da requisição): a decisão quebrada — paga essa fração de peça e pode
 * deixar uma unidade pela metade para o mês seguinte; `quantidade` são as
 * unidades tocadas.
 */
async function registrar({ api, entrada, usuarioId = null, hoje, fracao = null }) {
  const pedidoId = Number(entrada?.pedido_id);
  const itemId = Number(entrada?.pedido_item_id);
  const etapaId = Number(entrada?.etapa_id ?? entrada?.setor_id);
  const quantidade = Number(entrada?.quantidade);
  const data = String(entrada?.data_finalizacao || '').slice(0, 10);
  if (!(Number.isInteger(pedidoId) && pedidoId > 0)) throw c.erro('Escolha o pedido.');
  if (!(Number.isInteger(itemId) && itemId > 0)) throw c.erro('Escolha a peça do pedido.');
  if (!(Number.isInteger(etapaId) && etapaId > 0)) throw c.erro('Escolha o processo.');
  if (!(Number.isInteger(quantidade) && quantidade > 0)) throw c.erro('Informe quantas peças foram finalizadas (número inteiro).');
  if (!c.dataValida(data)) throw c.erro('Informe a data da finalização.');
  if (data > hoje) throw c.erro('A data da finalização não pode ser futura.');

  const dados = await doPedido(api, pedidoId);
  if (!dados.pedido.pode_produzir) throw c.erro(`O pedido ${dados.pedido.numero} está "${dados.pedido.situacao}": só se registra produção de pedido aprovado, em produção, enviado ou entregue.`, 409);
  const item = dados.itens.find(i => Number(i.id) === itemId);
  if (!item) throw c.erro('Esta peça não é deste pedido.', 404);
  const etapa = dados.setores.find(s => Number(s.id) === etapaId);
  if (!etapa) throw c.erro('Processo inexistente ou com o pagamento desligado.', 404);
  const doSetor = item.setores.find(s => Number(s.setor_id) === etapaId);
  if (!doSetor) throw c.erro(`${[item.codigo, item.nome].filter(Boolean).join(' — ') || 'Esta peça'} não passa por ${etapa.nome} (não tem insumo desse processo, ou todas saíram do estoque com ele pronto).`, 409);
  if (quantidade > doSetor.saldo) throw c.erro(`Passa do saldo: ${doSetor.pedida} peça(s) precisam de ${etapa.nome} e ${doSetor.finalizada} já foram registradas (saldo ${doSetor.saldo}).`, 409);
  const fracaoPaga = fracao === null || fracao === undefined ? null : Math.round(Number(fracao) * 10000) / 10000;
  if (fracaoPaga !== null) {
    const falta = (doSetor.proximas || []).reduce((s, f) => s + f, 0);
    if (!(fracaoPaga > 0) || fracaoPaga > falta + 0.0001) throw c.erro(`Passa do que falta de ${etapa.nome} nesta peça.`, 409);
  }
  const valor = fracaoPaga !== null
    ? (doSetor.valor_unitario === null || doSetor.valor_unitario === undefined ? null : c.centavos(doSetor.valor_unitario * fracaoPaga))
    : valorDasProximas(doSetor, quantidade);

  const descricaoPeca = [item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${item.id}`;
  const evento = await c.inserir(api, 'producao_eventos', {
    pedido_id: pedidoId, pedido_item_id: itemId, produto_id: item.produto_id, setor_id: null, etapa_id: etapaId, quantidade,
    ...(fracaoPaga !== null ? { fracao_paga: fracaoPaga } : {}),
    data_finalizacao: data, competencia: c.competenciaDe(data), observacao: c.texto(entrada?.observacao, 500) || null,
    status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
  });
  const desfazer = motivo => (evento?.id
    ? c.atualizar(api, 'producao_eventos', evento.id, { status: 'estornado', estornado_em: c.agora(), estornado_por: usuarioId, motivo_estorno: motivo }).catch(() => {})
    : Promise.resolve());

  // Duas máquinas ao mesmo tempo: relê e desfaz se passou do que precisa ser
  // feito. Pela FILA, não pela soma das quantidades: uma unidade feita pela
  // metade num mês e terminada no outro tem dois registros de 1 (07/10/2026).
  const eventosDepois = await c.ler(api, 'producao_eventos', { pedido_id: pedidoId });
  const doProcesso = eventosDepois.filter(e => ativoEv(e) && !e.estornado_em && !e.estorno_de
    && Number(e.pedido_item_id) === itemId && Number(e.etapa_id) === etapaId);
  const gravado = doProcesso.find(e => String(e.id) === String(evento?.id)) || null;
  // A fração tem de ter ido para o banco: sem a coluna, o registro seria pago
  // pela unidade inteira (a API genérica descarta coluna desconhecida).
  if (fracaoPaga !== null && (!gravado || unidades.fracaoDoRegistro(gravado) === null)) {
    await desfazer('Coluna producao_eventos.fracao_paga ausente');
    throw c.erro('Falta rodar sql/fechamento_producao_e_pagamentos.sql no banco e reiniciar a API (coluna producao_eventos.fracao_paga).', 409, { sql_pendente: true });
  }
  // Algum registro ficou sem o que devia receber? Só conta contra ESTE se o
  // estouro não existia sem ele (dado antigo torto não trava os novos).
  const faltou = eventos => {
    const al = unidades.alocarComMudancas({ fila: doSetor.fila || [], eventos, mudancas: doSetor.mudancas || [] });
    return eventos.some(e => {
      const r = al.porEvento.get(String(e.id));
      if (!r) return false;
      const manual = unidades.fracaoDoRegistro(e);
      return manual !== null ? r.fracao + 0.0001 < manual : r.fracoes.length < Math.trunc(Number(e.quantidade) || 0);
    });
  };
  if (evento?.id && faltou(doProcesso) && !faltou(doProcesso.filter(e => String(e.id) !== String(evento.id)))) {
    await desfazer('Registro simultâneo passou do saldo do processo');
    throw c.erro('Outro registro desta peça entrou ao mesmo tempo e o saldo acabou. Confira e registre de novo.', 409);
  }

  const doEstoque = (doSetor.proximas || []).slice(0, quantidade).some(f => f < 1);
  const quanto = fracaoPaga !== null
    ? `${String(fracaoPaga).replace('.', ',')} de peça de ${descricaoPeca} feita em ${etapa.nome}`
    : `${quantidade} × ${descricaoPeca} finalizada(s) em ${etapa.nome}`;
  await auditoria.registrar(api, {
    tipo: 'producao_registrada', pedidoId, referenciaId: evento.id, usuarioId, valor,
    descricao: `${quanto} (${c.impressa(data)}) — pedido ${dados.pedido.numero}`
      + `${fracaoPaga === null && doEstoque ? ' (parte das peças saiu do estoque com o processo adiantado)' : ''}`
  });
  const feita = doSetor.finalizada + quantidade;
  return {
    evento,
    item: { id: item.id, quantidade: doSetor.pedida, finalizada: feita, saldo: Math.max(0, doSetor.pedida - feita), status: statusDoItem(doSetor.pedida, feita) },
    valor,
    sem_valor: valor === null
  };
}

async function estornar({ api, id, motivo, usuarioId = null, hoje }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga o motivo do estorno.');
  const evento = (await c.ler(api, 'producao_eventos', { id: Number(id) }))[0];
  if (!evento) throw c.erro('Registro de produção não encontrado.', 404);
  if (evento.status !== 'ativo' || evento.estornado_em) throw c.erro('Este registro já foi estornado.', 409);
  if (evento.estorno_de || Number(evento.quantidade) < 0) throw c.erro('Este registro já é um estorno.', 409);

  const fech = await base.lerFechamentos(api);
  const estado = estadoDosFechamentos({ ...fech, tipo: 'producao' });
  const fechado = estado.congelados.find(i => String(i.producao_evento_id) === String(evento.id));
  const quando = c.agora();
  const campos = { estornado_em: quando, estornado_por: usuarioId, motivo_estorno: texto };
  let negativo = null;
  if (!fechado) {
    await c.atualizar(api, 'producao_eventos', evento.id, { status: 'estornado', ...campos });
  } else {
    negativo = await c.inserir(api, 'producao_eventos', {
      pedido_id: evento.pedido_id, pedido_item_id: evento.pedido_item_id, produto_id: evento.produto_id,
      setor_id: evento.setor_id ?? null, etapa_id: evento.etapa_id ?? null,
      quantidade: -Number(evento.quantidade), data_finalizacao: hoje, competencia: c.competenciaDe(hoje),
      observacao: `Estorno do registro ${evento.id}: ${texto}`, status: 'ativo', estorno_de: evento.id, criado_por: usuarioId, criado_em: quando
    });
    await c.atualizar(api, 'producao_eventos', evento.id, campos);
  }
  await auditoria.registrar(api, {
    tipo: 'producao_estornada', pedidoId: evento.pedido_id, referenciaId: evento.id, usuarioId,
    descricao: `Estorno de ${evento.quantidade} peça(s) do registro ${evento.id}${fechado ? ` (já fechado em ${c.rotuloCompetencia(fechado.competencia)}: desconta no próximo fechamento)` : ''}: ${texto}`
  });
  // Quem registrou a produção fica sabendo, com o motivo (01/10/2026).
  await avisos.avisarPessoa(api, {
    para: evento.criado_por, usuarioId, origem: 'financeiro', tipo: 'registro_cancelado', titulo: 'Uma produção sua foi estornada',
    frase: autor => `${autor} estornou ${evento.quantidade} peça(s) que você registrou na produção (registro ${evento.id}).`,
    nota: `Motivo: ${texto}`
  });
  return { evento: { ...evento, ...campos, status: fechado ? evento.status : 'estornado' }, negativo, ja_fechado: Boolean(fechado) };
}

module.exports = {
  SITUACOES_QUE_PRODUZEM, podeProduzir, etapaDoEvento, acumulados, statusDoItem, pendentes, congeladas,
  linhaDeRestante, negativosDoMes, saldosAnteriores, partesSePuder, restantesProjetados, restantesDoMes, resumir, contarPecasEProcessos, montarCompetencia,
  lerBase, pedidosParaProduzir, doPedido, valorDasProximas, registrar, estornar,
  // A confirmação da produção (producaoConfirmacao.js) monta as filas do mesmo jeito.
  itensDe, extDe, precosDaTabela, montarFilas, chaveItemSetor
};
