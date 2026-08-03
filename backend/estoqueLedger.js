/**
 * Razão de estoque — o registro de TUDO que acontece com peça e insumo.
 *
 * Quatro tabelas, cada uma respondendo a uma pergunta diferente:
 *
 *  | tabela                   | responde                                        |
 *  |--------------------------|-------------------------------------------------|
 *  | `estoque_movimentos`     | o que aconteceu, unitário, com data e autor     |
 *  | `pedido_itens_ext`       | quais peças DO ESTOQUE entraram em qual pedido  |
 *  | `reservas_estoque`       | quais peças serão PRODUZIDAS para qual pedido   |
 *  | `pedido_historico_eventos`| o que aconteceu com o PEDIDO (não com o estoque)|
 *
 * A separação importa no cancelamento: `pedido_itens_ext` diz o que devolver ao
 * estoque (veio de lá) e `reservas_estoque` diz o que entra no estoque como
 * peça nova (foi produzida). Sem essa distinção, cancelar ou devolve peça que
 * nunca existiu, ou perde peça que existia.
 *
 * NADA aqui derruba a operação que o chamou. Registrar é importante, mas um
 * erro de escrita no razão não pode desfazer uma conversão que já aconteceu —
 * as falhas voltam como aviso.
 */

// ---------------------------------------------------------------------------
// Vocabulário dos enums.
//
// Os nomes vêm do banco — inventar sinônimos faria todo INSERT falhar. Os
// valores abaixo foram acrescentados por sql/novascolunas2.sql porque os que
// existiam perdiam informação: `abatimento` para tudo não distingue peça
// pronta de peça pela metade nem de insumo, e `reservado` não é o ciclo
// produção -> finalizado -> retornada que a operação usa.
//
// IMPORTANTE: o SQL precisa ter rodado antes. Se não rodou, o banco recusa a
// linha e o movimento vira aviso — a conversão continua funcionando.
// ---------------------------------------------------------------------------
const MOV = {
  /** Peça colocada no estoque pelo módulo de Produtos. */
  ENTRADA: 'entrada_estoque',
  /** Peça retirada pelo módulo de Produtos. */
  SAIDA: 'saida_estoque',
  AJUSTE: 'ajuste_estoque',
  /** Peça ACABADA do estoque usada num pedido. */
  CONSUMO_PRONTA: 'consumo_peca_pronta',
  /** Peça INACABADA do estoque usada num pedido. */
  CONSUMO_PARCIAL: 'consumo_peca_parcial',
  CONSUMO_INSUMO: 'consumo_insumo',
  /** Peça devolvida ao estoque por cancelamento. */
  RETORNO: 'retorno_cancelamento',
  RETORNO_INSUMO: 'retorno_cancelamento',
  RESERVA: 'reserva',
  TRANSFERENCIA: 'transferencia',
  CANCELAMENTO: 'cancelamento',
  NEGATIVA: 'negativa'
};

const ITEM = { PECA: 'peca', INSUMO: 'insumo' };

const RESERVA = {
  /** Nasce assim: peça prometida ao pedido, ainda será fabricada. */
  PRODUCAO: 'producao',
  /** Pedido enviado: a peça saiu. */
  FINALIZADO: 'finalizado',
  /** Cancelamento: a peça volta ao estoque. */
  RETORNADA: 'retornada',
  TRANSFERIDO: 'transferido',
  NEGADO: 'negado'
};

const EVENTO = {
  CRIACAO: 'criacao',
  CONVERSAO: 'conversao',
  ABATIMENTO: 'abatimento',
  REVERSAO: 'reversao',
  REALOCACAO: 'realocacao',
  CANCELAMENTO: 'cancelamento',
  EDICAO: 'edicao',
  TRANSFERENCIA: 'transferencia'
};

function paraNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Grava um movimento.
 *
 * @returns {Promise<number|null>} id do movimento, quando a API devolve.
 *   O id importa: `pedido_historico_eventos.movimento_id` aponta para ele, e é
 *   assim que um evento do pedido se liga ao que de fato mexeu no estoque.
 */
