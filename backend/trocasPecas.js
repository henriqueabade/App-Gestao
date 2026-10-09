/**
 * Troca de peças entre pedidos (pedido do dono, 09/10/2026).
 *
 * Na produção acontece de pegar uma peça de um pedido e pôr em outro. Aqui
 * isso fica registrado: a peça do pedido X (no estado em que está — pronta,
 * pela metade ou por começar) vai para o pedido Y, e a peça do MESMO produto
 * que estava em Y vem para X, no estado dela. Nada sai da matéria-prima: as
 * peças só trocam de dono.
 *
 *   - X volta a dever o que falta na peça que recebeu (a pendência dele).
 *   - Y recebe a peça de X como ela está e só deve o que falta nela — quem
 *     recebe a peça pronta não paga a produção de novo.
 *   - O que já foi registrado de produção vale como valia: o valor de um
 *     registro não muda por causa de uma troca feita depois
 *     (financeiro/mudancasUnidades.js e producaoUnidades.alocarComMudancas).
 *
 * Cada troca é uma linha nova de `trocas_pecas` (imutável), um evento no
 * histórico de cada pedido e uma linha na atividade do Financeiro. Nada do
 * que já estava gravado é reescrito.
 *
 * Rotas (montadas em /api/trocas-pecas, permissão ped.trocar_pecas):
 *   GET  /pedido/:id   as peças do pedido, o estado de cada unidade, com que
 *                      peças de outros pedidos cada uma pode trocar e o
 *                      histórico das trocas
 *   POST /             { item_a, chave_a, item_b, chave_b, quantidade, motivo }
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const c = require('./financeiro/comum');
const regras = require('./financeiro/regras');
const producao = require('./financeiro/producao');
const unidades = require('./financeiro/producaoUnidades');
const mudancas = require('./financeiro/mudancasUnidades');
const auditoria = require('./financeiro/auditoria');
const base = require('./financeiro/base');
const { EVENTO, registrarEventoDoPedido } = require('./estoqueLedger');

const PERMISSAO = 'ped.trocar_pecas';
/** Só troca pedido que ainda não saiu (nem Enviado, nem Entregue, nem Cancelado). */
const SITUACOES_QUE_TROCAM = new Set(['aprovado', 'producao']);
const MINIMO_MOTIVO = 10;

const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const podeTrocar = pedido => SITUACOES_QUE_TROCAM.has(semAcento(pedido?.situacao));
const nomeDaPeca = item => [item?.codigo, item?.nome].filter(Boolean).join(' — ') || `peça ${item?.id}`;
const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;

/**
 * O estado das unidades de cada item: o motor da produção (com as trocas já
 * feitas) diz, processo a processo, o que falta em cada unidade, e
 * mudancasUnidades.estadosDasUnidades junta as iguais.
 */
async function estadosDosItens(api, itens) {
  if (!itens.length) return new Map();
  const [tudo, eventos] = await Promise.all([regras.lerTudo(api), c.ler(api, 'producao_eventos')]);
  const etapasPor = new Map(tudo.etapas.map(e => [String(e.id), e]));
  const ativas = tudo.etapas.filter(e => e.producao_ativa);
  const { filaDe, rotaPor, mudancasDe } = await producao.montarFilas(api, { itens, etapasPor });
  const comEtapa = eventos.map(e => ({ ...e, etapa_id: producao.etapaDoEvento(e, { etapas: tudo.etapas, setores: tudo.setores }) }));
  const saida = new Map();
  for (const item of itens) {
    const processos = [];
    for (const etapa of ativas) {
      const fila = filaDe(item.id, etapa.id);
      const mud = mudancasDe(item.id, etapa.id);
      if (!fila.length && !mud.length) continue;
      const doProcesso = comEtapa.filter(e => String(e.pedido_item_id) === String(item.id) && String(e.etapa_id) === String(etapa.id));
      const al = unidades.alocarComMudancas({ fila, eventos: doProcesso, mudancas: mud });
      processos.push({ etapa_id: etapa.id, nome: etapa.nome, pedida: al.pedida, usadas: al.usadas, pendentes: al.pendentes });
    }
    saida.set(String(item.id), mudancas.estadosDasUnidades({ processos, quantidade: item.quantidade, rota: rotaPor.get(String(item.id)) || [] }));
  }
  return saida;
}

/** Os estados como a tela os usa (sem a chave interna repetida no texto). */
const paraTela = estados => (estados || []).map(e => ({
  chave: e.chave, quantidade: e.quantidade, rotulo: e.rotulo, detalhe: e.detalhe, pronta: e.pronta, ordem: e.ordem
}));

