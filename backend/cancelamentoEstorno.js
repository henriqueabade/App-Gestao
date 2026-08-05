/**
 * Estorno de um pedido cancelado.
 *
 * O QUE O CANCELAMENTO DESFAZ
 * ---------------------------
 * A conversão fez três coisas com o estoque, e cada uma volta de um jeito:
 *
 *   1. Tirou PEÇAS de lotes (`pedido_itens_ext` diz de qual lote saiu cada uma).
 *   2. Prometeu peças a PRODUZIR (`reservas_estoque`, status "producao").
 *   3. Abateu MATÉRIA-PRIMA para produzir as peças do item 2.
 *
 * A DECISÃO É DO USUÁRIO, NÃO NOSSA
 * ---------------------------------
 * O modal de cancelamento pergunta, peça a peça, o que fazer: devolver ao
 * estoque, descartar, ou realocar para outro pedido. Essas decisões chegavam ao
 * backend e eram DESCARTADAS — o pedido virava "Cancelado" e nada voltava.
 *
 * As três ações significam:
 *
 *   `stock`      a peça EXISTE e volta para o estoque.
 *   `discard`    a peça não existe e não vai existir.
 *   `reallocate` a peça vai servir a outro pedido.
 *
 * MATÉRIA-PRIMA
 * -------------
 * Só volta no `discard`, e só a das peças que seriam produzidas DO ZERO. O
 * porquê de cada parte dessa frase:
 *
 *  - `stock`: a peça existe, então o material virou peça. Devolver os dois
 *    contaria o mesmo material duas vezes.
 *  - peça que veio do estoque: o material dela foi consumido num pedido antigo,
 *    não neste. Não há o que devolver aqui.
 *  - peça pela metade: o material dos passos que faltavam foi consumido para
 *    terminá-la. Se ela é descartada, esse material foi perdido junto.
 *
 * O que sobra é o caso comum: o pedido é cancelado antes de a produção começar,
 * o material tinha sido abatido na conversão por antecipação, e volta.
 */

const {
  MOV,
  ITEM,
  RESERVA,
  registrarMovimento,
  atualizarStatusDasReservas
} = require('./estoqueLedger');

const TABELA_LOTES = '/api/produtos_em_cada_ponto';

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function arredondar(valor) {
  return Math.round((paraNumero(valor) + Number.EPSILON) * 10000) / 10000;
}

/**
 * Decisões do modal, agrupadas por peça do pedido.
 *
 * O modal manda uma linha por ação (`{ item, action, quantity, orderId }`), e a
 * mesma peça pode aparecer em várias — parte volta ao estoque, parte é
 * descartada, parte vai para outro pedido.
 */
function agruparAcoes(acoes = []) {
  const porItem = new Map();

  for (const acao of (Array.isArray(acoes) ? acoes : [])) {
    const itemId = acao?.item?.id ?? acao?.item ?? null;
    if (itemId === null || itemId === undefined) continue;
    const chave = String(itemId);

    if (!porItem.has(chave)) {
      porItem.set(chave, { devolver: 0, descartar: 0, realocar: [] });
    }
    const alvo = porItem.get(chave);
    const quantidade = paraNumero(acao?.quantity);
    if (!(quantidade > 0)) continue;

    if (acao.action === 'stock') alvo.devolver = arredondar(alvo.devolver + quantidade);
    else if (acao.action === 'discard') alvo.descartar = arredondar(alvo.descartar + quantidade);
    else if (acao.action === 'reallocate') {
      alvo.realocar.push({ pedidoDestino: acao.orderId ?? null, quantidade });
    }
  }

  return porItem;
}

/** Rota do produto, ordenada, com o nome de cada insumo. */
async function carregarRota(api, produtoId, cacheRotas) {
  const chave = Number(produtoId);
  if (cacheRotas.has(chave)) return cacheRotas.get(chave);

  const bruta = await api
    .get('/api/produtos_insumos', { query: { produto_id: chave } })
    .catch(() => []);
  const rota = (Array.isArray(bruta) ? bruta : [])
    .map(p => ({
      passo_id: Number(p.id),
      insumo_id: Number(p.insumo_id),
      por_unidade: paraNumero(p.quantidade),
      ordem: paraNumero(p.ordem_insumo)
    }))
    .sort((a, b) => a.ordem - b.ordem);

  cacheRotas.set(chave, rota);
  return rota;
}

/**
 * Devolve `quantidade` ao lote de onde a peça saiu.
 *
 * O lote é lido pelo id gravado em `pedido_itens_ext.etapa_id` — apesar do nome,
 * essa coluna aponta para `produtos_em_cada_ponto`. Se o lote não existir mais
 * (foi excluído no meio do caminho), a peça vira um lote novo no mesmo ponto da
 * rota, em vez de sumir.
 */