async function registrarMovimento(api, {
  tipoMovimento,
  tipoItem = ITEM.PECA,
  itemId,
  quantidade,
  pedidoId = null,
  pedidoItemId = null,
  loteId = null,
  ultimoInsumoId = null,
  reservaId = null,
  movimentoOrigemId = null,
  estornoDeMovimentoId = null,
  saldoNegativoAutorizado = null,
  nota = null,
  usuarioId = null
} = {}, avisos = []) {
  if (!tipoMovimento || itemId === null || itemId === undefined) return null;
  const qtd = paraNumero(quantidade);
  if (!(qtd > 0)) return null;

  try {
    const criado = await api.post('/api/estoque_movimentos', {
      tipo_movimento: tipoMovimento,
      tipo_item: tipoItem,
      item_id: itemId,
      quantidade: qtd,
      pedido_id: pedidoId,
      pedido_item_id: pedidoItemId,
      lote_id: loteId,
      ultimo_insumo_id: ultimoInsumoId,
      reserva_id: reservaId,
      source_movement_id: movimentoOrigemId,
      reversal_of_movement_id: estornoDeMovimentoId,
      saldo_negativo_autorizado: saldoNegativoAutorizado,
      decision_note: nota,
      created_at: new Date().toISOString(),
      created_by: usuarioId
    });
    return criado?.id ?? criado?.[0]?.id ?? null;
  } catch (err) {
    avisos.push(`Falha ao registrar movimento de estoque (${tipoMovimento}): ${err?.message || err}`);
    return null;
  }
}

/**
 * Peça que veio DO ESTOQUE para o pedido.
 *
 * Vai para `pedido_itens_ext` — e SÓ ela. Peça produzida do zero não entra
 * aqui de propósito: ela nunca esteve no estoque, e registrá-la faria o
 * cancelamento "devolver" ao estoque algo que nunca saiu de lá.
 */
async function registrarPecaDoEstoque(api, {
  pedidoId,
  pedidoItemId,
  produtoId,
  loteId,
  ultimoInsumoId,
  etapaId,
  quantidade,
  parcial = false,
  usuarioId = null
}, { inserirLinhaComId, getMaxId, proximoId = null } = {}, avisos = []) {
  const qtd = paraNumero(quantidade);
  if (!(qtd > 0)) return { proximoId };

  let idParaUsar = proximoId;
  try {
    if (idParaUsar === null || idParaUsar === undefined) {
      idParaUsar = (await getMaxId(api, 'pedido_itens_ext')) + 1;
    }
    // `produtos_em_cada_ponto.etapa_id` é TEXTO (guarda "Embalagem",
    // "Acabamento"), mas `pedido_itens_ext.etapa_id` é BIGINT. Mandar o nome
    // do processo aqui fazia o INSERT falhar por tipo — e como a falha virava
    // só um aviso, a tabela ficava vazia sem ninguém perceber, enquanto o
    // movimento (que não tem essa coluna) gravava normalmente.
    const etapaNumerica = Number.isFinite(Number(etapaId)) && String(etapaId).trim() !== ''
      ? Number(etapaId)
      : null;

    const linha = {
      pedido_item_id: pedidoItemId,
      ultimo_insumo_id: ultimoInsumoId,
      etapa_id: etapaNumerica,
      quantidade: qtd,
      id_pedido: pedidoId
    };

    // PRIMEIRO sem id, como todas as outras tabelas do razão que funcionam
    // (estoque_movimentos, reservas_estoque, faltantes). Esta era a ÚNICA que
    // mandava id explícito, e era a única que ficava vazia — se a coluna tem
    // default/identity, o id de fora é justamente o que faz o INSERT falhar.
    try {
      await api.post('/api/pedido_itens_ext', linha);
    } catch (semId) {
      // Sem default: aí sim precisa do id calculado.
      const usado = await inserirLinhaComId(api, 'pedido_itens_ext', linha, idParaUsar);
      idParaUsar = usado + 1;
    }
  } catch (err) {
    avisos.push(`Falha ao registrar a peça retirada do estoque: ${err?.message || err}`);
  }

  await registrarMovimento(api, {
    tipoMovimento: parcial ? MOV.CONSUMO_PARCIAL : MOV.CONSUMO_PRONTA,
    tipoItem: ITEM.PECA,
    itemId: produtoId,
    quantidade: qtd,
    pedidoId,
    pedidoItemId,
    loteId,
    ultimoInsumoId,
    usuarioId
  }, avisos);

  return { proximoId: idParaUsar };
}