/** As trocas que tocam as peças do pedido, mais novas primeiro, para o histórico do modal. */
function historicoDoPedido({ trocas = [], pedidoId, numeros = new Map(), itensPor = new Map() }) {
  return trocas
    .filter(t => String(t.pedido_id_a) === String(pedidoId) || String(t.pedido_id_b) === String(pedidoId))
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)) || Number(b.id) - Number(a.id))
    .map(t => {
      const daqui = String(t.pedido_id_a) === String(pedidoId) ? 'a' : 'b';
      const outro = daqui === 'a' ? 'b' : 'a';
      const item = itensPor.get(String(t[`pedido_item_id_${daqui}`])) || null;
      return {
        id: t.id, em: t.criado_em, quantidade: Number(t.quantidade) || 0,
        peca: item ? nomeDaPeca(item) : `peça ${t[`pedido_item_id_${daqui}`]}`,
        saiu: t[`estado_${daqui}`]?.rotulo || '—', entrou: t[`estado_${outro}`]?.rotulo || '—',
        outro_pedido_id: t[`pedido_id_${outro}`], outro_pedido: numeros.get(String(t[`pedido_id_${outro}`])) || `#${t[`pedido_id_${outro}`]}`,
        motivo: t.motivo || '', criado_por: t.criado_por ?? null
      };
    });
}

/** As avulsas em produção, por item (null sem o SQL). */
async function avulsasVivasPorItem(api) {
  const linhas = await mudancas.lerTabela(api, mudancas.TABELA_AVULSAS, { status: 'em_producao' }).catch(() => null);
  const mapa = new Map();
  for (const a of linhas || []) {
    if (!mapa.has(String(a.pedido_item_id))) mapa.set(String(a.pedido_item_id), []);
    mapa.get(String(a.pedido_item_id)).push(a);
  }
  return mapa;
}

/**
 * O pedido entra na troca? O que ainda não saiu (Aprovado, Produção) — e o
 * cancelado só pelas peças AVULSAS (as que continuam sendo produzidas).
 */
const entraNaTroca = (pedido, itemId, avulsasPorItem) => podeTrocar(pedido)
  || (semAcento(pedido?.situacao) === 'cancelado' && (avulsasPorItem.get(String(itemId)) || []).length > 0);

