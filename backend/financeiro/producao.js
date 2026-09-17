/**
 * Produção paga por peça (fase G).
 *
 * Cada registro é "N peças do item X finalizadas no setor S no dia D"
 * (`producao_eventos`). Por item e setor, o acumulado nunca passa da
 * quantidade pedida. A competência é o mês da finalização; o fechamento
 * congela os eventos com o valor por peça do momento (regras.valorUnitario)
 * e cada evento entra em um fechamento só (índice único no banco).
 *
 * Corrigir: evento ainda não fechado é estornado (sai das contas); evento
 * já fechado ganha um evento NEGATIVO na data do estorno, com o mesmo valor
 * por peça com que foi fechado — o fechamento antigo não muda.
 */
const c = require('./comum');
const regras = require('./regras');
const auditoria = require('./auditoria');
const base = require('./base');
const { estadoDosFechamentos, competenciaAlvo } = require('./comissoes');

const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Pedidos em que se registra produção (a produção começa antes da NF). */
const SITUACOES_QUE_PRODUZEM = new Set(['aprovado', 'producao', 'enviado', 'entregue']);
const podeProduzir = pedido => SITUACOES_QUE_PRODUZEM.has(semAcento(pedido?.situacao));

const ativoEv = e => e && e.status === 'ativo';
const chaveItemSetor = (itemId, setorId) => `${itemId}:${setorId}`;