async function devolverAoLote(api, { loteId, produtoId, ultimoInsumoId, etapa, quantidade }, avisos) {
  if (!(quantidade > 0)) return null;

  if (loteId !== null && loteId !== undefined) {
    const lote = await api.get(`${TABELA_LOTES}/${loteId}`).catch(() => null);
    if (lote && !lote.error) {
      const nova = arredondar(paraNumero(lote.quantidade) + quantidade);
      await api.put(`${TABELA_LOTES}/${loteId}`, {
        quantidade: nova,
        data_hora_completa: new Date().toISOString()
      });
      return Number(loteId);
    }
    avisos.push(`O lote ${loteId} não existe mais: a peça voltou como lote novo.`);
  }

  const criado = await api.post(TABELA_LOTES, {
    produto_id: produtoId,
    etapa_id: etapa ?? null,
    ultimo_insumo_id: ultimoInsumoId ?? null,
    quantidade,
    data_hora_completa: new Date().toISOString()
  });
  return criado?.id ?? null;
}

/**
 * @param {object} api
 * @param {object} entrada
 * @param {number} entrada.pedidoId
 * @param {Array}  entrada.acoes      decisões do modal de cancelamento
 * @param {number|null} entrada.usuarioId
 * @param {Function} entrada.registrarEntradaInsumo  `registrarEntrada` da
 *   matéria-prima, injetada para o teste não precisar de rede.
 */