/** Tudo que o modal precisa para um pedido. */
async function opcoes(api, pedidoId) {
  const id = Number(pedidoId);
  const pedidos = c.lista(await api.get('/api/pedidos').catch(() => []));
  const pedido = pedidos.find(p => Number(p?.id) === id);
  if (!pedido) throw c.erro('Pedido não encontrado.', 404);
  const avulsasPorItem = await avulsasVivasPorItem(api);
  const cancelado = semAcento(pedido.situacao) === 'cancelado';
  // Do pedido cancelado só entram as peças avulsas (09/10/2026).
  const itensDoPedido = (await producao.itensDe(api, [id])).filter(i => !cancelado || (avulsasPorItem.get(String(i.id)) || []).length);
  const liberado = podeTrocar(pedido) || (cancelado && itensDoPedido.length > 0);
  const produtos = new Set(itensDoPedido.map(i => String(i.produto_id)).filter(v => v !== 'null' && v !== 'undefined'));
  const outros = pedidos.filter(p => p && Number(p.id) !== id && podeTrocar(p));
  // As avulsas (de pedidos cancelados) também podem substituir a peça de um pedido.
  const pedidosComAvulsa = cancelado ? [] : pedidos.filter(p => p && Number(p.id) !== id && semAcento(p.situacao) === 'cancelado');
  const itensDosOutros = liberado && produtos.size
    ? (await producao.itensDe(api, [...outros, ...pedidosComAvulsa].map(p => p.id)))
      .filter(i => produtos.has(String(i.produto_id)))
      .filter(i => {
        const doc = pedidos.find(p => String(p.id) === String(i.pedido_id));
        return podeTrocar(doc) || (avulsasPorItem.get(String(i.id)) || []).length > 0;
      })
    : [];
  // A peça avulsa conta as unidades que continuam em produção (as outras do
  // pedido cancelado ganharam outro destino).
  const comUnidadesVivas = i => {
    const doc = pedidos.find(p => String(p.id) === String(i.pedido_id));
    return podeTrocar(doc) ? i : { ...i, quantidade: (avulsasPorItem.get(String(i.id)) || []).length };
  };
  const todos = [...itensDoPedido, ...itensDosOutros].map(comUnidadesVivas);
  const [estados, lidos, nomes] = await Promise.all([
    estadosDosItens(api, todos),
    mudancas.lerDosItens(api, itensDoPedido.map(i => i.id)),
    base.nomesDosClientes(api, [pedido, ...outros].map(p => p.cliente_id))
  ]);
  const pedidoPor = new Map(pedidos.map(p => [String(p.id), p]));
  const numeros = new Map(pedidos.map(p => [String(p.id), p.numero ?? `#${p.id}`]));
  const candidatosDe = item => itensDosOutros
    .filter(o => String(o.produto_id) === String(item.produto_id))
    .map(o => {
      const doc = pedidoPor.get(String(o.pedido_id)) || {};
      const avulsa = !podeTrocar(doc);
      const vivas = (avulsasPorItem.get(String(o.id)) || []).length;
      return {
        tipo: avulsa ? 'avulsa' : 'pedido', pedido_id: o.pedido_id,
        numero: avulsa ? `Peça avulsa (${doc.numero ?? `#${o.pedido_id}`} cancelado)` : (doc.numero ?? `#${o.pedido_id}`),
        cliente: avulsa ? null : (nomes.get(String(doc.cliente_id)) || null),
        situacao: avulsa ? 'Em produção, fora de pedido' : (doc.situacao || null),
        item_id: o.id, quantidade: avulsa ? vivas : (Number(o.quantidade) || 0), estados: paraTela(estados.get(String(o.id)))
      };
    })
    .filter(o => o.estados.length)
    .sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }));
  return {
    sql_pendente: lidos.sql_pendente,
    pedido: {
      id, numero: pedido.numero ?? `#${id}`, situacao: pedido.situacao || null, cliente: nomes.get(String(pedido.cliente_id)) || null,
      pode_trocar: liberado,
      avulsas: cancelado,
      motivo_bloqueio: liberado ? null : (cancelado
        ? 'Pedido cancelado sem peça avulsa em produção: não há peça para trocar.'
        : `Pedido ${pedido.situacao || 'nesta situação'}: só troca peça o pedido que ainda não saiu (Aprovado ou em Produção).`)
    },
    itens: itensDoPedido.sort((a, b) => Number(a.id) - Number(b.id)).map(comUnidadesVivas).map(i => ({
      id: i.id, produto_id: i.produto_id ?? null, codigo: i.codigo || null, nome: i.nome || null, quantidade: Number(i.quantidade) || 0,
      estados: paraTela(estados.get(String(i.id))),
      // Do pedido cancelado, a avulsa só troca com pedido (avulsa com avulsa não muda nada).
      candidatos: candidatosDe(i).filter(o => !cancelado || o.tipo === 'pedido')
    })),
    historico: historicoDoPedido({ trocas: lidos.trocas, pedidoId: id, numeros, itensPor: new Map(itensDoPedido.map(i => [String(i.id), i])) }),
    minimo_motivo: MINIMO_MOTIVO
  };
}

/** Confere a entrada da troca. Pura. */
function validar(entrada) {
  const itemA = Number(entrada?.item_a);
  const itemB = Number(entrada?.item_b);
  if (!(Number.isInteger(itemA) && itemA > 0) || !(Number.isInteger(itemB) && itemB > 0)) throw c.erro('Escolha as duas peças da troca.', 422);
  if (itemA === itemB) throw c.erro('A troca é entre peças de pedidos diferentes.', 422);
  const chaveA = String(entrada?.chave_a || '');
  const chaveB = String(entrada?.chave_b || '');
  if (!chaveA || !chaveB) throw c.erro('Escolha o estado da peça que sai de cada pedido.', 422);
  const quantidade = Number(entrada?.quantidade ?? 1);
  if (!(Number.isInteger(quantidade) && quantidade > 0)) throw c.erro('Informe quantas peças trocam.', 422);
  const motivo = c.texto(entrada?.motivo, 500);
  if (motivo.replace(/[^\p{L}]/gu, '').length < MINIMO_MOTIVO) throw c.erro(`Diga o motivo da troca (ao menos ${MINIMO_MOTIVO} letras).`, 422);
  return { itemA, itemB, chaveA, chaveB, quantidade, motivo };
}

/** O estado que vai para a linha da troca (texto JSON): o que faltava em cada processo. Pura. */
const estadoParaGravar = e => JSON.stringify({ chave: e.chave, rotulo: e.rotulo, detalhe: e.detalhe, ordem: e.ordem, passo_id: e.passo_id ?? null, restante: e.restante });