/**
 * Peça que será PRODUZIDA DO ZERO para o pedido.
 *
 * Vai para `reservas_estoque` com status "producao". Ela ainda não existe em
 * lugar nenhum — é uma promessa. Quando o pedido é enviado vira "finalizado";
 * se for cancelado, vira "retornada" e a peça entra no estoque, porque nesse
 * ponto ela já foi (ou está sendo) fabricada.
 */
async function registrarReservaDeProducao(api, {
  pedidoId,
  pedidoItemId,
  produtoId,
  ultimoInsumoId = null,
  quantidade,
  usuarioId = null
} = {}, avisos = []) {
  const qtd = paraNumero(quantidade);
  if (!(qtd > 0)) return null;

  try {
    const criado = await api.post('/api/reservas_estoque', {
      pedido_id: pedidoId,
      pedido_item_id: pedidoItemId,
      tipo_item: ITEM.PECA,
      item_id: produtoId,
      ultimo_insumo_id: ultimoInsumoId,
      quantidade: qtd,
      status: RESERVA.PRODUCAO,
      created_at: new Date().toISOString(),
      created_by: usuarioId
    });
    return criado?.id ?? criado?.[0]?.id ?? null;
  } catch (err) {
    avisos.push(`Falha ao registrar a reserva de produção: ${err?.message || err}`);
    return null;
  }
}

/** Insumo abatido para produzir. */
async function registrarConsumoDeInsumo(api, {
  pedidoId,
  insumoId,
  quantidade,
  saldoNegativoAutorizado = null,
  nota = null,
  usuarioId = null
} = {}, avisos = []) {
  return registrarMovimento(api, {
    tipoMovimento: MOV.CONSUMO_INSUMO,
    tipoItem: ITEM.INSUMO,
    itemId: insumoId,
    quantidade,
    pedidoId,
    saldoNegativoAutorizado,
    nota,
    usuarioId
  }, avisos);
}

/**
 * Evento do PEDIDO — não do estoque.
 *
 * Aqui entra o que aconteceu com o pedido em si (converteu, enviou, cancelou).
 * O `movimentoId` liga o evento ao movimento de estoque que ele causou, quando
 * houver um.
 */
async function registrarEventoDoPedido(api, {
  pedidoId,
  tipoEvento,
  descricao = null,
  movimentoId = null,
  usuarioId = null
} = {}, avisos = []) {
  if (!pedidoId || !tipoEvento) return null;
  try {
    const criado = await api.post('/api/pedido_historico_eventos', {
      pedido_id: pedidoId,
      tipo_evento: tipoEvento,
      movimento_id: movimentoId,
      descricao,
      created_at: new Date().toISOString(),
      created_by: usuarioId
    });
    return criado?.id ?? criado?.[0]?.id ?? null;
  } catch (err) {
    avisos.push(`Falha ao registrar o evento do pedido (${tipoEvento}): ${err?.message || err}`);
    return null;
  }
}

/**
 * Muda o status das reservas de um pedido.
 *
 * Usado quando o pedido é enviado (-> finalizado) e quando é cancelado
 * (-> retornada, e aí as peças entram no estoque).
 */
async function atualizarStatusDasReservas(api, pedidoId, novoStatus, avisos = []) {
  if (!pedidoId || !novoStatus) return 0;
  let atualizadas = 0;
  try {
    const reservas = await api.get('/api/reservas_estoque', { query: { pedido_id: pedidoId } });
    for (const reserva of (Array.isArray(reservas) ? reservas : [])) {
      if (!reserva?.id) continue;
      // Reserva já encerrada não volta atrás: sobrescrever apagaria a história.
      if (reserva.status === RESERVA.RETORNADA || reserva.status === RESERVA.TRANSFERIDO) continue;
      try {
        await api.put(`/api/reservas_estoque/${reserva.id}`, { status: novoStatus });
        atualizadas += 1;
      } catch (err) {
        avisos.push(`Falha ao atualizar a reserva ${reserva.id}: ${err?.message || err}`);
      }
    }
  } catch (err) {
    avisos.push(`Falha ao ler as reservas do pedido ${pedidoId}: ${err?.message || err}`);
  }
  return atualizadas;
}

module.exports = {
  MOV,
  ITEM,
  RESERVA,
  EVENTO,
  registrarMovimento,
  registrarPecaDoEstoque,
  registrarReservaDeProducao,
  registrarConsumoDeInsumo,
  registrarEventoDoPedido,
  atualizarStatusDasReservas
};