async function estornarCancelamento(api, {
  pedidoId,
  acoes = [],
  usuarioId = null,
  registrarEntradaInsumo = null
} = {}) {
  const avisos = [];
  const resumo = {
    pecasDevolvidas: 0,
    pecasDescartadas: 0,
    pecasRealocadas: 0,
    insumosDevolvidos: 0,
    reservasRetornadas: 0
  };

  const porItem = agruparAcoes(acoes);

  const [itens, doEstoque, reservas] = await Promise.all([
    api.get('/api/pedidos_itens', { query: { pedido_id: pedidoId } }).catch(() => []),
    api.get('/api/pedido_itens_ext', { query: { id_pedido: pedidoId } }).catch(() => []),
    api.get('/api/reservas_estoque', { query: { pedido_id: pedidoId } }).catch(() => [])
  ]);

  const listaItens = (Array.isArray(itens) ? itens : [])
    .filter(i => String(i?.pedido_id) === String(pedidoId));
  const extPorItem = new Map();
  for (const reg of (Array.isArray(doEstoque) ? doEstoque : [])) {
    const chave = String(reg.pedido_item_id);
    if (!extPorItem.has(chave)) extPorItem.set(chave, []);
    extPorItem.get(chave).push(reg);
  }
  const reservaPorItem = new Map();
  for (const r of (Array.isArray(reservas) ? reservas : [])) {
    if (String(r?.pedido_id) !== String(pedidoId)) continue;
    reservaPorItem.set(String(r.pedido_item_id), r);
  }

  const cacheRotas = new Map();

  for (const item of listaItens) {
    const chave = String(item.id);
    const decisao = porItem.get(chave);
    // Sem decisão para esta peça, nada é mexido. Cancelar não pode devolver
    // estoque "por padrão": é justamente a escolha que o modal foi feito para
    // capturar.
    if (!decisao) continue;

    const produtoId = Number(item.produto_id);
    const rota = await carregarRota(api, produtoId, cacheRotas);
    const doZeroDaPeca = paraNumero(reservaPorItem.get(chave)?.quantidade);

    // ----------------------------------------------------------------
    // 1. Devolver ao estoque
    //
    // Primeiro as peças que SAÍRAM de lotes: elas voltam para o lote de origem,
    // no mesmo ponto da rota em que estavam. Só o que sobrar da devolução é
    // tratado como peça produzida do zero.
    // ----------------------------------------------------------------
    let aDevolver = decisao.devolver;

    for (const reg of (extPorItem.get(chave) || [])) {
      if (!(aDevolver > 0)) break;
      const disponivel = paraNumero(reg.quantidade);
      const devolver = Math.min(disponivel, aDevolver);
      if (!(devolver > 0)) continue;

      const passo = rota.find(p => Number(p.passo_id) === Number(reg.ultimo_insumo_id)) || null;
      const loteId = await devolverAoLote(api, {
        loteId: reg.etapa_id,
        produtoId,
        ultimoInsumoId: passo?.insumo_id ?? null,
        etapa: null,
        quantidade: devolver
      }, avisos);

      await registrarMovimento(api, {
        tipoMovimento: MOV.RETORNO,
        tipoItem: ITEM.PECA,
        itemId: produtoId,
        quantidade: devolver,
        pedidoId,
        pedidoItemId: item.id,
        loteId,
        ultimoInsumoId: passo?.insumo_id ?? null,
        nota: 'Devolvida ao estoque no cancelamento do pedido',
        usuarioId
      }, avisos);

      resumo.pecasDevolvidas = arredondar(resumo.pecasDevolvidas + devolver);
      aDevolver = arredondar(aDevolver - devolver);
    }

    // O que sobrou seria produzido do zero e o usuário disse que a peça existe:
    // ela entra no estoque acabada, no fim da rota.
    if (aDevolver > 0) {
      const ultimoPasso = rota.length ? rota[rota.length - 1] : null;
      const loteId = await devolverAoLote(api, {
        loteId: null,
        produtoId,
        ultimoInsumoId: ultimoPasso?.insumo_id ?? null,
        etapa: null,
        quantidade: aDevolver
      }, avisos);

      await registrarMovimento(api, {
        tipoMovimento: MOV.RETORNO,
        tipoItem: ITEM.PECA,
        itemId: produtoId,
        quantidade: aDevolver,
        pedidoId,
        pedidoItemId: item.id,
        loteId,
        ultimoInsumoId: ultimoPasso?.insumo_id ?? null,
        nota: 'Peça produzida entrou no estoque no cancelamento do pedido',
        usuarioId
      }, avisos);

      resumo.pecasDevolvidas = arredondar(resumo.pecasDevolvidas + aDevolver);
    }

    // ----------------------------------------------------------------
    // 2. Descarte
    //
    // A peça não volta. A MATÉRIA-PRIMA volta — mas só a das unidades que
    // seriam produzidas do zero, e só até o total delas. Ver o cabeçalho.
    // ----------------------------------------------------------------
    if (decisao.descartar > 0) {
      resumo.pecasDescartadas = arredondar(resumo.pecasDescartadas + decisao.descartar);

      await registrarMovimento(api, {
        tipoMovimento: MOV.SAIDA,
        tipoItem: ITEM.PECA,
        itemId: produtoId,
        quantidade: decisao.descartar,
        pedidoId,
        pedidoItemId: item.id,
        nota: 'Descartada no cancelamento do pedido',
        usuarioId
      }, avisos);

      const unidadesDeMaterial = Math.min(decisao.descartar, doZeroDaPeca);
      if (unidadesDeMaterial > 0 && typeof registrarEntradaInsumo === 'function') {
        for (const passo of rota) {
          const quantidade = arredondar(passo.por_unidade * unidadesDeMaterial);
          if (!(quantidade > 0)) continue;
          try {
            await registrarEntradaInsumo(passo.insumo_id, quantidade, usuarioId, {
              origem: 'pedido',
              pedidoId,
              nota: 'Devolvido no cancelamento do pedido'
            });
            await registrarMovimento(api, {
              tipoMovimento: MOV.RETORNO_INSUMO,
              tipoItem: ITEM.INSUMO,
              itemId: passo.insumo_id,
              quantidade,
              pedidoId,
              pedidoItemId: item.id,
              nota: 'Devolvido no cancelamento do pedido',
              usuarioId
            }, avisos);
            resumo.insumosDevolvidos += 1;
          } catch (err) {
            avisos.push(`Falha ao devolver o insumo ${passo.insumo_id}: ${err?.message || err}`);
          }
        }
      }
    }

    // ----------------------------------------------------------------
    // 3. Realocação para outro pedido
    //
    // Nada volta ao estoque: a peça troca de dono. Fica registrada em
    // `realocacoes` e num movimento de transferência, que é o que permite
    // depois responder "para onde foi a peça deste pedido cancelado?".
    // ----------------------------------------------------------------
    for (const destino of decisao.realocar) {
      if (!(destino.quantidade > 0)) continue;

      const movimentoId = await registrarMovimento(api, {
        tipoMovimento: MOV.TRANSFERENCIA,
        tipoItem: ITEM.PECA,
        itemId: produtoId,
        quantidade: destino.quantidade,
        pedidoId,
        pedidoItemId: item.id,
        nota: `Realocada para o pedido ${destino.pedidoDestino} no cancelamento`,
        usuarioId
      }, avisos);

      try {
        await api.post('/api/realocacoes', {
          movimento_id_origem: movimentoId,
          pedido_id_destino: destino.pedidoDestino,
          created_at: new Date().toISOString(),
          created_by: usuarioId
        });
      } catch (err) {
        avisos.push(`Falha ao registrar a realocação para o pedido ${destino.pedidoDestino}: ${err?.message || err}`);
      }

      resumo.pecasRealocadas = arredondar(resumo.pecasRealocadas + destino.quantidade);
    }
  }

  // As reservas de produção encerram como "retornada": a promessa de peça deste
  // pedido não vale mais, qualquer que tenha sido o destino escolhido.
  resumo.reservasRetornadas = await atualizarStatusDasReservas(
    api, pedidoId, RESERVA.RETORNADA, avisos
  );

  return { resumo, avisos };
}

module.exports = { estornarCancelamento, agruparAcoes };