async function trocar({ api, entrada, usuarioId = null }) {
  const v = validar(entrada);
  const [itensA, itensB] = await Promise.all([
    c.ler(api, 'pedidos_itens', { id: v.itemA }),
    c.ler(api, 'pedidos_itens', { id: v.itemB })
  ]);
  const itemA = itensA[0];
  const itemB = itensB[0];
  if (!itemA || !itemB) throw c.erro('Peça não encontrada.', 404);
  if (String(itemA.produto_id) !== String(itemB.produto_id)) throw c.erro('A troca é entre peças do mesmo produto.', 422);
  if (String(itemA.pedido_id) === String(itemB.pedido_id)) throw c.erro('A troca é entre peças de pedidos diferentes.', 422);
  const pedidos = c.lista(await api.get('/api/pedidos').catch(() => []));
  const pedidoA = pedidos.find(p => String(p?.id) === String(itemA.pedido_id));
  const pedidoB = pedidos.find(p => String(p?.id) === String(itemB.pedido_id));
  const avulsasPorItem = await avulsasVivasPorItem(api);
  for (const [p, item] of [[pedidoA, itemA], [pedidoB, itemB]]) {
    if (!p) throw c.erro('Pedido não encontrado.', 404);
    if (!entraNaTroca(p, item.id, avulsasPorItem)) throw c.erro(`O ${p.numero || `pedido ${p.id}`} está ${p.situacao || 'nesta situação'}: só troca peça o pedido que ainda não saiu (Aprovado ou em Produção).`, 409);
  }
  // O estado de AGORA (outra troca ou um registro de produção pode ter mudado a peça).
  // A peça avulsa (pedido cancelado) conta só as unidades que seguem em produção.
  const vivasDe = item => (avulsasPorItem.get(String(item.id)) || []);
  const comUnidadesVivas = (p, item) => (podeTrocar(p) ? item : { ...item, quantidade: vivasDe(item).length });
  const estados = await estadosDosItens(api, [comUnidadesVivas(pedidoA, itemA), comUnidadesVivas(pedidoB, itemB)]);
  const grupoA = (estados.get(String(itemA.id)) || []).find(e => e.chave === v.chaveA);
  const grupoB = (estados.get(String(itemB.id)) || []).find(e => e.chave === v.chaveB);
  if (!grupoA || !grupoB) throw c.erro('O estado de uma das peças mudou enquanto a tela estava aberta. Atualize e escolha de novo.', 409);
  if (v.quantidade > grupoA.quantidade || v.quantidade > grupoB.quantidade) {
    throw c.erro(`Só há ${plural(Math.min(grupoA.quantidade, grupoB.quantidade), 'peça', 'peças')} nesse estado para trocar.`, 409);
  }
  if (grupoA.chave === grupoB.chave) throw c.erro('As duas peças estão no mesmo estado: trocar não muda nada.', 422);

  let troca;
  try {
    troca = await api.post(`/api/${mudancas.TABELA_TROCAS}`, {
      produto_id: itemA.produto_id ?? null, quantidade: v.quantidade,
      pedido_id_a: itemA.pedido_id, pedido_item_id_a: itemA.id, pedido_id_b: itemB.pedido_id, pedido_item_id_b: itemB.id,
      estado_a: estadoParaGravar(grupoA), estado_b: estadoParaGravar(grupoB),
      avulsa_id_a: podeTrocar(pedidoA) ? null : (vivasDe(itemA)[0]?.id ?? null),
      avulsa_id_b: podeTrocar(pedidoB) ? null : (vivasDe(itemB)[0]?.id ?? null),
      motivo: v.motivo, criado_por: usuarioId, criado_em: c.agora()
    });
  } catch (e) {
    if (mudancas.tabelaAusente(e)) throw c.erro(mudancas.SQL_FALTANDO, 409, { sql_pendente: true, arquivo: mudancas.SQL_ARQUIVO });
    throw e;
  }
  const trocaId = troca?.id ?? troca?.[0]?.id ?? null;

  // O lado AVULSA: as avulsas que saíram ficam "trocadas", e a peça que
  // chegou ao pedido cancelado vira avulsa, no estado dela (ela continua em
  // produção fora de pedido). A troca em si já diz à produção o que mudou.
  for (const [p, item, chegou] of [[pedidoA, itemA, grupoB], [pedidoB, itemB, grupoA]]) {
    if (podeTrocar(p)) continue;
    const saem = [...vivasDe(item)].sort((x, y) => String(x.criado_em).localeCompare(String(y.criado_em)) || Number(x.id) - Number(y.id)).slice(0, v.quantidade);
    for (const a of saem) {
      await c.atualizar(api, mudancas.TABELA_AVULSAS, a.id, {
        status: 'trocada', encerrada_em: c.agora(), encerrada_por: usuarioId,
        encerramento: JSON.stringify({ tipo: 'trocada', troca_id: trocaId })
      });
    }
    const estado = JSON.stringify({ ordem_origem: chegou.ordem, ordem: chegou.ordem, passo_id: chegou.passo_id ?? null, rotulo: chegou.rotulo, restante: chegou.restante });
    for (let k = 0; k < v.quantidade; k += 1) {
      await api.post(`/api/${mudancas.TABELA_AVULSAS}`, {
        pedido_id: item.pedido_id, pedido_item_id: item.id, produto_id: item.produto_id ?? null, quantidade: 1,
        lote: `troca:${trocaId}`, origem: 'troca', troca_id: trocaId, estado_inicio: estado, status: 'em_producao',
        criado_por: usuarioId, criado_em: c.agora()
      });
    }
  }

  // A história, nos dois pedidos e no Financeiro (a produção dos dois muda).
  const peca = nomeDaPeca(itemA);
  const numeroA = pedidoA.numero || `#${pedidoA.id}`;
  const numeroB = pedidoB.numero || `#${pedidoB.id}`;
  const frase = (de, para, saiu, entrou) => `Troca de peça com o ${para}: saiu ${v.quantidade} × ${peca} (${saiu}) e entrou ${v.quantidade} × ${peca} (${entrou}). Motivo: ${v.motivo}`;
  const avisos = [];
  await registrarEventoDoPedido(api, { pedidoId: pedidoA.id, tipoEvento: EVENTO.TRANSFERENCIA, descricao: frase(numeroA, numeroB, grupoA.rotulo, grupoB.rotulo), usuarioId }, avisos);
  await registrarEventoDoPedido(api, { pedidoId: pedidoB.id, tipoEvento: EVENTO.TRANSFERENCIA, descricao: frase(numeroB, numeroA, grupoB.rotulo, grupoA.rotulo), usuarioId }, avisos);
  for (const [pedido, outro, saiu, entrou, item] of [[pedidoA, numeroB, grupoA, grupoB, itemA], [pedidoB, numeroA, grupoB, grupoA, itemB]]) {
    await auditoria.registrar(api, {
      tipo: 'troca_pecas', pedidoId: pedido.id, referenciaId: trocaId, usuarioId,
      descricao: `${pedido.numero || `#${pedido.id}`}: ${v.quantidade} × ${peca} trocada com o ${outro} — saiu ${saiu.rotulo}, entrou ${entrou.rotulo}. ${v.motivo}`,
      dados: { troca_id: trocaId, pedido_item_id: item.id, saiu: saiu.restante, entrou: entrou.restante }
    });
  }
  return {
    troca: { id: trocaId, quantidade: v.quantidade, peca },
    a: { pedido: numeroA, saiu: grupoA.rotulo, entrou: grupoB.rotulo, volta_a_dever: !grupoB.pronta },
    b: { pedido: numeroB, saiu: grupoB.rotulo, entrou: grupoA.rotulo, volta_a_dever: !grupoA.pronta },
    avisos
  };
}

// ------------------------------------------------------------------- rotas

const router = express.Router();
const usuarioDe = req => require('./cobrancaController').usuarioDaRequisicao(req);
const responder = (rotulo, fn) => async (req, res) => {
  try {
    res.json(await fn(createApiClient(req), req));
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error(`[trocas-pecas] ${rotulo}:`, err);
    res.status(status).json({ error: err?.message || 'Não foi possível concluir a troca.', ...(err?.extra || {}) });
  }
};

router.get('/pedido/:id', exigirPermissao(PERMISSAO), responder('opcoes', (api, req) => opcoes(api, req.params.id)));
router.post('/', exigirPermissao(PERMISSAO), responder('trocar', (api, req) => trocar({ api, entrada: req.body, usuarioId: usuarioDe(req) })));

module.exports = router;
Object.assign(module.exports, { PERMISSAO, SITUACOES_QUE_TROCAM, podeTrocar, estadosDosItens, historicoDoPedido, opcoes, validar, trocar });