/** Acumulado por item e setor (eventos ativos, estornos negativos incluídos). Pura. */
function acumulados(eventos) {
  const mapa = new Map();
  for (const e of (eventos || []).filter(ativoEv)) {
    const k = chaveItemSetor(e.pedido_item_id, e.setor_id);
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
 * Os eventos que ainda não entraram num fechamento, cada um com a
 * competência em que cai e o valor por peça. Pura.
 */
function pendentes({ eventos, estado, valores, itensPor, setoresPor, pedidosPor }) {
  const congeladoPorEvento = new Map(estado.congelados.filter(i => i.producao_evento_id).map(i => [String(i.producao_evento_id), i]));
  const acum = acumulados(eventos);
  return (eventos || [])
    .filter(ativoEv)
    .filter(e => !congeladoPorEvento.has(String(e.id)))
    .map(e => {
      const item = itensPor.get(String(e.pedido_item_id)) || {};
      const setor = setoresPor.get(String(e.setor_id)) || {};
      const pedido = pedidosPor.get(String(e.pedido_id)) || {};
      let unitario = null;
      let origem = null;
      if (e.estorno_de) {
        // Estorno de evento fechado: o valor com que ele foi fechado.
        const original = congeladoPorEvento.get(String(e.estorno_de));
        if (original) { unitario = c.centavos(original.valor_unitario); origem = 'fechado'; }
      }
      if (unitario === null) {
        const v = regras.valorUnitario(valores, e.produto_id ?? item.produto_id, e.setor_id);
        if (v) { unitario = v.valor; origem = v.origem; }
      }
      const natural = String(e.competencia || '').trim() || c.competenciaDe(e.data_finalizacao);
      const feita = acum.get(chaveItemSetor(e.pedido_item_id, e.setor_id)) || 0;
      return {
        evento_id: e.id, tipo_item: 'producao', pedido_id: e.pedido_id, pedido: pedido.numero ?? String(e.pedido_id), cliente_id: pedido.cliente_id ?? null,
        pedido_item_id: e.pedido_item_id, produto_id: e.produto_id ?? item.produto_id ?? null,
        produto: [item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${e.pedido_item_id}`,
        setor_id: e.setor_id, setor: setor.nome || `setor ${e.setor_id}`,
        data: c.dia(e.data_finalizacao), quantidade: Number(e.quantidade), estorno_de: e.estorno_de ?? null,
        competencia_natural: natural, competencia: competenciaAlvo(natural, estado.proxima),
        valor_unitario: unitario, valor_origem: origem, sem_valor: unitario === null,
        total: unitario === null ? 0 : c.centavos(unitario * Number(e.quantidade)),
        status_item: statusDoItem(item.quantidade, feita), observacao: e.observacao || null
      };
    });
}

/** Linhas congeladas de um fechamento de produção, no mesmo formato das pendentes. Pura. */
function congeladas(estado, fechamentoId) {
  return estado.congelados
    .filter(i => String(i.fechamento_id) === String(fechamentoId))
    .map(i => ({
      evento_id: i.producao_evento_id, tipo_item: i.tipo_item, pedido_id: i.pedido_id, pedido: i.detalhes?.pedido ?? String(i.pedido_id ?? '—'),
      pedido_item_id: i.detalhes?.pedido_item_id ?? null, produto_id: i.detalhes?.produto_id ?? null, produto: i.produto || '—',
      setor_id: i.detalhes?.setor_id ?? null, setor: i.setor || '—', data: c.dia(i.data_referencia), quantidade: Number(i.quantidade) || 0,
      estorno_de: i.detalhes?.estorno_de ?? null, competencia: i.competencia, competencia_natural: String(i.competencia_origem || '').trim() || i.competencia,
      valor_unitario: i.valor_unitario === null || i.valor_unitario === undefined ? null : c.centavos(i.valor_unitario),
      sem_valor: false, total: c.centavos(i.total), status_item: i.detalhes?.status_item || null, motivo: i.detalhes?.motivo || null
    }));
}

/** Saldo negativo de um setor no último fechamento: passa para o próximo. Pura. */
function saldosAnteriores(estado) {
  const ultimo = estado.ultimo;
  if (!ultimo) return [];
  return (ultimo.resumo || []).filter(s => Number(s.total) < 0).map(s => ({
    evento_id: null, tipo_item: 'saldo', pedido_id: null, pedido: '—', produto: `Saldo de ${c.rotuloCompetencia(String(ultimo.competencia).trim())}`,
    setor_id: s.setor_id ?? null, setor: s.setor, data: null, quantidade: 0, competencia: estado.proxima, competencia_natural: estado.proxima,
    valor_unitario: null, sem_valor: false, total: c.centavos(s.total), motivo: `Saldo negativo de ${s.setor} em ${c.rotuloCompetencia(String(ultimo.competencia).trim())}`,
    fechamento_origem: ultimo.id
  }));
}

/** Totais de uma lista de linhas de produção: peças, por setor, a pagar e a compensar. Pura. */
function resumir(linhas) {
  const porSetor = new Map();
  for (const l of linhas) {
    const k = String(l.setor_id ?? l.setor);
    const s = porSetor.get(k) || { setor_id: l.setor_id ?? null, setor: l.setor, pecas: 0, total: 0 };
    s.pecas += Number(l.quantidade) || 0;
    s.total = c.centavos(s.total + Number(l.total || 0));
    porSetor.set(k, s);
  }
  const setores = [...porSetor.values()].sort((a, b) => String(a.setor).localeCompare(String(b.setor), 'pt-BR'));
  return {
    pecas: linhas.reduce((s, l) => s + (Number(l.quantidade) || 0), 0),
    pedidos: new Set(linhas.filter(l => l.pedido_id).map(l => String(l.pedido_id))).size,
    setores,
    liquido: c.centavos(linhas.reduce((s, l) => s + Number(l.total || 0), 0)),
    a_pagar: c.centavos(setores.filter(s => s.total > 0).reduce((t, s) => t + s.total, 0)),
    a_compensar: c.centavos(setores.filter(s => s.total < 0).reduce((t, s) => t + s.total, 0)),
    sem_valor: linhas.filter(l => l.sem_valor)
  };
}

/** A competência de produção: fechada (congelada) ou em aberto (prévia). Pura. */
function montarCompetencia({ pend, estado, competencia }) {
  const fechado = estado.fechados.get(competencia) || null;
  const linhas = fechado
    ? congeladas(estado, fechado.id)
    : [...pend.filter(p => p.competencia && p.competencia <= competencia), ...(estado.proxima === competencia ? saldosAnteriores(estado) : [])];
  const r = resumir(linhas);
  return {
    competencia, fechado: Boolean(fechado),
    fechamento: fechado ? { id: fechado.id, fechado_em: fechado.fechado_em, pagar_ate: c.dia(fechado.pagar_ate), total: c.centavos(fechado.total), pagamento: fechado.pagamento || null } : null,
    ...r,
    a_pagar: fechado ? c.centavos(fechado.total) : r.a_pagar,
    linhas: linhas.sort((a, b) => String(a.pedido).localeCompare(String(b.pedido), 'pt-BR', { numeric: true }) || String(a.data).localeCompare(String(b.data)))
  };
}

// ------------------------------------------------------------------- leitura

async function itensDe(api, pedidoIds) {
  const unicos = [...new Set(pedidoIds.filter(Boolean).map(String))];
  const listas = await Promise.all(unicos.map(id => api.get('/api/pedidos_itens', { query: { pedido_id: id } })
    .then(r => c.lista(r).filter(i => String(i?.pedido_id) === id)).catch(() => [])));
  return listas.flat();
}

/** Tudo que as telas de produção precisam. */
async function lerBase(api) {
  const [eventos, tudo, fech, pedidos] = await Promise.all([
    c.ler(api, 'producao_eventos'),
    regras.lerTudo(api),
    base.lerFechamentos(api),
    api.get('/api/pedidos').then(c.lista).catch(() => [])
  ]);
  const itens = await itensDe(api, eventos.map(e => e.pedido_id));
  const estado = estadoDosFechamentos({ ...fech, tipo: 'producao' });
  const pedidosPor = new Map(pedidos.filter(Boolean).map(p => [String(p.id), p]));
  const itensPor = new Map(itens.map(i => [String(i.id), i]));
  const setoresPor = new Map(tudo.setores.map(s => [String(s.id), s]));
  const pend = pendentes({ eventos, estado, valores: tudo.valores, itensPor, setoresPor, pedidosPor });
  return { eventos, regras: tudo, estado, pedidos, pedidosPor, itensPor, setoresPor, pend };
}

/** Os pedidos em que se pode registrar produção (para a busca do modal). */
async function pedidosParaProduzir(api) {
  const pedidos = c.lista(await api.get('/api/pedidos').catch(() => [])).filter(podeProduzir);
  const nomes = await base.nomesDosClientes(api, pedidos.map(p => p.cliente_id));
  return pedidos
    .map(p => ({ id: p.id, numero: p.numero ?? String(p.id), cliente: nomes.get(String(p.cliente_id)) || null, situacao: p.situacao }))
    .sort((a, b) => String(b.numero).localeCompare(String(a.numero), 'pt-BR', { numeric: true }));
}

/** Um pedido com os itens e, por setor, o que já foi finalizado e o valor por peça. */
async function doPedido(api, pedidoId) {
  const id = Number(pedidoId);
  const pedido = c.lista(await api.get('/api/pedidos', { query: { id } }).catch(() => [])).find(p => Number(p?.id) === id);
  if (!pedido) throw c.erro('Pedido não encontrado.', 404);
  const [itens, eventos, tudo, nomes] = await Promise.all([
    itensDe(api, [id]),
    c.ler(api, 'producao_eventos', { pedido_id: id }),
    regras.lerTudo(api),
    base.nomesDosClientes(api, [pedido.cliente_id])
  ]);
  const acum = acumulados(eventos);
  const setores = tudo.setores.filter(s => regras.ativo(s.ativo));
  return {
    pedido: { id: pedido.id, numero: pedido.numero ?? String(pedido.id), situacao: pedido.situacao, cliente: nomes.get(String(pedido.cliente_id)) || null, pode_produzir: podeProduzir(pedido) },
    setores: setores.map(s => ({ id: s.id, nome: s.nome })),
    itens: itens.sort((a, b) => Number(a.id) - Number(b.id)).map(i => ({
      id: i.id, produto_id: i.produto_id ?? null, codigo: i.codigo || null, nome: i.nome || null,
      quantidade: Number(i.quantidade) || 0, do_estoque: Number(i.qtd_usar_pronta) || 0,
      setores: setores.map(s => {
        const feita = acum.get(chaveItemSetor(i.id, s.id)) || 0;
        const v = regras.valorUnitario(tudo.valores, i.produto_id, s.id);
        return { setor_id: s.id, finalizada: feita, saldo: Math.max(0, (Number(i.quantidade) || 0) - feita), status: statusDoItem(i.quantidade, feita), valor_unitario: v ? v.valor : null, valor_origem: v ? v.origem : null };
      })
    })),
    eventos: eventos
      .sort((a, b) => String(b.data_finalizacao).localeCompare(String(a.data_finalizacao)) || Number(b.id) - Number(a.id))
      .map(e => ({ ...e, data_finalizacao: c.dia(e.data_finalizacao), setor: (setores.find(s => String(s.id) === String(e.setor_id)) || tudo.setores.find(s => String(s.id) === String(e.setor_id)) || {}).nome || null }))
  };
}

// ------------------------------------------------------------------- escrita

async function registrar({ api, entrada, usuarioId = null, hoje }) {
  const pedidoId = Number(entrada?.pedido_id);
  const itemId = Number(entrada?.pedido_item_id);
  const setorId = Number(entrada?.setor_id);
  const quantidade = Number(entrada?.quantidade);
  const data = String(entrada?.data_finalizacao || '').slice(0, 10);
  if (!(Number.isInteger(pedidoId) && pedidoId > 0)) throw c.erro('Escolha o pedido.');
  if (!(Number.isInteger(itemId) && itemId > 0)) throw c.erro('Escolha a peça do pedido.');
  if (!(Number.isInteger(setorId) && setorId > 0)) throw c.erro('Escolha o setor.');
  if (!(Number.isInteger(quantidade) && quantidade > 0)) throw c.erro('Informe quantas peças foram finalizadas (número inteiro).');
  if (!c.dataValida(data)) throw c.erro('Informe a data da finalização.');
  if (data > hoje) throw c.erro('A data da finalização não pode ser futura.');

  const dados = await doPedido(api, pedidoId);
  if (!dados.pedido.pode_produzir) throw c.erro(`O pedido ${dados.pedido.numero} está "${dados.pedido.situacao}": só se registra produção de pedido aprovado, em produção, enviado ou entregue.`, 409);
  const item = dados.itens.find(i => Number(i.id) === itemId);
  if (!item) throw c.erro('Esta peça não é deste pedido.', 404);
  const setor = dados.setores.find(s => Number(s.id) === setorId);
  if (!setor) throw c.erro('Setor inexistente ou desativado.', 404);
  const doSetor = item.setores.find(s => Number(s.setor_id) === setorId);
  if (quantidade > doSetor.saldo) throw c.erro(`Passa do saldo: o pedido tem ${item.quantidade} e ${doSetor.finalizada} já foram finalizadas em ${setor.nome} (saldo ${doSetor.saldo}).`, 409);

  const descricaoPeca = [item.codigo, item.nome].filter(Boolean).join(' — ') || `item ${item.id}`;
  const evento = await c.inserir(api, 'producao_eventos', {
    pedido_id: pedidoId, pedido_item_id: itemId, produto_id: item.produto_id, setor_id: setorId, quantidade,
    data_finalizacao: data, competencia: c.competenciaDe(data), observacao: c.texto(entrada?.observacao, 500) || null,
    status: 'ativo', criado_por: usuarioId, criado_em: c.agora()
  });

  // Duas máquinas ao mesmo tempo: relê e desfaz se passou da quantidade.
  const depois = acumulados(await c.ler(api, 'producao_eventos', { pedido_id: pedidoId })).get(chaveItemSetor(itemId, setorId)) || 0;
  if (depois > item.quantidade && evento.id) {
    await c.atualizar(api, 'producao_eventos', evento.id, { status: 'estornado', estornado_em: c.agora(), estornado_por: usuarioId, motivo_estorno: 'Registro simultâneo passou da quantidade do pedido' });
    throw c.erro('Outro registro desta peça entrou ao mesmo tempo e o saldo acabou. Confira e registre de novo.', 409);
  }

  await auditoria.registrar(api, {
    tipo: 'producao_registrada', pedidoId, referenciaId: evento.id, usuarioId,
    valor: doSetor.valor_unitario === null ? null : c.centavos(doSetor.valor_unitario * quantidade),
    descricao: `${quantidade} × ${descricaoPeca} finalizada(s) em ${setor.nome} (${c.impressa(data)}) — pedido ${dados.pedido.numero}`
  });
  const feita = doSetor.finalizada + quantidade;
  return {
    evento,
    item: { id: item.id, quantidade: item.quantidade, finalizada: feita, saldo: Math.max(0, item.quantidade - feita), status: statusDoItem(item.quantidade, feita) },
    sem_valor: doSetor.valor_unitario === null
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
      pedido_id: evento.pedido_id, pedido_item_id: evento.pedido_item_id, produto_id: evento.produto_id, setor_id: evento.setor_id,
      quantidade: -Number(evento.quantidade), data_finalizacao: hoje, competencia: c.competenciaDe(hoje),
      observacao: `Estorno do registro ${evento.id}: ${texto}`, status: 'ativo', estorno_de: evento.id, criado_por: usuarioId, criado_em: quando
    });
    await c.atualizar(api, 'producao_eventos', evento.id, campos);
  }
  await auditoria.registrar(api, {
    tipo: 'producao_estornada', pedidoId: evento.pedido_id, referenciaId: evento.id, usuarioId,
    descricao: `Estorno de ${evento.quantidade} peça(s) do registro ${evento.id}${fechado ? ` (já fechado em ${c.rotuloCompetencia(fechado.competencia)}: desconta no próximo fechamento)` : ''}: ${texto}`
  });
  return { evento: { ...evento, ...campos, status: fechado ? evento.status : 'estornado' }, negativo, ja_fechado: Boolean(fechado) };
}

module.exports = {
  SITUACOES_QUE_PRODUZEM, podeProduzir, acumulados, statusDoItem, pendentes, congeladas, saldosAnteriores, resumir, montarCompetencia,
  lerBase, pedidosParaProduzir, doPedido, registrar, estornar
};
